import { CSSProperties, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Code2 as Github, Crosshair as AimIcon, Download, Eye, Gauge, Gift, History, LayoutGrid, ListPlus, Maximize, PanelRightClose, PanelRightOpen, Pause, Play, RotateCcw, ScanLine, Search, Settings2, Shield, ShoppingCart, Target, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { Crosshair, defaults, gameData, historyModeNames, loadSettings, loadoutWeapon, MeasuredProfile, migrateMode, Mode, modeNames, parseProfile, presets, saveSettings, Settings, Weapon, weaponIds, weaponNames, pistolIds, type Pistol } from './config';
import type { RangeEngine, RangeStatus } from './engine';
import { Result } from './simulation';
import { loadAttempts } from '../lib/storage';
import { markSetupHintSeen, needsSetupHint } from './onboarding';
import {equipmentIds,equipmentNames,equipmentStats,type Slot} from './equipment';
import {isDrillMode,readDrillMetrics} from './drills';
import {DrillPanel,DrillReview,TipsDisplay} from './DrillPanel';
import {makeRepFeedback,type RepFeedback} from './rep-feedback';
import {GraduationCap} from 'lucide-react';
import {modeInfo} from './mode-info';
import recoilProvenance from './recoil-provenance.json';
import {createProgressionController, cosmeticsForEquipment, type ProgressionController, type ProgressionProfile} from './progression';
import {ProgressionPanel, XpNotification, useProgression} from './ProgressionPanel';
import {cosmeticCatalog, cosmeticLabel, cosmeticPreview} from './cosmetics';
import {CoachingActions, CoachingReview} from './CoachingReview';
import {sameCoachingMetrics, type CoachingSummary} from './coaching-types';
import {practiceOutcome, practicePlan, practiceSettingsKey, recordPractice, startPractice, type PracticeBlock as Block, type PracticePhase} from './adaptive-practice';
import {PracticeBlock} from './PracticeBlock';
import {loadSkillSamples, saveSkillSamples, skillSample, skillTrends} from './skill-trends';
import {loadRetention, saveRetention} from './practice-retention';
import {coachRangeAttempt, comparableRangePractice} from './range-coaching';
import {parseRangeResults} from './range-results';
import {ControlsSettings, MouseSettings} from './ControlsSettings';
import {equipmentKeyLabel} from './controls';
import {DrillChooser} from './DrillChooser';
import {drillGroups, matchesWeapon, weaponGroups, type WeaponGroup} from './training-ui';
import {usePanelFocus} from './use-panel-focus';
const PrefirePractice = lazy(() => import('./prefire/PrefirePractice'));
const DuelStage = lazy(() => import('./duel/DuelStage').then(module => ({default: module.DuelStage})));
const HearingPractice = lazy(() => import('./HearingPractice').then(module => ({default: module.HearingPractice})));
const MovementTutorial = lazy(() => import('./MovementTutorial').then(module => ({default: module.MovementTutorial})));
const Changelog = lazy(() => import('./Changelog').then(module => ({default: module.Changelog})));
const loading = <div className="workflow-loading" role="status">Loading practice</div>;

function LoadoutFinishes({equipment, profile, controller, onShop, focusRequest}: {equipment: Weapon; profile: ProgressionProfile; controller: ProgressionController; onShop: (equipment: string) => void; focusRequest: number}) {
  const finishes = useRef<HTMLElement>(null);
  const handledFocusRequest = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === handledFocusRequest.current) return;
    handledFocusRequest.current = focusRequest;
    finishes.current?.scrollIntoView({block: 'start'});
    const equipped = finishes.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    (equipped ?? finishes.current?.querySelector<HTMLButtonElement>('button[aria-pressed]'))?.focus({preventScroll: true});
  }, [equipment, focusRequest]);
  return <section ref={finishes} className="loadout-finishes" aria-label={`${weaponNames[equipment]} skins`}><header><h3>{weaponNames[equipment]} finishes</h3>
    <button type="button" className="finish-shop" onClick={() => onShop(equipment)} aria-label={`Browse ${weaponNames[equipment]} unlocks`}><ShoppingCart size={13}/>Unlocks</button></header>
    <div>{cosmeticsForEquipment(profile, controller.catalog, equipment).map(item => {
      const equipped = profile.equipped[equipment] === item.id || item.isDefault && !profile.equipped[equipment];
      return <button key={item.id} type="button" className={equipped ? 'selected' : ''} aria-pressed={equipped}
        title={item.label} aria-label={`Equip ${weaponNames[equipment]} skin ${item.label}`}
        onClick={() => controller.equip(equipment, item.id)}>
        <img src={item.imageUrl} alt="" loading="lazy"/><span>{item.label}</span>{equipped && <Check size={13}/>}
      </button>;
    })}</div></section>;
}

