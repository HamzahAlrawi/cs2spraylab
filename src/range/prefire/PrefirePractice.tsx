import {useContext, useEffect, useMemo, useRef, useState} from 'react';
import {LoaderCircle, RotateCcw} from 'lucide-react';
import type {Settings} from '../config';
import type {ProgressionController} from '../progression';
import {DuelStage} from '../duel/DuelStage';
import type {PrefireMap} from './map';
import {defaultPrefireMapId, prefireMaps} from './map-adapters';
import type {PrefireCatalog} from './schema';
import {loadPrefireConfig, sanitizePrefireConfig, savePrefireConfig, type PrefireConfig} from './config';
import {PrefireSession} from './session';
import {CoachingActions} from '../CoachingReview';
import {practiceOutcome, practicePlan, practiceSettingsKey, recordPractice, startPractice, type PracticeBlock, type PracticePhase} from '../adaptive-practice';
import {setupKey} from '../setup-key';
import {PrefireWorkflow} from './workflow-context';
import {loadAngleDiagnoses, type AngleDiagnosis} from './training-log';
import {readCoachingSummary} from '../coaching-types';
import './prefire.css';

export default function PrefirePractice(props: {settings: Settings; openSettings: () => void; onEnter: () => void; suspended: boolean;
  progression?: ProgressionController; cosmeticRevision?: Readonly<Record<string, string>>}) {
  const showTips = props.settings.showTips ?? true;
  const [config, setConfig] = useState(loadPrefireConfig);
  const [map, setMap] = useState<PrefireMap>();
  const [catalog, setCatalog] = useState<PrefireCatalog>();
  const [error, setError] = useState('');
  const parentActions = useContext(CoachingActions);
  const [diagnoses, setDiagnoses] = useState(loadAngleDiagnoses);
  const [block, setBlock] = useState<PracticeBlock>();
  const blockRef = useRef(block); blockRef.current = block;
  const settingsRef = useRef(props.settings); settingsRef.current = props.settings;
  const configRef = useRef(config); configRef.current = config;
  const origin = useRef<PrefireConfig>();
  const source = useRef<AngleDiagnosis>();
  const [message, setMessage] = useState('');
  const [retention, setRetention] = useState<{diagnosis: AngleDiagnosis; due: string; settingsKey?: string} | undefined>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('spraylab.prefire.retention.v1') || 'null');
      return value && typeof value.diagnosis?.angleId === 'string' && typeof value.diagnosis?.routeId === 'string' &&
        readCoachingSummary(value.diagnosis.summary) && Number.isFinite(Date.parse(value.due)) ? value : undefined;
    } catch {return;}
  });
  useEffect(() => {
    setMap(undefined); setError('');
    const abort = new AbortController(); let loaded: PrefireMap | undefined;
    void prefireMaps.activate(defaultPrefireMapId).then(async pack => {
      abort.signal.throwIfAborted();
      if (!pack.loadRuntime) throw new Error('Map runtime is unavailable.');
      const next = await pack.loadRuntime(abort.signal); setCatalog(pack.catalog); return next;
    }).then(next => {
      loaded = next;
      if (abort.signal.aborted) {next.dispose(); loaded = undefined;} else setMap(next);
    }).catch(error => {if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Dust 2 could not load.');});
    return () => {abort.abort(); queueMicrotask(() => loaded?.dispose());};
  }, []);
  const session = useMemo(() => map && catalog ? new PrefireSession(map, config, catalog) : undefined, [map, catalog]);
  useEffect(() => {
    if (!session) return;
    session.onReview = (rows, isolated) => {
      setDiagnoses(session.diagnoses);
      const current = blockRef.current;
      if (isolated && current && rows[0]) {
        const context = setupKey([practiceSettingsKey(settingsRef.current), configRef.current]);
        const next = recordPractice(current, rows[0].id, context, rows[0].summary);
        blockRef.current = next; setBlock(next);
      }
    };
    return () => {session.onReview = undefined;};
  }, [session]);
  const applyConfig = (next: PrefireConfig) => {setConfig(next);};
  const end = () => {
    session?.endAngleRetry(); setBlock(undefined); blockRef.current = undefined;
    if (origin.current) {session?.select(origin.current.routeId); applyConfig(origin.current); savePrefireConfig(origin.current); origin.current = undefined;}
  };
  const retry = (diagnosis: AngleDiagnosis, phase: PracticePhase = 'guided') => {
    if (!session) return;
    const plan = practicePlan(diagnosis.summary);
    if (!plan) {setMessage('No measured opening for this angle yet.'); return;}
    const original = {...config, routeId: session.routes[session.routeIndex].id};
    if (!session.startAngleRetry(diagnosis.angleId, diagnosis.routeId)) {setMessage('No validated covered start for this angle. Repeat the route instead.'); return false;}
    origin.current ??= original; source.current = diagnosis;
    const next = sanitizePrefireConfig({...config, routeId: diagnosis.routeId, autoAdvance: false, routeGuide: phase === 'guided',
      returnFire: phase === 'pressure' ? true : config.returnFire});
    applyConfig(next); setMessage('');
    const started = startPractice(plan, setupKey([practiceSettingsKey(props.settings), next]), phase);
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
    if (blockRef.current) {session?.endAngleRetry(); setBlock(undefined); blockRef.current = undefined; origin.current = undefined;}
    if (patch.routeId) session?.select(patch.routeId);
    setConfig(previous => {
    const next = sanitizePrefireConfig({...previous, ...patch}); savePrefireConfig(next); return next;
    });
  };
  if (!session) return <div className="prefire-loading" role={error ? 'alert' : 'status'}>
    {error ? <><strong>Dust 2 unavailable</strong><p>{error}</p><button onClick={() => location.reload()}><RotateCcw size={16}/>Retry</button></>
      : <><LoaderCircle className="prefire-spinner" size={24}/><strong>Loading Dust 2</strong>{showTips && <span>Native geometry and collision</span>}</>}
  </div>;
  return <PrefireWorkflow.Provider value={{diagnoses, block, end, next: nextBlock, activeKey: session.activeKey, retry, message, lesson: parentActions.lesson,
    saveRetention: () => {
      if (!source.current) return;
      const check = {diagnosis: source.current, settingsKey: practiceSettingsKey(props.settings), due: new Date(Date.now() + 86400000).toISOString()};
      setRetention(check); setMessage('Retention check saved for tomorrow.');
      try {localStorage.setItem('spraylab.prefire.retention.v1', JSON.stringify(check));} catch {setMessage('Retention check available this session only.');}
    }, retention: retention ? {due: retention.due, start: () => {
      if (retention.settingsKey && retention.settingsKey !== practiceSettingsKey(props.settings)) {setMessage('Restore the weapon and training settings used when you saved this check.'); return;}
      if (!retry(retention.diagnosis, 'retention')) return;
      setRetention(undefined);
      try {localStorage.removeItem('spraylab.prefire.retention.v1');} catch { /* Optional bookmark. */ }}} : undefined}}>
    <CoachingActions.Provider value={{lesson: parentActions.lesson, practice: () => {
      const latest = diagnoses.find(row => row.routeId === session.routes[session.routeIndex].id && practicePlan(row.summary));
      if (latest) retry(latest); else setMessage('Finish an angle to save a measured diagnosis.');
    }}}><DuelStage {...props} prefire={{session, config, update, showTips}}/></CoachingActions.Provider>
  </PrefireWorkflow.Provider>;
}
