import {useCallback, useEffect, useRef, useState, type CSSProperties} from 'react';
import {ArrowRight, Eye, Hand, Pause, Play, RotateCcw, ScanLine, Settings2, Shield, Target, X} from 'lucide-react';
import {gameData, loadoutWeapon, type Settings} from '../config';
import {botConfig, sanitizeDuelConfig, type BotOverride, type DuelConfig} from './config';
import {DuelEngine, type DuelStatus} from './DuelEngine';
import './duel.css';
import {equipmentNames, equipmentStats, type Slot, type Equipment} from '../equipment';
import {DuelScorecard} from './DuelScorecard';
import type {ProgressionController} from '../progression';
import {cosmeticPreview, cosmeticLabel} from '../cosmetics';
import {DuelSetup} from './DuelSetup';

const initialStatus: DuelStatus = {phase: 'ready', paused: false, health: 100, armor: 100,
  ammo: 30, reloading: false, enemies: 1, seconds: 0, kills: 0, damage: 0, input: 'Ready', caption: '',
  shortcutProtected: false, nextRoundIn: 0};

function loadConfig(): DuelConfig {
  try {return sanitizeDuelConfig(JSON.parse(localStorage.getItem('spraylab.duel.v1') || '{}'));}
  catch {return sanitizeDuelConfig({});}
}

function loadHint() {
  try {return localStorage.getItem('spraylab.duel.hint.v1') !== 'seen';}
  catch {return true;}
}

