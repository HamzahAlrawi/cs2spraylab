import {lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {ArrowRight, Eye, Hand, Pause, Play, RotateCcw, ScanLine, Settings2, Shield, Target, X, Film} from 'lucide-react';
import {gameData, loadoutWeapon, type Settings} from '../config';
import {botConfig, restoreDuelConfig, sanitizeDuelConfig, type BotOverride, type DuelConfig} from './config';
import {DuelEngine, type DuelStatus} from './DuelEngine';
import './duel.css';
import {equipmentNames, equipmentStats, type Slot, type Equipment} from '../equipment';
import {DuelScorecard} from './DuelScorecard';
import type {ProgressionController} from '../progression';
import {cosmeticPreview, cosmeticLabel} from '../cosmetics';
import {DuelSetup} from './DuelSetup';
import type {PrefireSession} from '../prefire/session';
import type {PrefireConfig} from '../prefire/config';
import {describeShotState} from '../shot-state';
import {TipsDisplay} from '../DrillPanel';
import {CombatReview} from './CombatReview';
import type {CombatRecording, ReplayShot} from './combat-replay';
import {CoachingActions} from '../CoachingReview';
import {PrefireNavigation} from '../prefire/PrefireNavigation';
import type {RealMapSession} from './real-map';
import {prefetchCombatModels} from '../combat-model-delivery';
import {KillFeed} from './KillFeed';
import {setupKey} from '../setup-key';
import {equipmentKeyLabel} from '../controls';
import {emptyUtilityInventory, UtilityHud, UtilityLoadout, utilityLabels} from './utility-ui';
const PrefireSetup = lazy(() => import('../prefire/PrefireSetup').then(module => ({default: module.PrefireSetup})));

const initialStatus: DuelStatus = {phase: 'ready', paused: false, health: 100, armor: 100,
  ammo: 30, reloading: false, enemies: 1, seconds: 0, kills: 0, damage: 0, input: 'Ready', caption: '',
  shortcutProtected: false, nextRoundIn: 0};

function loadConfig(): DuelConfig {
  try {return restoreDuelConfig(localStorage.getItem('spraylab.duel.v1'));}
  catch {return restoreDuelConfig(null);}
}

function loadHint() {
  try {return localStorage.getItem('spraylab.duel.hint.v1') !== 'seen';}
  catch {return true;}
}

export function DuelStage({settings, openSettings, onEnter, suspended, progression, cosmeticRevision, prefire}: {settings: Settings; openSettings: () => void; onEnter: () => void; suspended: boolean; progression?: ProgressionController; cosmeticRevision?: Readonly<Record<string,string>>;
  prefire?: {session: PrefireSession; config: PrefireConfig; update: (patch: Partial<PrefireConfig>) => void; showTips?: boolean}}) {
  const [config, setConfig] = useState(loadConfig);
  const [status, setStatus] = useState<DuelStatus>(initialStatus);
  const profileSetupKey = useMemo(() => setupKey([config, {primary: status.loadout?.primary ?? null, sidearm: status.loadout?.sidearm ?? null}]),
    [config, status.loadout?.primary, status.loadout?.sidearm]);
  const [hint, setHint] = useState(loadHint);
  const [panel, setPanel] = useState<'setup' | 'review'>('setup');
  const [error, setError] = useState('');
  const [loadingMap, setLoadingMap] = useState(!prefire && !config.generatedMaps);
  const [recording, setRecording] = useState<CombatRecording>();
  const [weaponToAdd, setWeaponToAdd] = useState<Equipment>('m4a4');
  const canvasHost = useRef<HTMLDivElement>(null);
  const crosshair = useRef<HTMLDivElement>(null);
  const engine = useRef<DuelEngine>();
  const latest = useRef({settings,config});latest.current={settings,config};
  const {record: recordRound} = useContext(CoachingActions);
  useEffect(() => {
    const round = status.completedRound;
    if (!prefire && round?.review.coaching) recordRound?.(round.id, round.setupKey, round.review.coaching);
  }, [status.completedRound, recordRound, !!prefire]);
  const showReplay = useCallback((shot: ReplayShot | undefined, time: number, overview: boolean, diagnostic: boolean) => {
    if (recording) engine.current?.showReplay(recording, shot, time, overview, diagnostic);
  }, [recording]);
  const closeReplay = useCallback(() => {engine.current?.closeReplay(); setRecording(undefined);}, []);

  useEffect(() => {
    if (!canvasHost.current) return;
    const abort=new AbortController();let instance:DuelEngine|undefined,session:RealMapSession|undefined;
    void prefetchCombatModels(['/models/target.glb','/models/duel-motion.glb','/models/duel-flinches.glb',
      `/models/view-${loadoutWeapon(latest.current.settings)}.glb`],abort.signal).catch(()=>{});
    setError('');setLoadingMap(!prefire && !config.generatedMaps);setStatus(initialStatus);
    void (async()=>{
      try {
        if(!prefire && !config.generatedMaps) {
          const {RealMapSession}=await import('./real-map');
          session=await RealMapSession.load(latest.current.config,Math.floor(Math.random()*0x7fffffff),abort.signal);
        }
        abort.signal.throwIfAborted();
        session?.configureDuel(latest.current.config);
        instance=new DuelEngine(canvasHost.current!,crosshair.current!,setStatus,setError,latest.current.settings,latest.current.config,progression,prefire?.session??session);
        engine.current=instance;setLoadingMap(false);
      }catch(error) {
        if(abort.signal.aborted)return;
        session?.dispose();setLoadingMap(false);
        setError(error instanceof Error ? error.message : 'WebGL could not start. Enable hardware acceleration and reload.');
      }
    })();
    return () => {abort.abort();instance?.dispose();session?.dispose();if(engine.current===instance)engine.current=undefined;};
  }, [prefire?.session,config.generatedMaps]);
  useEffect(() => {if (prefire) {closeReplay(); prefire.session.configure(prefire.config); engine.current?.restart();}}, [prefire?.config, closeReplay]);
  useEffect(() => {engine.current?.setSettings(settings);}, [settings]);
  useEffect(() => {closeReplay(); void engine.current?.refreshCosmetics();}, [cosmeticRevision, closeReplay]);
  useEffect(() => {if (suspended) engine.current?.pause();}, [suspended]);
  useEffect(() => {
    closeReplay();
    if (prefire && engine.current) engine.current.setConfig({...engine.current.sim.config,
      utilitiesEnabled: config.utilitiesEnabled, botUtilities: config.botUtilities, utilityLoadout: config.utilityLoadout});
    else engine.current?.setConfig(config);
    try {localStorage.setItem('spraylab.duel.v1', JSON.stringify(config));} catch { /* Session-only configuration. */ }
  }, [config]);

  const update = useCallback((patch: Partial<DuelConfig>) => setConfig(previous => sanitizeDuelConfig({...previous, ...patch})), []);
  const updateBot = useCallback((index: number, patch: BotOverride) => setConfig(previous => {
    const overrides = [...previous.overrides];
    overrides[index] = {...overrides[index], ...patch};
    return sanitizeDuelConfig({...previous, overrides});
  }), []);
  const customizeBot = useCallback((index: number, enabled: boolean) => setConfig(previous => {
    const overrides = [...previous.overrides];
    overrides[index] = enabled ? {...botConfig(previous, index)} : {};
    return sanitizeDuelConfig({...previous, overrides});
  }), []);
  const dismissHint = () => {
    setHint(false);
    try {localStorage.setItem('spraylab.duel.hint.v1', 'seen');} catch { /* Hint may repeat without storage. */ }
  };
  const busy=loadingMap || status.loadingMap;
  const alive = (status.phase === 'fighting'||status.postWinPlayable) && !status.paused && (!busy||status.preparingNextRound);
  const playing = status.phase !== 'ready' && !status.paused;
  const showTips = prefire?.showTips ?? settings.showTips ?? true;
  const review = status.prefire ?? status.review;
  const equipped = status.equipped ?? loadoutWeapon(settings);
  const profile = progression?.getSnapshot().profile;
  const label = (id: typeof equipped) => profile ? cosmeticLabel(profile, id) : equipmentNames[id];
  const crosshairStyle = {'--cross-color': settings.crosshair.color, '--cross-size': `${settings.crosshair.size}px`,
    '--cross-gap': `${settings.crosshair.gap}px`, '--cross-thickness': `${settings.crosshair.thickness}px`,
    '--cross-outline': `${settings.crosshair.outline}px`, opacity: settings.crosshair.alpha} as CSSProperties;

  return <div className="duel-layout">
    <div className={`duel-view${recording ? ' replaying' : ''}`}>
      <div className="duel-canvas" ref={canvasHost} aria-busy={!!busy}/>
      <div className="duel-topline"><span className="range-badge"><i />{prefire ? `DUST 2 / ${status.prefire?.routeName ?? 'PREFIRE'}` : !config.generatedMaps ? status.arenaDesign ?? 'DUST 2 / AI DUEL' : 'AI DUEL'}</span><span>{status.enemies} {status.enemies === 1 ? 'ENEMY' : 'ENEMIES'} LEFT</span></div>
      <div className="duel-live-overlay"><div className="duel-tools"><div className="equipment-slots" role="group" aria-label="Duel equipment">
        {([1,2,3,4] as Slot[]).filter(slot=>(slot!==1||(status.loadout ? !!status.loadout.primary : settings.primaryEnabled))&&(slot!==2||!status.loadout||!!status.loadout.sidearm)).map(slot => {const id = slot === 1 ? status.loadout?.primary ?? settings.weapon : slot === 2 ? status.loadout?.sidearm ?? settings.sidearm : slot===4?'zeus':'knife';
          const keyLabel = equipmentKeyLabel(settings.controls, slot);
          return <button key={slot} aria-pressed={!status.selectedUtility && equipped === id} title={`${label(id)} (${keyLabel})`} aria-label={`Equip ${equipmentNames[id]}`} onClick={() => engine.current?.equip(slot)}><span>{keyLabel}</span><img src={profile ? cosmeticPreview(profile,id) : `/models/${id}.png`} alt=""/></button>;})}
      </div>
      <UtilityHud inventory={status.utilityInventory ?? emptyUtilityInventory} selected={status.selectedUtility} disabled={!!busy || !!recording || !alive && status.phase !== 'ready'} canThrow={alive}
        onSelect={kind => engine.current?.selectUtility(kind)} onThrow={lob => engine.current?.throwUtility(lob)}/>
      {!status.selectedUtility && <div className="weapon-action-tools"><button className="icon-button" aria-label="Inspect weapon" title="Inspect weapon (F)" onClick={()=>engine.current?.inspect()}><Eye size={16}/></button>
        {equipped !== 'knife' && (gameData.weapons[equipped].zoomLevels > 0 || gameData.weapons[equipped].hasBurst || gameData.weapons[equipped].isRevolver) && <button className="icon-button" aria-label="Secondary weapon mode" title={equipped === 'revolver' ? 'Quick alternate shot (right click)' : 'Scope / burst mode (right click)'} onClick={()=>engine.current?.secondary()}><ScanLine size={16}/></button>}</div>}
      {playing && <div className="duel-exit"><span>Press ESC to exit</span><button className="icon-button" aria-label="Pause duel" title="Pause duel" onClick={() => engine.current?.pause()}><Pause size={16}/></button></div>}
      {alive && status.input !== 'Touch' && !status.shortcutProtected && <div className="duel-shortcut-warning" role="status">C to crouch. Ctrl+W may close this tab.</div>}
      </div>
      <KillFeed entries={status.killFeed} replaying={!!recording}/>
      </div>
      {prefire?.config.navigationHints && playing && status.prefire?.navigation && <PrefireNavigation navigation={status.prefire.navigation}/>}
      <div className="follow-origin" ref={crosshair} aria-hidden="true"><div className={`crosshair ${settings.crosshair.t ? 't-style' : ''} ${settings.crosshair.size === 0 ? 'dot-only' : ''}`} style={crosshairStyle}>
        <i className="arm top"/><i className="arm right"/><i className="arm bottom"/><i className="arm left"/>{settings.crosshair.dot&&<i className="dot"/>}
      </div></div>
      {status.phase !== 'ready' && status.caption && <div className="duel-caption" role="status">{status.caption}</div>}
      {prefire && alive && status.lastShot && <div className="prefire-shot-cue" aria-label="Last shot state">{describeShotState(status.lastShot.state).label}</div>}
      {showTips && prefire && status.phase === 'fighting' && status.prefire?.feedback && <div className="prefire-live-feedback" role="status">
        <small>{status.prefire.feedback.angle}</small><strong>{status.prefire.feedback.message}</strong><p>{status.prefire.feedback.tip}</p>
      </div>}
      {alive && (status.pickup || status.pickupUtility) && <button className="pickup-prompt" title="Pick up item (E)" onClick={()=>engine.current?.pickup()}><Hand size={15}/>E <span>Pick up {status.pickupUtility ? utilityLabels[status.pickupUtility] : equipmentNames[status.pickup!]}</span></button>}
      {alive && status.interaction && !status.pickup && !status.pickupUtility && <button className="pickup-prompt" title={`${status.interaction} (E)`} onClick={()=>engine.current?.sim.command(0,{usePressed:true})}><Hand size={15}/>E <span>{status.interaction}</span></button>}
      {status.phase === 'result' && <div className={`duel-result ${status.outcome}`} role="status"><strong>{prefire ? status.outcome === 'won' ? 'Route cleared' : 'Try the route again' : status.outcome === 'won' ? 'Round won' : status.outcome === 'lost' ? 'Round lost' : 'Draw'}</strong>
        <span>{status.paused ? 'Paused' : status.nextRoundError ? 'Next round unavailable. You can keep playing.' : status.preparingNextRound ? 'Preparing next round…' : `Next round in ${status.nextRoundIn.toFixed(1)}s`}</span>
        {status.nextRoundError&&<button className="duel-next-retry" onClick={()=>engine.current?.restart(true)}><RotateCcw size={14}/>Retry next round</button>}
        {review && (showTips ? <><b>{review.coaching?.focus ?? review.message}</b><p className="duel-result-evidence">{review.coaching?.evidence}</p><p>{review.coaching?.action ?? review.tip}</p></>
          : review.coaching?.evidence && <p>{review.coaching.evidence}</p>)}</div>}
      {recording && <CombatReview key={`${recording.seed}:${recording.shots[recording.shots.length - 1]?.id}`} recording={recording} show={showReplay} close={closeReplay} suspended={suspended} download={() => engine.current?.exportReplay(recording)}/>}
      {busy && !status.preparingNextRound && !error && <div className="duel-entry" role="status"><span className="workflow-loading">Loading map chunk…</span></div>}
      {(status.phase === 'ready' || status.paused) && !busy && !error && !recording && <div className="duel-entry">
        <button className="enter-range" onClick={() => {dismissHint(); onEnter(); void engine.current?.enter();}}><Play size={17} fill="currentColor"/>
          {prefire ? status.paused ? 'Resume prefire' : 'Enter prefire' : status.paused ? 'Resume duel' : 'Enter duel'}
        </button>
      </div>}
      {error && <div className="range-error" role="alert"><Shield size={24}/><p>{error}</p><button onClick={() => location.reload()}><RotateCcw size={16}/>Reload</button></div>}
      <div className="duel-hud">
        <div className="duel-health"><small>HEALTH</small><strong>{Math.ceil(status.health)}</strong><span><Shield size={13}/>{Math.ceil(status.armor)} armor</span></div>
        <div className="duel-round"><span>{status.kills} KILLS</span><strong>{prefire ? status.seconds.toFixed(1) : Math.max(0, Math.ceil(config.roundSeconds - status.seconds))}<small> s</small></strong><span>{Math.round(status.damage)} DAMAGE</span></div>
        <div className="duel-ammo"><small>{status.selectedUtility ? utilityLabels[status.selectedUtility] : label(equipped)}</small><strong>{status.selectedUtility ? status.utilityInventory?.[status.selectedUtility] ?? 0 : equipped === 'knife' ? '--' : status.ammo}{!status.selectedUtility && equipped !== 'knife' && equipped!=='zeus' && <em> / {status.reserve ?? equipmentStats(equipped).reserve}</em>}</strong><span>{status.selectedUtility ? 'UTILITY' : status.reloading ? status.reloadSilent?'Silent reload':'Reloading' : equipped==='zeus'&&status.recharge?`Recharge ${Math.ceil(status.recharge)}s`:status.input}</span>{!status.selectedUtility && equipped !== 'knife' && equipped!=='zeus' && <button className="reload-pistol" title="Reload (R)" disabled={!alive || status.reloading || !status.reserve || status.ammo === equipmentStats(equipped).magazine} onClick={() => engine.current?.sim.command(0, {reloadPressed: true})}><RotateCcw size={13}/>Reload</button>}</div>
      </div>
    </div>
    <aside className={`duel-controls${prefire ? ' prefire-panel' : ''}`} aria-label={prefire ? 'Prefire settings' : 'Duel settings'}>
      {!prefire && <div className="duel-controls-head"><div><small>DRILL SETUP</small><h2>AI Duel</h2></div><button className="icon-button" title="New round" aria-label="New duel round" onClick={() => {closeReplay(); engine.current?.restart();}}><RotateCcw size={17}/></button></div>}
      {!prefire && <div className="tabs" role="tablist" aria-label="Duel panel"><button role="tab" aria-selected={panel === 'setup'} onClick={() => setPanel('setup')}>Setup</button><button role="tab" aria-selected={panel === 'review'} onClick={() => setPanel('review')}>Scorecard</button></div>}
      {showTips && !prefire && hint && <div className="duel-hint" role="status"><ArrowRight size={18}/><span>Set up your opponent here</span><button aria-label="Dismiss duel hint" title="Dismiss hint" onClick={dismissHint}><X size={14}/></button></div>}
      {prefire ? <Suspense fallback={<div className="workflow-loading" role="status">Loading drill settings</div>}><PrefireSetup config={prefire.config} update={patch => prefire.update({...patch,
        routeId: patch.routeId ?? status.prefire?.routeId ?? prefire.config.routeId})}
        routes={prefire.session.routes} catalog={prefire.session.catalog} routeId={status.prefire?.routeId ?? prefire.config.routeId} stats={status.prefire} lastShot={status.lastShot} showTips={showTips}
        onNext={() => prefire.update({routeId: prefire.session.routes[(prefire.session.routeIndex + 1) % prefire.session.routes.length].id, lineupId: undefined})}
        onRepeat={() => engine.current?.restart()}/></Suspense>
        : panel === 'review' ? <div className="duel-controls-body"><TipsDisplay showTips={showTips}><DuelScorecard review={status.review} completedReview={status.completedRound?.review} history={status.history ?? []}
          setupKey={profileSetupKey} completedSetupKey={status.completedRound?.setupKey}/></TipsDisplay></div> : <DuelSetup config={config} arenaDesign={status.arenaDesign} weaponToAdd={weaponToAdd} setWeaponToAdd={setWeaponToAdd} update={update} updateBot={updateBot} customizeBot={customizeBot}/>}
      {prefire && <UtilityLoadout config={config} update={update}/>}
      <button className="combat-review-launch" disabled={!!busy || !status.replayAvailable} onClick={() => setRecording(engine.current?.openReplay())}><Film size={15}/>Review fight</button>
      <div className="duel-controls-foot"><button onClick={openSettings}><Settings2 size={15}/>Mouse & crosshair</button>{showTips && <span><Target size={13}/>Changes start a new round</span>}</div>
    </aside>
  </div>;
}
