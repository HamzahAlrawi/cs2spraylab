import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {ArrowRight, ChevronRight, Pause, Play, RotateCcw, Settings2, Shield, Target, X} from 'lucide-react';
import {gameData, weaponIds, weaponNames, type Settings, type Weapon} from '../config';
import {botConfig, sanitizeDuelConfig, type BotOverride, type DuelConfig, type SkillLevel} from './config';
import {DuelEngine, type DuelStatus} from './DuelEngine';
import './duel.css';
import {equipmentNames, equipmentStats, type Slot} from '../equipment';
import {DuelScorecard} from './DuelScorecard';

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

export function DuelStage({settings, openSettings, onEnter, suspended}: {settings: Settings; openSettings: () => void; onEnter: () => void; suspended: boolean}) {
  const [config, setConfig] = useState(loadConfig);
  const [status, setStatus] = useState<DuelStatus>(initialStatus);
  const [hint, setHint] = useState(loadHint);
  const [panel, setPanel] = useState<'setup' | 'review'>('setup');
  const [error, setError] = useState('');
  const [weaponToAdd, setWeaponToAdd] = useState<Weapon>('m4a4');
  const canvasHost = useRef<HTMLDivElement>(null);
  const crosshair = useRef<HTMLDivElement>(null);
  const engine = useRef<DuelEngine>();

  useEffect(() => {
    if (!canvasHost.current) return;
    try {engine.current = new DuelEngine(canvasHost.current, crosshair.current!, setStatus, setError, settings, config);}
    catch {setError('WebGL could not start. Enable hardware acceleration and reload.');}
    return () => {engine.current?.dispose(); engine.current = undefined;};
  }, []);
  useEffect(() => {engine.current?.setSettings(settings);}, [settings]);
  useEffect(() => {if (suspended) engine.current?.pause();}, [suspended]);
  useEffect(() => {
    engine.current?.setConfig(config);
    try {localStorage.setItem('spraylab.duel.v1', JSON.stringify(config));} catch { /* Session-only configuration. */ }
  }, [config]);

  const update = (patch: Partial<DuelConfig>) => setConfig(previous => sanitizeDuelConfig({...previous, ...patch}));
  const updateBot = (index: number, patch: BotOverride) => setConfig(previous => {
    const overrides = [...previous.overrides];
    overrides[index] = {...overrides[index], ...patch};
    return sanitizeDuelConfig({...previous, overrides});
  });
  const customizeBot = (index: number, enabled: boolean) => setConfig(previous => {
    const overrides = [...previous.overrides];
    overrides[index] = enabled ? {...botConfig(previous, index)} : {};
    return sanitizeDuelConfig({...previous, overrides});
  });
  const dismissHint = () => {
    setHint(false);
    try {localStorage.setItem('spraylab.duel.hint.v1', 'seen');} catch { /* Hint may repeat without storage. */ }
  };
  const alive = status.phase === 'fighting' && !status.paused;
  const playing = status.phase !== 'ready' && !status.paused;
  const equipped = status.equipped ?? settings.weapon;
  const crosshairStyle = {'--cross-color': settings.crosshair.color, '--cross-size': `${settings.crosshair.size}px`,
    '--cross-gap': `${settings.crosshair.gap}px`, '--cross-thickness': `${settings.crosshair.thickness}px`,
    '--cross-outline': `${settings.crosshair.outline}px`, opacity: settings.crosshair.alpha} as CSSProperties;

  return <div className="duel-layout">
    <div className="duel-view">
      <div className="duel-canvas" ref={canvasHost} />
      <div className="duel-topline"><span className="range-badge"><i />AI DUEL</span><span>{status.enemies} {status.enemies === 1 ? 'ENEMY' : 'ENEMIES'} LEFT</span></div>
      <div className="duel-tools"><div className="equipment-slots" role="group" aria-label="Duel equipment">
        {([1,2,3] as Slot[]).map(slot => {const id = slot === 1 ? settings.weapon : slot === 2 ? 'usp' : 'knife';
          return <button key={slot} aria-pressed={equipped === id} title={`${equipmentNames[id]} (${slot})`} aria-label={`Equip ${equipmentNames[id]}`} onClick={() => engine.current?.equip(slot)}><span>{slot}</span><img src={`/models/${id}.png`} alt=""/></button>;})}
      </div>
      {playing && <div className="duel-exit"><span>Press ESC to exit</span><button className="icon-button" aria-label="Pause duel" title="Pause duel" onClick={() => engine.current?.pause()}><Pause size={16}/></button></div>}
      {alive && !status.shortcutProtected && <div className="duel-shortcut-warning" role="status">C to crouch. Ctrl+W may close this tab.</div>}
      </div>
      <div className="follow-origin" ref={crosshair} aria-hidden="true"><div className={`crosshair ${settings.crosshair.t ? 't-style' : ''} ${settings.crosshair.size === 0 ? 'dot-only' : ''}`} style={crosshairStyle}>
        <i className="arm top"/><i className="arm right"/><i className="arm bottom"/><i className="arm left"/>{settings.crosshair.dot&&<i className="dot"/>}
      </div></div>
      {status.phase !== 'ready' && status.caption && <div className="duel-caption" role="status">{status.caption}</div>}
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
        <div className="duel-ammo"><small>{equipmentNames[equipped]}</small><strong>{equipped === 'knife' ? '--' : status.ammo}{equipped !== 'knife' && <em> / {equipmentStats(equipped).magazine}</em>}</strong><span>{status.reloading ? 'Reloading' : status.input}</span>{equipped !== 'knife' && <button className="reload-pistol" title="Reload (R)" disabled={!alive || status.reloading || status.ammo === equipmentStats(equipped).magazine} onClick={() => engine.current?.sim.command(0, {reloadPressed: true})}><RotateCcw size={13}/>Reload</button>}</div>
      </div>
    </div>
    <aside className="duel-controls" aria-label="Duel settings">
      <div className="duel-controls-head"><div><small>DRILL SETUP</small><h2>AI Duel</h2></div><button className="icon-button" title="New round" aria-label="New duel round" onClick={() => engine.current?.restart()}><RotateCcw size={17}/></button></div>
      <div className="tabs" role="tablist" aria-label="Duel panel"><button role="tab" aria-selected={panel === 'setup'} onClick={() => setPanel('setup')}>Setup</button><button role="tab" aria-selected={panel === 'review'} onClick={() => setPanel('review')}>Scorecard</button></div>
      {hint && <div className="duel-hint" role="status"><ArrowRight size={18}/><span>Set up your opponent here</span><button aria-label="Dismiss duel hint" title="Dismiss hint" onClick={dismissHint}><X size={14}/></button></div>}
      {panel === 'review' ? <div className="duel-controls-body"><DuelScorecard review={status.review} history={status.history ?? []}/></div> : <div className="duel-controls-body">
        <label className="duel-field"><span>Arena size <output>{(24 * config.arenaScale).toFixed(0)} x {(32 * config.arenaScale).toFixed(0)} m</output></span><input type="range" aria-label="Arena size" min="1" max="1.5" step=".05" value={config.arenaScale} onChange={event => update({arenaScale: +event.target.value})}/></label>
        <label className="duel-field"><span>Bots <output>{config.botCount}</output></span><input aria-label="Number of bots" type="range" min="1" max="5" step="1" value={config.botCount} onChange={event => update({botCount: +event.target.value})}/></label>
        <label className="duel-field"><span>FACEIT level <output>{config.skill}</output></span><select aria-label="Bot skill level" value={config.skill} onChange={event => update({skill: event.target.value === '10+' ? '10+' : +event.target.value as SkillLevel})}>
          {[1,2,3,4,5,6,7,8,9,10,'10+'].map(level => <option key={level} value={level}>{level}</option>)}
        </select></label>
        <label className="duel-field"><span>Behavior</span><select aria-label="Bot behavior" value={config.behavior} onChange={event => update({behavior: event.target.value as DuelConfig['behavior']})}>
          <option value="mixed">Mixed</option><option value="holder">Holder</option><option value="patient">Patient</option><option value="aggressive">Aggressive</option>
        </select></label>
        <div className="duel-field"><span>Bot weapons</span><div className="duel-weapon-add"><select aria-label="Add bot weapon" value={weaponToAdd} onChange={event => setWeaponToAdd(event.target.value as Weapon)}>
          {weaponIds.map(id => <option value={id} key={id}>{weaponNames[id]}</option>)}
        </select><button aria-label="Add weapon to bot pool" title="Add weapon" onClick={() => update({weapons: [...config.weapons, weaponToAdd]})}>+</button></div>
          <div className="duel-weapon-pool">{config.weapons.map(weapon => <span key={weapon}>{weaponNames[weapon]}<button aria-label={`Remove ${weaponNames[weapon]}`} title={`Remove ${weaponNames[weapon]}`} disabled={config.weapons.length === 1}
            onClick={() => update({weapons: config.weapons.filter(id => id !== weapon)})}><X size={12}/></button></span>)}</div>
        </div>
        <label className="duel-field"><span>Health <output>{config.health}</output></span><input aria-label="Bot health" type="number" min="1" max="500" value={config.health} onChange={event => update({health: +event.target.value})}/></label>
        <label className="duel-field"><span>Player health <output>{config.playerHealth}</output></span><input aria-label="Player health" type="number" min="1" max="500" value={config.playerHealth} onChange={event => update({playerHealth: +event.target.value})}/></label>
        <label className="duel-field"><span>Between rounds <output>{config.feedbackSeconds.toFixed(1)}s</output></span><input aria-label="Round restart delay" type="range" min="1" max="3" step=".1" value={config.feedbackSeconds} onChange={event => update({feedbackSeconds: +event.target.value})}/></label>
        <label className="duel-check"><span>Armor + helmet</span><input aria-label="Bot armor" type="checkbox" checked={config.armor} onChange={event => update({armor: event.target.checked})}/></label>
        <label className="duel-field"><span>Aim accuracy <output>{Math.round(config.accuracy * 100)}%</output></span><input aria-label="Bot aim accuracy" type="range" min=".5" max="1.5" step=".05" value={config.accuracy} onChange={event => update({accuracy: +event.target.value})}/></label>
        <label className="duel-check"><span>Protect Ctrl+W in fullscreen</span><input aria-label="Protect Ctrl+W" type="checkbox" checked={config.shortcutProtection}
          onChange={event => update({shortcutProtection: event.target.checked})}/></label>
        <div className="duel-roster"><strong>Opponents</strong>{Array.from({length: config.botCount}, (_, index) => {
          const custom = !!Object.keys(config.overrides[index] ?? {}).length;
          const bot = botConfig(config, index);
          return <details className="duel-bot-details" key={index}>
            <summary><ChevronRight size={12} aria-hidden="true"/>Bot {index + 1}<span>{weaponNames[bot.weapon]} / Lv {bot.skill}</span></summary>
            <label className="duel-check"><span>Custom loadout & skill</span><input aria-label={`Customize bot ${index + 1}`} type="checkbox" checked={custom}
              onChange={event => customizeBot(index, event.target.checked)}/></label>
            {custom && <div className="duel-bot-fields">
              <label className="duel-field"><span>Weapon</span><select aria-label={`Bot ${index + 1} weapon`} value={bot.weapon}
                onChange={event => updateBot(index, {weapon: event.target.value as Weapon})}>
                {weaponIds.map(id => <option key={id} value={id}>{weaponNames[id]}</option>)}</select></label>
              <label className="duel-field"><span>Level</span><select aria-label={`Bot ${index + 1} skill`} value={bot.skill}
                onChange={event => updateBot(index, {skill: event.target.value === '10+' ? '10+' : +event.target.value as SkillLevel})}>
                {[1,2,3,4,5,6,7,8,9,10,'10+'].map(level => <option key={level} value={level}>{level}</option>)}</select></label>
              <label className="duel-field"><span>Behavior</span><select aria-label={`Bot ${index + 1} behavior`} value={bot.behavior}
                onChange={event => updateBot(index, {behavior: event.target.value as DuelConfig['behavior']})}>
                <option value="mixed">Mixed</option><option value="holder">Holder</option><option value="patient">Patient</option><option value="aggressive">Aggressive</option></select></label>
              <label className="duel-field"><span>Health</span><input aria-label={`Bot ${index + 1} health`} type="number" min="1" max="500" value={bot.health}
                onChange={event => updateBot(index, {health: +event.target.value})}/></label>
              <label className="duel-check"><span>Armor + helmet</span><input aria-label={`Bot ${index + 1} armor`} type="checkbox" checked={bot.armor}
                onChange={event => updateBot(index, {armor: event.target.checked})}/></label>
              <label className="duel-field"><span>Aim accuracy <output>{Math.round(bot.accuracy * 100)}%</output></span>
                <input aria-label={`Bot ${index + 1} accuracy`} type="range" min=".5" max="1.5" step=".05" value={bot.accuracy}
                  onChange={event => updateBot(index, {accuracy: +event.target.value})}/></label>
            </div>}
          </details>;
        })}</div>
      </div>}
      <div className="duel-controls-foot"><button onClick={openSettings}><Settings2 size={15}/>Mouse & crosshair</button><span><Target size={13}/>Changes start a new round</span></div>
    </aside>
  </div>;
}