export function DuelStage({settings, openSettings, onEnter, suspended, progression, cosmeticRevision}: {settings: Settings; openSettings: () => void; onEnter: () => void; suspended: boolean; progression?: ProgressionController; cosmeticRevision?: Readonly<Record<string,string>>}) {
  const [config, setConfig] = useState(loadConfig);
  const [status, setStatus] = useState<DuelStatus>(initialStatus);
  const [hint, setHint] = useState(loadHint);
  const [panel, setPanel] = useState<'setup' | 'review'>('setup');
  const [error, setError] = useState('');
  const [weaponToAdd, setWeaponToAdd] = useState<Equipment>('m4a4');
  const canvasHost = useRef<HTMLDivElement>(null);
  const crosshair = useRef<HTMLDivElement>(null);
  const engine = useRef<DuelEngine>();

  useEffect(() => {
    if (!canvasHost.current) return;
    try {engine.current = new DuelEngine(canvasHost.current, crosshair.current!, setStatus, setError, settings, config, progression);}
    catch {setError('WebGL could not start. Enable hardware acceleration and reload.');}
    return () => {engine.current?.dispose(); engine.current = undefined;};
  }, []);
  useEffect(() => {engine.current?.setSettings(settings);}, [settings]);
  useEffect(() => {void engine.current?.refreshCosmetics();}, [cosmeticRevision]);
  useEffect(() => {if (suspended) engine.current?.pause();}, [suspended]);
  useEffect(() => {
    engine.current?.setConfig(config);
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
  const alive = status.phase === 'fighting' && !status.paused;
  const playing = status.phase !== 'ready' && !status.paused;
  const equipped = status.equipped ?? loadoutWeapon(settings);
  const profile = progression?.getSnapshot().profile;
  const label = (id: typeof equipped) => profile ? cosmeticLabel(profile, id) : equipmentNames[id];
  const crosshairStyle = {'--cross-color': settings.crosshair.color, '--cross-size': `${settings.crosshair.size}px`,
    '--cross-gap': `${settings.crosshair.gap}px`, '--cross-thickness': `${settings.crosshair.thickness}px`,
    '--cross-outline': `${settings.crosshair.outline}px`, opacity: settings.crosshair.alpha} as CSSProperties;

  return <div className="duel-layout">
    <div className="duel-view">
      <div className="duel-canvas" ref={canvasHost} />
      <div className="duel-topline"><span className="range-badge"><i />AI DUEL</span><span>{status.enemies} {status.enemies === 1 ? 'ENEMY' : 'ENEMIES'} LEFT</span></div>
      <div className="duel-tools"><div className="equipment-slots" role="group" aria-label="Duel equipment">
        {([1,2,3,4] as Slot[]).filter(slot=>(slot!==1||(status.loadout ? !!status.loadout.primary : settings.primaryEnabled))&&(slot!==2||!status.loadout||!!status.loadout.sidearm)).map(slot => {const id = slot === 1 ? status.loadout?.primary ?? settings.weapon : slot === 2 ? status.loadout?.sidearm ?? settings.sidearm : slot===4?'zeus':'knife';
          return <button key={slot} aria-pressed={equipped === id} title={`${label(id)} (${slot})`} aria-label={`Equip ${equipmentNames[id]}`} onClick={() => engine.current?.equip(slot)}><span>{slot}</span><img src={profile ? cosmeticPreview(profile,id) : `/models/${id}.png`} alt=""/></button>;})}
      </div>
      <div className="weapon-action-tools"><button className="icon-button" aria-label="Inspect weapon" title="Inspect weapon (F)" onClick={()=>engine.current?.inspect()}><Eye size={16}/></button>
        {equipped !== 'knife' && (gameData.weapons[equipped].zoomLevels > 0 || gameData.weapons[equipped].hasBurst || gameData.weapons[equipped].isRevolver) && <button className="icon-button" aria-label="Secondary weapon mode" title={equipped === 'revolver' ? 'Quick alternate shot (right click)' : 'Scope / burst mode (right click)'} onClick={()=>engine.current?.secondary()}><ScanLine size={16}/></button>}</div>
      {playing && <div className="duel-exit"><span>Press ESC to exit</span><button className="icon-button" aria-label="Pause duel" title="Pause duel" onClick={() => engine.current?.pause()}><Pause size={16}/></button></div>}
      {alive && !status.shortcutProtected && <div className="duel-shortcut-warning" role="status">C to crouch. Ctrl+W may close this tab.</div>}
      </div>
      <div className="follow-origin" ref={crosshair} aria-hidden="true"><div className={`crosshair ${settings.crosshair.t ? 't-style' : ''} ${settings.crosshair.size === 0 ? 'dot-only' : ''}`} style={crosshairStyle}>
        <i className="arm top"/><i className="arm right"/><i className="arm bottom"/><i className="arm left"/>{settings.crosshair.dot&&<i className="dot"/>}
      </div></div>
      {status.phase !== 'ready' && status.caption && <div className="duel-caption" role="status">{status.caption}</div>}
      {alive && status.pickup && <button className="pickup-prompt" title="Pick up weapon (E)" onClick={()=>engine.current?.pickup()}><Hand size={15}/>E <span>Pick up {equipmentNames[status.pickup]}</span></button>}
      {alive && status.interaction && !status.pickup && <button className="pickup-prompt" title={`${status.interaction} (E)`} onClick={()=>engine.current?.sim.command(0,{usePressed:true})}><Hand size={15}/>E <span>{status.interaction}</span></button>}
      {status.phase === 'result' && <div className={`duel-result ${status.outcome}`} role="status"><strong>{status.outcome === 'won' ? 'Round won' : status.outcome === 'lost' ? 'Round lost' : 'Draw'}</strong>
        <span>{status.paused ? 'Paused' : `Next round in ${status.nextRoundIn.toFixed(1)}s`}</span>
        {status.review && <><b>{status.review.message}</b><p>{status.review.tip}</p></>}</div>}
      {(status.phase === 'ready' || status.paused) && !error && <div className="duel-entry">
        <button className="enter-range" onClick={() => {dismissHint(); onEnter(); void engine.current?.enter();}}><Play size={17} fill="currentColor"/>
          {status.paused ? 'Resume duel' : 'Enter duel'}
        </button>
      </div>}
      {error && <div className="range-error" role="alert"><Shield size={24}/><p>{error}</p><button onClick={() => location.reload()}><RotateCcw size={16}/>Reload</button></div>}
      <div className="duel-hud">
        <div className="duel-health"><small>HEALTH</small><strong>{Math.ceil(status.health)}</strong><span><Shield size={13}/>{Math.ceil(status.armor)} armor</span></div>
        <div className="duel-round"><span>{status.kills} KILLS</span><strong>{Math.max(0, Math.ceil(config.roundSeconds - status.seconds))}<small> s</small></strong><span>{Math.round(status.damage)} DAMAGE</span></div>
        <div className="duel-ammo"><small>{label(equipped)}</small><strong>{equipped === 'knife' ? '--' : status.ammo}{equipped !== 'knife' && equipped!=='zeus' && <em> / {status.reserve ?? equipmentStats(equipped).reserve}</em>}</strong><span>{status.reloading ? status.reloadSilent?'Silent reload':'Reloading' : equipped==='zeus'&&status.recharge?`Recharge ${Math.ceil(status.recharge)}s`:status.input}</span>{equipped !== 'knife' && equipped!=='zeus' && <button className="reload-pistol" title="Reload (R)" disabled={!alive || status.reloading || !status.reserve || status.ammo === equipmentStats(equipped).magazine} onClick={() => engine.current?.sim.command(0, {reloadPressed: true})}><RotateCcw size={13}/>Reload</button>}</div>
      </div>
    </div>
    <aside className="duel-controls" aria-label="Duel settings">
      <div className="duel-controls-head"><div><small>DRILL SETUP</small><h2>AI Duel</h2></div><button className="icon-button" title="New round" aria-label="New duel round" onClick={() => engine.current?.restart()}><RotateCcw size={17}/></button></div>
      <div className="tabs" role="tablist" aria-label="Duel panel"><button role="tab" aria-selected={panel === 'setup'} onClick={() => setPanel('setup')}>Setup</button><button role="tab" aria-selected={panel === 'review'} onClick={() => setPanel('review')}>Scorecard</button></div>
      {hint && <div className="duel-hint" role="status"><ArrowRight size={18}/><span>Set up your opponent here</span><button aria-label="Dismiss duel hint" title="Dismiss hint" onClick={dismissHint}><X size={14}/></button></div>}
      {panel === 'review' ? <div className="duel-controls-body"><DuelScorecard review={status.review} history={status.history ?? []}/></div> : <DuelSetup config={config} arenaDesign={status.arenaDesign} weaponToAdd={weaponToAdd} setWeaponToAdd={setWeaponToAdd} update={update} updateBot={updateBot} customizeBot={customizeBot}/>}
      <div className="duel-controls-foot"><button onClick={openSettings}><Settings2 size={15}/>Mouse & crosshair</button><span><Target size={13}/>Changes start a new round</span></div>
    </aside>
  </div>;
}
