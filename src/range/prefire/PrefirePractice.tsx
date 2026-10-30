import {useContext, useEffect, useMemo, useRef, useState} from 'react';
import {LoaderCircle, RotateCcw} from 'lucide-react';
import type {Settings} from '../config';
import type {ProgressionController} from '../progression';
import {DuelStage} from '../duel/DuelStage';
import type {PrefireMap} from './map';
import {prefireMaps} from './map-adapters';
import {nativeMaps} from './maps';
import type {PrefireCatalog} from './schema';
import {loadPrefireConfig, sanitizePrefireConfig, savePrefireConfig, updatePrefireConfig, type PrefireConfig} from './config';
import {PrefireSession} from './session';
import {CoachingActions} from '../CoachingReview';
import {practiceOutcome, practicePlan, practiceSettingsKey, recordPractice, startPractice, type PracticeBlock, type PracticePhase} from '../adaptive-practice';
import {PrefireWorkflow} from './workflow-context';
import {loadPrefireRetentions, prefireRecordMatches, savePrefireRetention, type AngleDiagnosis} from './training-log';
import './prefire.css';

export default function PrefirePractice(props: {settings: Settings; openSettings: () => void; onEnter: () => void; suspended: boolean;
  progression?: ProgressionController; cosmeticRevision?: Readonly<Record<string, string>>}) {
  const showTips = props.settings.showTips ?? true;
  const [config, setConfig] = useState(loadPrefireConfig);
  const [runtime, setRuntime] = useState<{map: PrefireMap; catalog: PrefireCatalog}>();
  const [error, setError] = useState('');
  const parentActions = useContext(CoachingActions);
  const [diagnoses, setDiagnoses] = useState<AngleDiagnosis[]>([]);
  const [block, setBlock] = useState<PracticeBlock>();
  const blockRef = useRef(block); blockRef.current = block;
  const settingsRef = useRef(props.settings); settingsRef.current = props.settings;
  const configRef = useRef(config); configRef.current = config;
  const origin = useRef<PrefireConfig>();
  const source = useRef<AngleDiagnosis>();
  const [message, setMessage] = useState('');
  const [retentions, setRetentions] = useState(loadPrefireRetentions);
  const selectedMap = nativeMaps.get(config.mapId);
  const maps = nativeMaps.list();
  useEffect(() => {
    setRuntime(undefined); setError(''); setDiagnoses([]); setMessage('');
    setBlock(undefined); blockRef.current = undefined; origin.current = undefined; source.current = undefined;
    const abort = new AbortController(); let loaded: PrefireMap | undefined;
    void prefireMaps.activate(config.mapId).then(async pack => {
      abort.signal.throwIfAborted();
      if (!pack.loadRuntime) throw new Error('Map runtime is unavailable.');
      const next = await pack.loadRuntime(abort.signal);
      loaded = next;
      if (abort.signal.aborted) {next.dispose(); loaded = undefined;} else setRuntime({map: next, catalog: pack.catalog});
    }).catch(error => {if (!abort.signal.aborted) setError(error instanceof Error ? error.message : `${selectedMap.name} could not load.`);});
    return () => {abort.abort(); queueMicrotask(() => loaded?.dispose());};
  }, [config.mapId]);
  const session = useMemo(() => runtime?.catalog.id === config.mapId
    ? new PrefireSession(runtime.map, config, runtime.catalog) : undefined, [runtime, config.mapId]);
  const retention = session ? retentions.find(row => prefireRecordMatches(row.diagnosis, session.identity)) : undefined;
  useEffect(() => {
    if (!session) return;
    setDiagnoses(session.diagnoses);
    session.onReview = (rows, isolated) => {
      if (configRef.current.mapId !== session.catalog.id) return;
      setDiagnoses(session.diagnoses);
      const current = blockRef.current;
      if (isolated && current && rows[0]) {
        const context = session.practiceKey(settingsRef.current, configRef.current);
        const next = recordPractice(current, rows[0].id, context, rows[0].summary);
        blockRef.current = next; setBlock(next);
      }
    };
    return () => {session.onReview = undefined;};
  }, [session]);
  const applyConfig = (next: PrefireConfig) => {setConfig(next);};
  const end = () => {
    session?.endAngleRetry(); setBlock(undefined); blockRef.current = undefined; source.current = undefined;
    if (origin.current) {session?.select(origin.current.routeId); applyConfig(origin.current); savePrefireConfig(origin.current); origin.current = undefined;}
  };
  const retry = (diagnosis: AngleDiagnosis, phase: PracticePhase = 'guided') => {
    if (!session || !prefireRecordMatches(diagnosis, session.identity)) return false;
    const plan = practicePlan(diagnosis.summary);
    if (!plan) {setMessage('No measured opening for this angle yet.'); return;}
    const original = {...config, routeId: session.routes[session.routeIndex].id};
    if (!session.startAngleRetry(diagnosis.angleId, diagnosis.routeId)) {setMessage('No validated covered start for this angle. Repeat the route instead.'); return false;}
    origin.current ??= original; source.current = diagnosis;
    const next = sanitizePrefireConfig({...config, routeId: diagnosis.routeId, autoAdvance: false, routeGuide: phase === 'guided',
      returnFire: phase === 'pressure' ? true : config.returnFire}, selectedMap.index);
    applyConfig(next); setMessage('');
    const started = startPractice(plan, session.practiceKey(props.settings, next), phase);
    blockRef.current = started; setBlock(started);
    return true;
  };
  const nextBlock = (phase: PracticePhase) => {
    if (!block || !source.current) return;
    const outcome = practiceOutcome(block);
    const varied = phase === 'varied' ? diagnoses.find(row => row.routeId === source.current!.routeId && row.angleId !== source.current!.angleId && practicePlan(row.summary)) : undefined;
    const diagnosis = varied ?? source.current;
    retry(diagnosis, phase);
    if (outcome.average !== null && !varied) setBlock(previous => previous ? {...previous, plan: {...previous.plan, baseline: outcome.average!}} : previous);
  };
  const update = (patch: Partial<PrefireConfig>) => {
    session?.endAngleRetry(); setBlock(undefined); blockRef.current = undefined; origin.current = undefined; source.current = undefined;
    if (patch.mapId && patch.mapId !== config.mapId) {setDiagnoses([]); setMessage('');}
    else if (patch.routeId) session?.select(patch.routeId);
    setConfig(previous => {
      const next = updatePrefireConfig(previous, patch);
      configRef.current = next; savePrefireConfig(next); return next;
    });
  };
  if (!session) return <div className="prefire-loading" role={error ? 'alert' : 'status'}>
    {maps.length > 1 && <label>Map <select aria-label="Prefire map" value={config.mapId} onChange={event => update({mapId: event.target.value})}>
      {maps.map(map => <option key={map.id} value={map.id}>{map.name}</option>)}</select></label>}
    {error ? <><strong>{selectedMap.name} unavailable</strong><p>{error}</p><button onClick={() => location.reload()}><RotateCcw size={16}/>Retry</button></>
      : <><LoaderCircle className="prefire-spinner" size={24}/><strong>Loading {selectedMap.name}</strong>{showTips && <span>Native geometry and collision</span>}</>}
  </div>;
  return <PrefireWorkflow.Provider value={{diagnoses, block, end, next: nextBlock, activeKey: session.activeKey, retry, message, lesson: parentActions.lesson,
    saveRetention: () => {
      if (!source.current || !prefireRecordMatches(source.current, session.identity)) return;
      const check = {diagnosis: {...source.current, ...session.identity}, settingsKey: practiceSettingsKey(props.settings), due: new Date(Date.now() + 86400000).toISOString()};
      setRetentions(previous => [check, ...previous.filter(row => !prefireRecordMatches(row.diagnosis, session.identity))]); setMessage('Retention check saved for tomorrow.');
      if (!savePrefireRetention(check, session.identity)) setMessage('Retention check available this session only.');
    }, retention: retention ? {due: retention.due, start: () => {
      if (retention.settingsKey && retention.settingsKey !== practiceSettingsKey(props.settings)) {setMessage('Restore the weapon and training settings used when you saved this check.'); return;}
      if (!retry(retention.diagnosis, 'retention')) return;
      setRetentions(previous => previous.filter(row => !prefireRecordMatches(row.diagnosis, session.identity)));
      savePrefireRetention(undefined, session.identity);}} : undefined}}>
    <CoachingActions.Provider value={{lesson: parentActions.lesson, practice: () => {
      const latest = diagnoses.find(row => row.routeId === session.routes[session.routeIndex].id && practicePlan(row.summary));
      if (latest) retry(latest); else setMessage('Finish an angle to save a measured diagnosis.');
    }}}><DuelStage {...props} prefire={{session, config, update, showTips}}/></CoachingActions.Provider>
  </PrefireWorkflow.Provider>;
}