function CrosshairView({ value }: { value: Crosshair }) {
  const style = { '--cross-color': value.color, '--cross-size': `${value.size}px`, '--cross-gap': `${value.gap}px`, '--cross-thickness': `${value.thickness}px`, '--cross-outline': `${value.outline}px`, opacity: value.alpha } as CSSProperties;
  return <div className={`crosshair ${value.t ? 't-style' : ''} ${value.size === 0 ? 'dot-only' : ''}`} style={style} aria-hidden="true">
    <i className="arm top" /><i className="arm right" /><i className="arm bottom" /><i className="arm left" />{value.dot && <i className="dot" />}
  </div>;
}
function Slider({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (n: number) => void }) {
  return <label className="slider-row"><span>{label}<output>{value}{suffix}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} /></label>;
}
function Toggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span className="switch" /></label>;
}
function readResults(): Result[] {
  try {
    return parseRangeResults(JSON.parse(localStorage.getItem('spraylab.results.v2') || '[]'));
  } catch { return []; }
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const emptyStatus: RangeStatus = { weapon: 'ak47', equipped:'ak47',slot:1,equipReady:true,magazine:30, active: false, firing: false, shots: 0, hits: 0, heads: 0, remaining: 30, reload: 0, speed: 0, distance: 12, input: 'Ready', audio: 'locked', assets: 'Loading models', fps: 0 };
type Panel = 'settings' | 'weapons' | 'history' | 'changelog' | 'drills' | null;
type Tab = 'game' | 'training' | 'controls' | 'crosshair' | 'data';
const settingsTabs: {id: Tab; label: string}[] = [
  {id: 'game', label: 'Mouse'}, {id: 'crosshair', label: 'Crosshair'}, {id: 'controls', label: 'Controls'},
  {id: 'training', label: 'Training'}, {id: 'data', label: 'Audio & video'},
];

export default function RangeApp() {
  const [progression] = useState(() => createProgressionController({catalog: cosmeticCatalog}));
  const progressionState = useProgression(progression);
  const [progressionReady, setProgressionReady] = useState(() => typeof indexedDB === 'undefined');
  useEffect(() => {
    let mounted = true;
    void progression.ready.then(() => {if (mounted) setProgressionReady(true);});
    return () => {mounted = false;};
  }, [progression]);
  const [armoryOpen, setArmoryOpen] = useState(false);
  const [armoryRequest, setArmoryRequest] = useState<string | null>(null);
  const [achievementRequest, setAchievementRequest] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [setupHint, setSetupHint] = useState(needsSetupHint);
  const showSetupHint = settings.showTips && setupHint;
  const [tutorial, setTutorial] = useState(false);
  const [lesson, setLesson] = useState<0 | 1 | 2>(0);
  const [practice, setPractice] = useState<Block>();
  const practiceRef = useRef(practice); practiceRef.current = practice;
  const practiceOrigin = useRef<Settings>();
  const combatSample = useRef<{id: string; key: string; setupKey: string; summary: CoachingSummary}>();
  const [retention, setRetention] = useState(loadRetention);
  const [skillSamples, setSkillSamples] = useState(loadSkillSamples);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const lessonButton = useRef<HTMLButtonElement>(null), lessonOpener = useRef<HTMLElement | null>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const [status, setStatus] = useState(emptyStatus);
  const [panel, setPanel] = useState<Panel>(null), [tab, setTab] = useState<Tab>('game');
  const [finishSlot, setFinishSlot] = useState<1 | 2>(1);
  const [finishFocusRequest, setFinishFocusRequest] = useState(0);
  const [weaponSearch, setWeaponSearch] = useState('');
  const [weaponFilter, setWeaponFilter] = useState<WeaponGroup>('All');
  const [resetPending, setResetPending] = useState(false);
  const [focusRange, setFocusRange] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches);
  const [results, setResults] = useState(readResults);
  const resultsRef=useRef(results);resultsRef.current=results;
  const [repFeedback,setRepFeedback]=useState<(RepFeedback&{id:string;mode:Mode})|null>(null);
  const [legacy] = useState(loadAttempts);
  const [selected, setSelected] = useState<Result>();
  const [profiles, setProfiles] = useState<Partial<Record<Weapon, MeasuredProfile>>>(() => {
    try { return Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('spraylab.profiles.v1') || '{}')).map(([k, v]) => [k, parseProfile(JSON.stringify(v))])); } catch { return {}; }
  });
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [generation, setGeneration] = useState(0);
  const [replay, setReplay] = useState(35);
  const host = useRef<HTMLDivElement>(null), follow = useRef<HTMLDivElement>(null), hitmarker = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const engine = useRef<RangeEngine>();
  const [rangeReady, setRangeReady] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  const selectedWeapon = loadoutWeapon(settings);
  const combatMode = settings.mode === 'duel' || settings.mode === 'prefire';
  const assetReady = rangeReady && status.assets === 'Models ready' && status.weapon === selectedWeapon;
  const weapon = gameData.weapons[selectedWeapon];
  const recentResult = results.find(r => r.mode === settings.mode && r.weapon === status.equipped);
  const score = status.drill?.last?.coaching?.score ?? recentResult?.coaching?.score ?? null;
  const showRepFeedback=repFeedback?.mode===settings.mode && status.active && !status.firing && !status.hitFlash;
  const repMessage = settings.showTips ? repFeedback?.message
    : `${isDrillMode(settings.mode) ? repFeedback?.passed ? 'Rep passed' : 'Rep not passed' : 'Attempt complete'}${score === null ? '' : ` / ${Math.round(score)}/100`}`;
  const repEvidence = repFeedback?.evidence ?? (settings.showTips ? repFeedback?.tip : undefined);
  const update = (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch }));
  const cross = (patch: Partial<Crosshair>) => setSettings(s => ({ ...s, crosshair: { ...s.crosshair, ...patch } }));
  const open = (next: Panel) => { engine.current?.pause(); setSetupHint(false); setResetPending(false); setPanel(next); };
  const closePanel = useCallback(() => setPanel(null), []);
  usePanelFocus(drawer, !!panel, closePanel);
  const chooseMode = (mode: Mode) => {
    engine.current?.pause();
    if (mode !== settings.mode) update({mode, spread: modeInfo[mode].spread});
    setPanel(null);
  };
  const recordCombat = useCallback((id: string, setupKey: string, summary: CoachingSummary) => {
    if (settingsRef.current.mode !== 'duel' || combatSample.current?.id === id) return;
    const key = `${practiceSettingsKey(settingsRef.current)}:${setupKey}`;
    combatSample.current = {id, key, setupKey, summary};
    setSkillSamples(previous => {const next = [skillSample(id, key, summary), ...previous].slice(0, 240); saveSkillSamples(next); return next;});
    if (practiceRef.current) {
      if (practiceRef.current.key !== key) setNotice('This round used a different setup. Restore your practice settings to continue the block.');
      const next = recordPractice(practiceRef.current, id, key, summary); practiceRef.current = next; setPractice(next);
    }
  }, []);
  const openLesson = (summary?: CoachingSummary) => {
    lessonOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    engine.current?.pause(); document.exitPointerLock?.();
    setPanel(null); setLesson(summary ? practicePlan(summary)?.lesson ?? 0 : 0); setTutorial(true);
  };
  const closeLesson = () => {
    setTutorial(false);
    requestAnimationFrame(() => (lessonOpener.current?.isConnected ? lessonOpener.current : lessonButton.current)?.focus());
  };
  const endPractice = () => {
    engine.current?.pause(); setPractice(undefined);
    if (practiceOrigin.current) {setSettings(practiceOrigin.current); practiceOrigin.current = undefined;}
  };
  const launchPractice = (summary: CoachingSummary) => {
    const source = results.find(row => row.coaching === summary || row.drill?.coaching === summary);
    const plan = practicePlan(summary);
    if (plan && settings.mode === 'duel' && combatSample.current && sameCoachingMetrics(combatSample.current.summary.metrics, summary.metrics)) {
      document.exitPointerLock?.(); practiceOrigin.current ??= settings;
      setPractice(startPractice(plan, combatSample.current.key, 'guided')); setPanel(null); return;
    }
    if (!plan || !source || source.mode === 'tracking' || !source.practice) return;
    engine.current?.pause(); document.exitPointerLock?.();
    practiceOrigin.current ??= settings;
    const pistol = pistolIds.includes(source.weapon as Pistol);
    const next: Settings = {...settings, mode: source.mode, ...(pistol ? {sidearm: source.weapon as Pistol, primaryEnabled: false} : {weapon: source.weapon as Weapon, primaryEnabled: true}),
      spread: source.practice.spread, burst: [5, 10, 15].includes(source.practice.burst) ? source.practice.burst : 0,
      moving: source.practice.moving, drillPace: source.practice.pace ?? settings.drillPace,
      peekDuration: source.practice.peekDuration ?? settings.peekDuration, transferRule: source.practice.transferRule, transferAfter: source.practice.transferAfter};
    setPanel(null); setSettings(next);
    setPractice(startPractice(plan, practiceSettingsKey(next, source.practice.distance), next.mode === 'guided' ? 'guided' : 'unassisted'));
  };
  const nextBlock = (phase: PracticePhase) => {
    if (!practice) return;
    engine.current?.pause();
    const outcome = practiceOutcome(practice);
    const next = {...settings, ...(phase !== 'guided' ? {mode: settings.mode === 'guided' ? 'spray' as const : settings.mode,
      showImpactPattern: false, showMousePath: false, follow: false} : {}),
      ...(phase === 'varied' && settings.mode === 'peek' ? {peekScenario: 'mixed' as const} : {}),
      ...(phase === 'pressure' && isDrillMode(settings.mode) ? {drillPace: 'challenge' as const} : {})};
    setSettings(next); setPractice(startPractice({...practice.plan, baseline: outcome.average ?? practice.plan.baseline},
      settings.mode === 'duel' ? combatSample.current?.key ?? practice.key : practiceSettingsKey(next, status.distance), phase));
  };
  useEffect(() => { if (showSetupHint) markSetupHintSeen(); }, [showSetupHint]);
  useEffect(() => { if (status.active) setSetupHint(false); }, [status.active]);
  useEffect(()=>{if(!repFeedback)return;const timer=setTimeout(()=>setRepFeedback(null),4000);return()=>clearTimeout(timer);},[repFeedback]);
  useEffect(()=>setRepFeedback(null),[settings.mode]);
  useEffect(() => {
    setRangeReady(false);
    if (!progressionReady || combatMode || settings.mode === 'hearing') {engine.current = undefined; return;}
    let range: RangeEngine | undefined, cancelled = false;
    setStatus({...emptyStatus, weapon: selectedWeapon, equipped: selectedWeapon});
    setError('');
    void import('./engine').then(({RangeEngine}) => {
      if (cancelled || !host.current || !follow.current || !hitmarker.current) return;
      range = new RangeEngine(host.current, setStatus, settingsRef.current, follow.current, hitmarker.current, setError, progression);
      engine.current = range;
      setRangeReady(true);
      range.sim.attempts = results.length;
      range.sim.onResult = result => {
        if (['guided', 'spray', 'transfer'].includes(result.mode)) result.coaching = coachRangeAttempt(result, resultsRef.current);
        range!.settleProgression(result);
        if(result.drill&&isDrillMode(result.mode)) {
          const previous=resultsRef.current.filter(r=>r.drill&&comparableRangePractice(result,r)).map(r=>r.drill!);
          const feedback=makeRepFeedback(result.mode,result.drill,previous);
          if (feedback.coaching) {result.drill.coaching=feedback.coaching; result.coaching=feedback.coaching;}
          setRepFeedback({id:result.id,mode:result.mode,...feedback});
        } else if (result.shots && result.mode !== 'tracking') {
          setRepFeedback({id: result.id, mode: result.mode, passed: (result.coaching?.score ?? 0) >= 80,
            message: result.coaching?.focus ?? `${result.hits}/${result.shots} hits`, evidence: result.coaching?.evidence});
        }
        const key = practiceSettingsKey(settingsRef.current, result.practice?.distance);
        if (result.coaching) setSkillSamples(previous => {
          const next = [skillSample(result.id, practiceSettingsKey(settingsRef.current, result.practice?.distance), result.coaching!), ...previous].slice(0, 240);
          saveSkillSamples(next); return next;
        });
        if (practiceRef.current) {
          const next = recordPractice(practiceRef.current, result.id, key, result.coaching);
          practiceRef.current = next; setPractice(next);
        }
        resultsRef.current=[result,...resultsRef.current].slice(0,100);
        setSelected(result); setReplay(result.samples.length);
        setResults(previous => {
          const next = [result, ...previous].slice(0, 100);
          try { localStorage.setItem('spraylab.results.v2', JSON.stringify(next)); } catch { setNotice('Browser storage unavailable. This session is not saved.'); }
          return next;
        });
      };
    }).catch(() => {if (!cancelled) setError('WebGL could not start. Enable browser hardware acceleration, then restart the range.');});
    return () => {cancelled = true; engine.current = undefined; range?.dispose();};
  }, [generation, combatMode, settings.mode === 'hearing', progressionReady]);
  useEffect(() => {
    engine.current?.configure(settings, profiles[settings.weapon]);
    if (!practiceRef.current && !saveSettings(settings)) setNotice('Browser storage unavailable. Settings apply to this session.');
  }, [settings, profiles, generation]);
  useEffect(() => {void engine.current?.refreshCosmetics();}, [progressionState.profile.equipped]);
  const start = () => {
    const range = engine.current;
    if (!range || !assetReady) return;
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (coarse) {range.sim.active = true; range.inputStatus = 'Touch'; void range.audio.unlock(range.sim.equipped);}
    else void range.enter();
  };
  const importProfile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error('Profile exceeds 100 KB.');
      const p = parseProfile(await file.text());
      const next = { ...profiles, [p.weapon]: p }; setProfiles(next);
      try { localStorage.setItem('spraylab.profiles.v1', JSON.stringify(next)); } catch { setNotice('Capture loaded for this session only.'); }
      update({ weapon: p.weapon }); setNotice(`${weaponNames[p.weapon]} capture loaded.`);
    } catch (e) { setNotice((e as Error).message); }
  };
  if (!progressionReady) return <main className="range-app"><div className="workflow-loading" role="status">Restoring saved progress</div></main>;
  return <CoachingActions.Provider value={{practice: settings.mode !== 'prefire' && settings.mode !== 'hearing' ? launchPractice : undefined, lesson: openLesson, record: recordCombat,
    trends: summary => {
      const source = results.find(row => row.coaching === summary || row.drill?.coaching === summary);
      const key = settings.mode === 'duel' ? combatSample.current?.key : source?.practice ? practiceSettingsKey(settings, source.practice.distance) : undefined;
      return key ? skillTrends(skillSamples, key) : [];
    }}}><main className={`range-app${focusRange ? ' focus-practice' : ''}`}>
    <header className="appbar">
      <a className="brand" href="/" aria-label="SprayLab home"><AimIcon size={25} strokeWidth={1.7} /><span>SPRAYLAB<span className="brand-sub">COUNTER-STRIKE TRAINING</span></span></a>
      <nav className="main-nav" aria-label="Workspace"><button className={!panel ? 'selected' : ''} onClick={() => setPanel(null)}><Target size={16} />Range</button><button className={panel === 'history' ? 'selected' : ''} onClick={() => open('history')}><History size={16} />Session<span className="count">{results.length}</span></button></nav>
      <div className="app-actions">
        <button type="button" className="changelog-button" aria-label="Changelog" title="Changelog" aria-haspopup="dialog" aria-expanded={panel === 'changelog'} onClick={event => {event.currentTarget.focus(); open('changelog');}}><ListPlus size={17} aria-hidden="true"/><span>Changelog</span></button>
        <ProgressionPanel controller={progression} activeEquipment={selectedWeapon} equipmentLabels={equipmentNames} requestedEquipment={armoryRequest} requestedAchievements={achievementRequest} onRequestHandled={()=>{setArmoryRequest(null);setAchievementRequest(false);}} onOpenChange={value=>{setArmoryOpen(value); if(value)engine.current?.pause();}}/>
        <a className="header-donation" aria-label="Donate unwanted CS2 skins" title="Donate unwanted CS2 skins" href="https://steamcommunity.com/tradeoffer/new/?partner=135963670&token=IS6KDROD" target="_blank" rel="noreferrer"><Gift size={16} /><span className="donation-full">Donate unwanted CS2 skins</span><span className="donation-compact">Donate CS2 skins</span></a>
        <button ref={settingsButton} className={`settings-button${showSetupHint ? ' settings-nudge' : ''}`} aria-describedby={showSetupHint ? 'settings-hint-text' : undefined} onClick={() => open('settings')}><Settings2 size={17} />Settings</button>
      </div>
    </header>
    {progressionState.storageStatus !== 'saved' && progressionState.storageStatus !== 'saving' && <div className="progression-storage-banner" role="status">
      <span>{progressionState.storageStatus === 'unsupported-version' ? 'A newer progress save was protected. This session will not be saved.' :
        progressionState.storageStatus === 'corrupt-save' ? 'A damaged progress save was preserved. Restore a backup or export this session.' :
          'Progress is not being saved to this browser. Export a backup before leaving.'}</span>
      <button type="button" onClick={() => setArmoryRequest(selectedWeapon)}><Download size={14}/>Save &amp; gifts</button>
    </div>}
      {showSetupHint && !panel && <div className="settings-hint" role="status">
        <button className="hint-action" aria-label="Customize your CS2 settings" onClick={() => open('settings')}><b>Match your CS2 setup</b><span id="settings-hint-text">Sensitivity, crosshair & audio</span></button>
        <ArrowUp className="hint-arrow" size={22} aria-hidden="true" />
        <button className="icon-button" aria-label="Dismiss settings hint" title="Dismiss hint" onClick={() => { setSetupHint(false); settingsButton.current?.focus(); }}><X size={16} /></button>
      </div>}
    <section className="range-toolbar" aria-label="Range configuration">
      {settings.mode !== 'hearing' && <button className="weapon-select" onClick={() => open('weapons')}><img src={cosmeticPreview(progressionState.profile, selectedWeapon)} alt="" /><span><small>{settings.primaryEnabled ? 'LOADOUT' : 'SIDEARM ONLY'}</small>{weaponNames[selectedWeapon]}</span><ChevronDown size={15} /></button>}
      <div className="drill-select-group"><label className="mode-select"><small>PRACTICE</small><select aria-label="Training mode" value={settings.mode} onChange={e => chooseMode(e.target.value as Mode)}>{drillGroups.map(group => <optgroup key={group.name} label={group.name}>{group.modes.map(id => <option key={id} value={id}>{modeNames[id]}</option>)}</optgroup>)}</select></label>
        <button className="browse-drills" aria-label="Choose a drill" aria-haspopup="dialog" onClick={() => open('drills')} title="Choose a drill"><LayoutGrid size={17}/><span>All drills</span></button>
        {settings.mode !== 'hearing' && <button className="panel-toggle" aria-label={focusRange ? 'Show drill panel' : 'Hide drill panel'} aria-expanded={!focusRange} title={focusRange ? 'Show drill setup & review' : 'Hide drill setup & review'} onClick={() => setFocusRange(value => !value)}>{focusRange ? <PanelRightOpen size={18}/> : <PanelRightClose size={18}/>}<span>Setup</span></button>}</div>
      {!combatMode && settings.mode !== 'hearing' && <div className="distance-input"><small>DISTANCE</small><output>{status.distance.toFixed(1)} m</output></div>}
      <div className="toolbar-actions">
        {!combatMode && settings.mode !== 'hearing' && <button className="icon-button" title="Reset range" aria-label="Reset range" onClick={() => engine.current?.reset()}><RotateCcw size={18} /></button>}
        {settings.mode !== 'hearing' && <button type="button" className="icon-button fps-toggle" title={settings.showFps ? 'Hide FPS counter' : 'Show FPS counter'} aria-label="Toggle FPS counter" aria-pressed={settings.showFps} onClick={() => update({showFps: !settings.showFps})}><Gauge size={18} aria-hidden="true"/></button>}
        <button className="icon-button" title={settings.volume ? 'Mute' : 'Unmute'} aria-label={settings.volume ? 'Mute' : 'Unmute'} onClick={() => update({ volume: settings.volume ? 0 : .2 })}>{settings.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        {settings.mode !== 'hearing' && <button className="icon-button fullscreen" title="Fullscreen" aria-label="Fullscreen" onClick={async () => {
          try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else if (stage.current?.requestFullscreen) await stage.current.requestFullscreen();
            else setNotice('Fullscreen unavailable in this browser.');
          } catch {setNotice('Fullscreen unavailable in this browser.');}
        }}><Maximize size={18} /></button>}
      </div>
    </section>
    <section className="mode-brief" aria-label="Drill purpose">{settings.showTips && <details key={settings.mode} className="drill-objective"><summary>{modeInfo[settings.mode].benefit}<ChevronDown size={14}/></summary><p>{modeInfo[settings.mode].task}</p></details>}<button ref={lessonButton} aria-label="Learn the fundamentals" title="Learn the fundamentals" onClick={() => openLesson()}><GraduationCap size={18}/><span>Learn the fundamentals</span></button></section>
    {practice && <PracticeBlock block={practice} onEnd={endPractice} onNext={nextBlock}
      nextPhase={practice.phase === 'guided' ? 'unassisted' : practice.phase === 'unassisted' && settings.mode === 'peek' ? 'varied' : practice.phase === 'varied' && isDrillMode(settings.mode) ? 'pressure' : null} onRetention={() => {
      const checkSettings: Settings = {...settings, mode: settings.mode === 'guided' ? 'spray' : settings.mode,
        showImpactPattern: false, showMousePath: false, follow: false};
      const check = {plan: practice.plan, settings: checkSettings, distance: status.distance,
        duelSetupKey: settings.mode === 'duel' ? combatSample.current?.setupKey : undefined, due: new Date(Date.now() + 86400000).toISOString()};
      saveRetention(check); setRetention(check); setNotice('Retention check saved for tomorrow.');
    }}/>}
    {!practice && retention && <div className="practice-block"><button className="secondary" onClick={() => {
      const key = retention.settings.mode === 'duel' && retention.duelSetupKey
        ? `${practiceSettingsKey(retention.settings)}:${retention.duelSetupKey}`
        : practiceSettingsKey(retention.settings, retention.distance ?? status.distance);
      practiceOrigin.current = settings; setSettings(retention.settings); setPractice(startPractice(retention.plan, key, 'retention'));
      saveRetention(); setRetention(undefined);
    }}><RotateCcw size={15}/>Retention check · {new Date(retention.due).toLocaleDateString()}</button></div>}
    <section ref={stage} className={`range-stage${combatMode ? ' duel-stage' : settings.mode !== 'hearing' ? ' with-drill' : ''}`} aria-label="Practice range">
      <XpNotification controller={progression} onOpenAchievements={()=>{setPanel(null);setAchievementRequest(true);}}/>
      <Suspense fallback={loading}>{settings.mode === 'hearing' ? <HearingPractice volume={settings.volume} showTips={settings.showTips} openSettings={() => {setTab('data'); open('settings');}} suspended={!!panel || tutorial || armoryOpen}/>
        : settings.mode === 'prefire' ? <Suspense fallback={<div className="empty-state">Loading Dust 2</div>}><PrefirePractice settings={settings} progression={progression} cosmeticRevision={progressionState.profile.equipped} openSettings={() => {setTab('game'); open('settings');}} onEnter={() => setSetupHint(false)} suspended={!!panel || tutorial || armoryOpen}/></Suspense>
        : settings.mode === 'duel' ? <DuelStage settings={settings} progression={progression} cosmeticRevision={progressionState.profile.equipped} openSettings={() => {setTab('game'); open('settings');}} onEnter={() => setSetupHint(false)} suspended={!!panel || tutorial || armoryOpen}/> : <>
      <div className={`range-view${showRepFeedback?' has-rep-feedback':''}${status.hitFlash?' has-hit-feedback':''}`}>
      <div className="canvas-host" ref={host} />
      <div className="range-topline"><span className="range-badge"><i />{status.active ? 'LIVE RANGE' : 'RANGE 01'}</span><span>{profiles[settings.weapon] ? 'IMPORTED RECOIL CAPTURE' : 'GAME-DERIVED RECOIL'}</span></div>
      {!isDrillMode(settings.mode)&&<div className="target-label">{modeNames[settings.mode]} <span>{status.distance.toFixed(1)} m</span></div>}
      {settings.mode === 'transfer' && settings.transferRule === 'kill' && <div className="transfer-health" aria-label="Transfer target health">
        {(status.targetHealth ?? [100,100]).map((health, i) => <span key={i} className={health === 0 ? 'down' : ''}>{i ? 'B' : 'A'} <b>{health === 0 ? 'DOWN' : `${Math.ceil(health)} HP`}</b></span>)}
      </div>}
      <div className="equipment-slots" role="group" aria-label="Equipped weapon">
        {([1,2,3,4] as Slot[]).filter(slot=>slot!==1||settings.primaryEnabled).map(slot=>{const id=slot===1?settings.weapon:slot===2?settings.sidearm:slot===4?'zeus':'knife',keyLabel=equipmentKeyLabel(settings.controls,slot);return <button key={slot} aria-pressed={status.slot===slot} aria-label={`Equip ${equipmentNames[id]}`} title={`${cosmeticLabel(progressionState.profile, id)} (${keyLabel})`} onClick={()=>{void engine.current?.equip(slot);}}><span>{keyLabel}</span><img src={cosmeticPreview(progressionState.profile, id)} alt=""/></button>;})}
      </div>
      <div className="weapon-action-tools"><button className="icon-button" aria-label="Inspect weapon" title="Inspect weapon (F)" onClick={()=>engine.current?.inspect()}><Eye size={16}/></button>
        {status.equipped !== 'knife' && (gameData.weapons[status.equipped].zoomLevels > 0 || gameData.weapons[status.equipped].hasBurst || gameData.weapons[status.equipped].isRevolver) && <button className="icon-button" aria-label="Secondary weapon mode" title={status.equipped === 'revolver' ? 'Quick alternate shot (right click)' : 'Scope / burst mode (right click)'} onClick={()=>engine.current?.secondary()}><ScanLine size={16}/></button>}</div>
      <div className="follow-origin" ref={follow}><CrosshairView value={settings.crosshair} /></div>
      {settings.showTips&&settings.mode==='peek'&&status.active&&!!status.drill?.peekDirection&&<div className="peek-direction" role="status" aria-label={`Peek ${status.drill.peekDirection<0?'left':'right'}`}>
        {status.drill.peekDirection<0?<ArrowLeft size={32}/>:<ArrowRight size={32}/>}<span>Peek {status.drill.peekDirection<0?'left':'right'}</span>
      </div>}
      {!combatMode&&!settings.spread&&<button className="spread-warning" onClick={()=>{update({spread:true});}} title="Enable movement and firing inaccuracy">Spread off<Shield size={12}/></button>}
      <div className="hit-marker" ref={hitmarker}><X size={42} strokeWidth={3} /></div>
      {showRepFeedback&&repFeedback&&<div className={`rep-feedback${repFeedback.passed?' passed':''}`} role="status" aria-label="Rep feedback"><b>{repMessage}</b>{repEvidence&&<p>{repEvidence}</p>}</div>}
      {!status.active && !error && <button className="enter-range" disabled={!assetReady} onClick={start}><Play size={18} fill="currentColor" />{assetReady ? 'Enter range' : 'Loading range'}</button>}
      {error && <div className="range-error" role="alert"><Shield size={24} /><p>{error}</p><button onClick={() => { setError(''); setGeneration(g => g + 1); }}><RotateCcw size={16} />Restart range</button></div>}
      {status.active && <div className="exit-hint"><span>Press ESC to exit</span><button className="icon-button" aria-label="Pause range" title="Pause range (Esc)" onClick={() => engine.current?.pause()}><Pause size={16} /></button></div>}
      {status.active && status.input !== 'Touch' && !status.shortcutProtected && <div className="range-shortcut-warning" role="status">C to crouch. Ctrl+W may close this tab.</div>}
      <div className="range-hud">
        <div className="hud-performance"><span className="hud-stat"><Activity size={17} /><b>{Math.round(status.speed)}</b><small>u/s</small></span><span className="hud-stat"><Target size={17} /><b>{status.distance.toFixed(1)}</b><small>m</small></span></div>
        <div className="hud-result"><small>LAST REP QUALITY</small><strong data-testid="accuracy">{score === null ? '--' : Math.round(score)}<em>/100</em></strong><div className="hit-counts"><span className="head-count"><b>{status.heads}</b> HEAD</span><span className="body-count"><b>{status.hits - status.heads}</b> BODY</span><span className="miss-count"><b>{status.shots - status.hits}</b> MISS</span></div></div>
        <div className="hud-ammo"><small>{cosmeticLabel(progressionState.profile, status.equipped)}</small><strong data-testid="ammo">{status.slot===3?'--':status.remaining}{status.slot!==3&&status.equipped!=='zeus'&&<em>{`/ ${status.reserve ?? status.magazine}`}</em>}</strong><span>{status.reload?`${status.reloadSilent?'Silent reload':'Reloading'} ${status.reload.toFixed(1)} s`:status.recharge?`Recharge ${Math.ceil(status.recharge)}s`:!status.equipReady?'Drawing':status.firing ? 'Firing' : 'Ready'}</span>{status.slot!==3&&status.equipped!=='zeus'&&<button className="reload-pistol" disabled={status.remaining===status.magazine||!!status.reload||!status.reserve} onClick={()=>engine.current?.sim.reload()} title={`Reload ${equipmentNames[status.equipped]} (R)`}><RotateCcw size={13}/>Reload</button>}</div>
      </div>
      </div>
      {isDrillMode(settings.mode)&&<DrillPanel status={status} mode={settings.mode} challenge={settings.drillPace==='challenge'} peekDuration={settings.peekDuration} showTips={settings.showTips}/>}
      {!isDrillMode(settings.mode) && <aside className="drill-panel range-skill-panel" aria-label="Range skill coach">
        <div className="coach-heading"><span>SKILL REVIEW</span><span>{status.distance.toFixed(1)} m</span></div>
        {recentResult?.coaching ? <TipsDisplay showTips={settings.showTips}><CoachingReview summary={recentResult.coaching}/></TipsDisplay> : settings.showTips ? <>
          <h2>{settings.mode === 'transfer' ? 'Control A, acquire B' : 'Prepare, then control'}</h2>
          <p className="coach-instruction">{settings.mode === 'transfer' ? 'Keep one continuous spray: hit A, then transfer to B without releasing fire. Carry the recoil correction across; aim to connect within the first three B rounds.' : 'Pre-aim the first bullet and stop before firing. Keep the spray grouped before adding range or rounds; check the impacts, not just the crosshair.'}</p>
          <p className="coach-awaiting">Review first-bullet placement, stop-shoot timing and spray control after the attempt. Random spread is separate from your recoil correction.</p>
        </> : <p className="empty-state">No attempts yet.</p>}
      </aside>}
      </>}</Suspense>
    </section>
    <footer className="statusbar"><span><i className={settings.mode !== 'hearing' && status.active ? 'online' : ''} />{settings.mode === 'hearing' || combatMode ? modeNames[settings.mode] : status.input}</span><span className="status-center">{settings.mode === 'hearing' ? 'Native samples / browser spatial audio' : combatMode ? 'Simulation' : status.audio === 'unavailable' ? 'Audio unavailable' : status.slot===3?'250 u/s':`${Math.round(60 / equipmentStats(status.equipped).cycle)} RPM`}<span className="desktop-status">Build {gameData.build}</span></span><div className="project-links"><a href="https://github.com/HamzahAlrawi/cs2spraylab" target="_blank" rel="noreferrer"><Github size={14} />Source</a></div></footer>
    {notice && <div className="toast" role="status">{notice}<button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {panel && <div className="drawer-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setPanel(null); }}>
      <aside className={`drawer ${panel === 'history' || panel === 'changelog' || panel === 'drills' ? 'wide' : ''} ${panel === 'settings' ? 'settings-drawer' : ''}`} role="dialog" aria-modal="true" aria-labelledby="panel-title" tabIndex={-1} ref={drawer}>
        <div className="drawer-header"><div><small>SPRAYLAB</small><h1 id="panel-title">{panel === 'settings' ? 'Settings' : panel === 'weapons' ? 'Loadout' : panel === 'changelog' ? 'Changelog' : panel === 'drills' ? 'Choose a drill' : 'Session history'}</h1></div><button className="icon-button" aria-label="Close panel" title="Close panel" onClick={() => setPanel(null)}><X size={21} /></button></div>
        {panel === 'drills' && <DrillChooser mode={settings.mode} choose={chooseMode}/>}
        {panel === 'changelog' && <Suspense fallback={loading}><Changelog/></Suspense>}
        {panel === 'settings' && <>
          <div className="tabs settings-tabs" role="tablist" aria-label="Settings sections" onKeyDown={event => {
            if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = settingsTabs.findIndex(item => item.id === tab);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + settingsTabs.length) % settingsTabs.length;
            setTab(settingsTabs[next].id); document.getElementById(`settings-tab-${settingsTabs[next].id}`)?.focus();
          }}>{settingsTabs.map(item => <button key={item.id} id={`settings-tab-${item.id}`} role="tab" tabIndex={tab === item.id ? 0 : -1} aria-controls="settings-content" aria-selected={tab === item.id} onClick={() => {setTab(item.id); setResetPending(false);}}>{item.label}</button>)}</div>
          <div key={tab} id="settings-content" className="drawer-content" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} tabIndex={0}>
            {tab === 'game' && <>
              <MouseSettings settings={settings} onChange={update}/>
              <Toggle label="Invert mouse Y" checked={settings.invertY} onChange={v => update({ invertY: v })} />
              <Toggle label="Protect range Ctrl+W" checked={settings.protectShortcuts} onChange={protectShortcuts => update({protectShortcuts})}/>
            </>}
            {tab === 'training' && <>
              <div className="settings-context"><Target size={18}/><b>{modeNames[settings.mode]}</b></div>
              <h2>Training</h2>
              <Toggle label="Show coaching tips" checked={settings.showTips} onChange={showTips => update({showTips})}/>
              {settings.mode !== 'hearing' && <><Toggle label="Follow recoil" checked={settings.follow} onChange={v => update({follow: v})}/>
              <Toggle label="Practice spread" checked={combatMode || settings.spread} disabled={combatMode} onChange={v => update({spread: v})}/>
              {settings.showTips && <p className="setting-explanation">Spread includes random dispersion and inaccuracy from movement and firing. Turning it off does not remove recoil. Guided spray defaults off; combat modes always use it.</p>}</>}
              {!combatMode && settings.mode !== 'hearing' && <>
              <details className="settings-section" open={['guided','spray','transfer'].includes(settings.mode)}><summary>Spray & recoil</summary><div>
              <label className="select-row">Burst length<select aria-label="Burst length" value={settings.burst} onChange={e => update({ burst: +e.target.value })}><option value="0">Full magazine</option><option value="5">5 rounds</option><option value="10">10 rounds</option><option value="15">15 rounds</option></select></label>
              <label className="select-row">Transfer to B<select aria-label="Transfer trigger" value={settings.transferRule} onChange={e => update({transferRule: e.target.value as Settings['transferRule']})}><option value="bullet">After a bullet count</option><option value="kill">After A loses 100 health</option></select></label>
              {settings.transferRule === 'bullet' && <Slider label="Transfer after bullet" value={settings.transferAfter} min={1} max={weapon.magazine - 1} onChange={transferAfter => update({transferAfter})}/>}
              {settings.showTips && <p className="setting-explanation">Transfer targets have 100 health and no armor. Recoil continues across A and B. A short selected burst caps the transfer count before its last round.</p>}
              </div></details>
              <details className="settings-section" open={isDrillMode(settings.mode)}><summary>Peeking & movement</summary><div>
              <label className="select-row">Peeking angles<select aria-label="Peeking angles" value={settings.peekScenario} onChange={e=>update({peekScenario:e.target.value as Settings['peekScenario']})}><option value="mixed">Mixed situations</option><option value="common">Common angles</option><option value="deep">Deep holds</option><option value="off-angle">Off-angles</option><option value="elevated">Elevated holds</option></select></label>
              <Slider label="Peeking target duration" value={settings.peekDuration} min={.5} max={10} step={.25} suffix=" s" onChange={peekDuration=>update({peekDuration})}/>
              <label className="select-row">Counterstrafe / burst pace<select aria-label="Drill pace" value={settings.drillPace} onChange={e=>update({drillPace:e.target.value as Settings['drillPace']})}><option value="practice">Practice / 8 s exposure</option><option value="challenge">Challenge / 1.5 s exposure</option></select></label>
              <Toggle label="Moving target" checked={settings.moving} onChange={v => update({ moving: v })} />
              <label className="select-row">Target movement<select aria-label="Target movement" value={settings.targetSpeed} onChange={e => update({ targetSpeed: e.target.value as Settings['targetSpeed'] })}><option value="rifle">{weaponNames[settings.weapon]} / {weapon.speed} u/s</option><option value="smg">MP9 / 240 u/s</option><option value="knife">Knife / 250 u/s</option></select></label>
              </div></details>
              <details className="settings-section"><summary>Wall guides</summary><div>
              <Toggle label="Impact pattern (left)" checked={settings.showImpactPattern} onChange={v => update({ showImpactPattern: v })} />
              <Toggle label="Mouse movement (right)" checked={settings.showMousePath} onChange={v => update({ showMousePath: v })} />
              <Toggle label="Animated wall guides" checked={settings.animatedGuides} onChange={animatedGuides => update({animatedGuides})}/>
              </div></details>
              </>}
              {combatMode && <button className="secondary" onClick={() => {setFocusRange(false); setPanel(null);}}><Settings2 size={16}/>Open drill setup</button>}
              {settings.mode !== 'hearing' && <Slider label="Bullet impact size" value={settings.impactSize} min={.5} max={4} step={.25} suffix="x" onChange={impactSize=>update({impactSize})}/>}
            </>}
            {tab === 'data' && <>
              <h2>Audio</h2><Slider label="Weapon volume" value={Math.round(settings.volume * 100)} min={0} max={100} suffix="%" onChange={v => update({ volume: v / 100 })} />
              {!combatMode && settings.mode !== 'hearing' && <button className="secondary" disabled={!assetReady} onClick={async () => {await engine.current?.audio.unlock(selectedWeapon); engine.current?.audio.play(selectedWeapon, settings.volume);}}><Volume2 size={16}/>Test {weaponNames[selectedWeapon]}</button>}
              <h2>Graphics</h2><label className="select-row">Render quality<select aria-label="Render quality" value={settings.quality} onChange={e => update({ quality: e.target.value as Settings['quality'], ...(e.target.value === 'performance' ? {frameLimit:60} : {}) })}><option value="auto">Adaptive</option><option value="performance">Performance (older PCs)</option><option value="low">Low</option><option value="high">High</option></select></label>
              <label className="select-row">Frame limit<select aria-label="Frame limit" value={settings.frameLimit} onChange={e => update({frameLimit: +e.target.value})}>{[0,30,60,120,144,240].map(n => <option key={n} value={n}>{n ? `${n} FPS` : 'Display refresh rate'}</option>)}</select></label>
              <Toggle label="Show FPS counter" checked={settings.showFps} onChange={showFps => update({showFps})}/>
              <label className="select-row">Display aspect<select aria-label="Display aspect" value={settings.aspect} onChange={e => update({ aspect: e.target.value as Settings['aspect'] })}>{['native', '16:9', '16:10', '4:3', '5:4'].map(a => <option key={a} value={a}>{a === 'native' ? 'Native viewport' : `${a} stretched`}</option>)}</select></label>
            </>}
            {tab === 'controls' && <ControlsSettings value={settings.controls} onChange={controls => update({controls})}/>}
            {tab === 'crosshair' && <>
              <div className="crosshair-preview" aria-label="Crosshair preview"><div className="preview-target" /><CrosshairView value={settings.crosshair} /></div>
              <div className="presets">{Object.entries(presets).map(([name, value]) => <button key={name} aria-pressed={Object.entries(value).every(([key, entry]) => settings.crosshair[key as keyof Crosshair] === entry)} onClick={() => cross(value)}><div><CrosshairView value={value} /></div>{name}</button>)}</div>
              <label className="color-row">Color<input type="color" aria-label="Crosshair color" value={settings.crosshair.color} onChange={e => cross({ color: e.target.value })} /></label>
              <div className="swatches">{['#50ff76', '#52edff', '#ffef68', '#ffffff', '#ef79b3', '#f66556'].map(color => <button key={color} style={{ background: color }} aria-label={`Crosshair ${color}`} aria-pressed={settings.crosshair.color === color} onClick={() => cross({ color })}>{settings.crosshair.color === color && <Check size={14} color="#111" />}</button>)}</div>
              <Slider label="Length" value={settings.crosshair.size} min={0} max={20} step={.5} onChange={v => cross({ size: v })} />
              <Slider label="Gap" value={settings.crosshair.gap} min={-4} max={20} step={.5} onChange={v => cross({ gap: v })} />
              <Slider label="Thickness" value={settings.crosshair.thickness} min={.5} max={5} step={.5} onChange={v => cross({ thickness: v })} />
              <Slider label="Outline" value={settings.crosshair.outline} min={0} max={3} step={.5} onChange={v => cross({ outline: v })} />
              <Slider label="Opacity" value={settings.crosshair.alpha} min={.1} max={1} step={.05} onChange={v => cross({ alpha: v })} />
              <Toggle label="Center dot" checked={settings.crosshair.dot} onChange={v => cross({ dot: v })} />
              <Toggle label="T-style" checked={settings.crosshair.t} onChange={v => cross({ t: v })} />
              <Toggle label="Dynamic gap" checked={settings.crosshair.dynamic} onChange={v => cross({ dynamic: v })} />
            </>}
            {tab === 'data' && <details className="settings-section"><summary>Data, imports & exports</summary><div>
              <h2>Data provenance</h2><dl className="data-list"><dt>Weapon data build</dt><dd>{gameData.build}</dd><dt>Recoil math inspected</dt><dd>{recoilProvenance.build}</dd><dt>Cadence, speed, magazine</dt><dd>Game weapon data</dd><dt>Models & shot samples</dt><dd>Local Valve assets</dd><dt>Spray trajectory</dt><dd>{profiles[settings.weapon] ? 'Capture-fitted impulses' : 'Native seeds + recovered recoil math'}</dd><dt>Recoil recovery</dt><dd>Persistent punch + recoil index</dd></dl>
              <p className="settings-note">Weapon parameters match the latest local export. Recoil math was inspected on an earlier build; full trajectories, camera motion and subtick timing are not an exact CS2 reproduction.</p>
              <p className="data-note">Recoil and firing inaccuracy persist between trigger presses. Recovery math is derived from the installed client; subtick movement, spread RNG and animation blending are not an exact CS2 reproduction.</p>
              <label className="secondary file-button"><Upload size={16} />Import angular capture<input aria-label="Import angular capture" type="file" accept="application/json,.json" onChange={e => { void importProfile(e.target.files?.[0]); e.target.value = ''; }} /></label>
              {profiles[settings.weapon] && <><p className="data-note">{profiles[settings.weapon]?.source} / build {profiles[settings.weapon]?.build}</p><button className="secondary" onClick={() => { const next = { ...profiles }; delete next[settings.weapon]; setProfiles(next); try { localStorage.setItem('spraylab.profiles.v1', JSON.stringify(next)); } catch { setNotice('Storage unavailable.'); } }}>Remove capture</button></>}
              <button className="secondary" onClick={() => download('spraylab-session.json', { settings, results, legacy, profiles, performance: engine.current?.performanceReport() })}><Download size={16} />Export session</button>
            </div></details>}
          </div>
          {resetPending && <div className="reset-confirm" role="status"><span>Reset all settings? Your progress and unlocks stay.</span><button className="secondary" onClick={() => setResetPending(false)}>Cancel</button><button className="primary" onClick={() => {setSettings({...defaults, controls: {...defaults.controls}, crosshair: {...defaults.crosshair}}); setResetPending(false); setNotice('Settings restored.');}}>Reset settings</button></div>}
          <div className="drawer-footer"><button className="secondary" onClick={() => setResetPending(true)}><RotateCcw size={15} />Restore defaults</button><span>Saved automatically</span><button className="primary" onClick={() => setPanel(null)}><Check size={16} />Done</button></div>
        </>}
        {panel === 'weapons' && <div className="drawer-content arsenal">
          <Toggle label="Carry a primary weapon" checked={settings.primaryEnabled} onChange={primaryEnabled=>update({primaryEnabled})}/>
          <label className="select-row">Sidearm<select aria-label="Sidearm" value={settings.sidearm} onChange={e=>update({sidearm:e.target.value as Pistol})}>{pistolIds.map(id=><option key={id} value={id}>{weaponNames[id]}</option>)}</select></label>
          {settings.primaryEnabled && settings.weapon !== settings.sidearm && <label className="select-row">Finishes for<select aria-label="Skin weapon" value={finishSlot} onChange={e=>setFinishSlot(+e.target.value as 1 | 2)}><option value="1">{weaponNames[settings.weapon]}</option><option value="2">{weaponNames[settings.sidearm]}</option></select></label>}
          <LoadoutFinishes equipment={settings.primaryEnabled && finishSlot === 1 ? settings.weapon : settings.sidearm} profile={progressionState.profile} controller={progression} focusRequest={finishFocusRequest} onShop={id=>{setPanel(null);setArmoryRequest(id);}}/>
          <h2>Weapons</h2><div className="search-field"><Search size={17}/><input type="search" aria-label="Find a weapon" placeholder="Search weapons" value={weaponSearch} onChange={event => setWeaponSearch(event.target.value)}/>{weaponSearch && <button className="icon-button" aria-label="Clear weapon search" onClick={() => setWeaponSearch('')}><X size={15}/></button>}</div>
          <div className="weapon-filters" role="group" aria-label="Weapon categories">{weaponGroups.map(group => <button key={group} aria-pressed={weaponFilter === group} onClick={() => setWeaponFilter(group)}>{group}</button>)}</div>
          {!weaponIds.some(id => matchesWeapon(id, weaponFilter, weaponSearch)) && <div className="search-empty" role="status"><strong>No matching weapons</strong><button className="secondary" onClick={() => {setWeaponSearch('');setWeaponFilter('All');}}>Clear filters</button></div>}
          {weaponIds.filter(id => matchesWeapon(id, weaponFilter, weaponSearch)).map(id => <button className={`weapon-item ${selectedWeapon === id ? 'chosen' : ''}`} key={id} onClick={() => {
            const sidearm = pistolIds.includes(id as Pistol);
            update(sidearm ? {sidearm: id as Pistol, primaryEnabled:false} : {weapon:id,primaryEnabled:true});
            if (cosmeticsForEquipment(progressionState.profile, progression.catalog, id).some(item => !item.isDefault)) {
              setFinishSlot(sidearm ? 2 : 1); setFinishFocusRequest(request => request + 1);
            } else setPanel(null);
          }}><img src={cosmeticPreview(progressionState.profile,id)} alt={weaponNames[id]} /><span><b>{weaponNames[id]}</b><small>{gameData.weapons[id].magazine} rounds <i /> {Math.round(60 / gameData.weapons[id].cycle)} RPM</small></span>{id === selectedWeapon && <Check size={18} />}</button>)}</div>}
        {panel === 'history' && <div className="drawer-content history">
          <div className="session-summary"><div><small>ATTEMPTS</small><b>{results.length}</b></div><div><small>AVG. HIT RATE</small><b>{results.filter(r => r.shots).length ? Math.round(results.filter(r => r.shots).reduce((n, r) => n + r.hits / r.shots * 100, 0) / results.filter(r => r.shots).length) : 0}%</b></div><button className="icon-button" aria-label="Export history" title="Export history" onClick={() => download('spraylab-history.json', { results, legacy })}><Download size={18} /></button></div>
          {selected && <section className="replay"><div className="section-title"><h2>{equipmentNames[selected.weapon]} / {historyModeNames[selected.mode]}</h2><span>{selected.mode === 'tracking' ? `${selected.tracking.toFixed(1)}%` : `${selected.hits}/${selected.shots}`}</span></div>{selected.drill ? <DrillReview value={selected.drill} showTips={settings.showTips}/> : selected.coaching && <TipsDisplay showTips={settings.showTips}><CoachingReview summary={selected.coaching}/></TipsDisplay>} {selected.samples.length > 0 && <><svg viewBox="0 0 400 240" role="img" aria-label="Shot replay, metres relative to target head"><path d="M200 0V240M0 120H400" stroke="#47524d" strokeDasharray="3 5" /><circle cx="200" cy="120" r="10" fill="none" stroke="#8daba0" /><path d="M182 139h36v42h-36z" fill="#394943" />{selected.samples.slice(0, replay).map((s, i) => <g key={i}><circle cx={200 + Math.max(-190, Math.min(190, s.x * 70))} cy={120 - Math.max(-110, Math.min(110, s.y * 70))} r="3" fill={s.head ? '#e6cf6b' : s.hit ? '#6ddbb1' : '#ed9186'} /><title>Round {s.bullet}: {s.x.toFixed(2)}m, {s.y.toFixed(2)}m</title></g>)}</svg><Slider label="Replay round" value={replay} min={0} max={selected.samples.length} onChange={setReplay} /></>}</section>}
          <h2>Recent attempts</h2>{!results.length && <p className="empty-state">No attempts yet.</p>}{results.map(r => <button key={r.id} className={`history-row ${selected?.id === r.id ? 'selected' : ''}`} onClick={() => { setSelected(r); setReplay(r.samples.length); }}><span><b>{equipmentNames[r.weapon]}</b><small>{historyModeNames[r.mode]} / {new Date(r.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span><strong>{r.coaching?.score == null ? 'Unscored' : `${Math.round(r.coaching.score)}/100`}</strong><ChevronDown size={14} /></button>)}
          {legacy.length > 0 && <><h2>Previous-version history</h2>{legacy.map(r => <div className="history-row" key={r.id}><span>{r.weaponName}<small>{new Date(r.createdAt).toLocaleDateString()}</small></span><b>{r.scores.overall} score</b></div>)}</>}
        </div>}
      </aside>
    </div>}
    {tutorial && <Suspense fallback={<div className="lesson-backdrop">{loading}</div>}><MovementTutorial initialLesson={lesson} close={closeLesson} practice={closeLesson}/></Suspense>}
  </main></CoachingActions.Provider>;
}
