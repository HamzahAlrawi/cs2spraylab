import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Activity, ArrowUp, Check, ChevronDown, Code2 as Github, Crosshair as AimIcon, Download, Gift, History, Maximize, Pause, Play, RotateCcw, Settings2, Shield, Target, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { Crosshair, defaults, gameData, historyModeNames, loadSettings, MeasuredProfile, migrateMode, Mode, modeNames, parseProfile, presets, saveSettings, Settings, Weapon, weaponIds, weaponNames } from './config';
import { RangeEngine, RangeStatus } from './engine';
import { Result } from './simulation';
import { loadAttempts } from '../lib/storage';
import { markSetupHintSeen, needsSetupHint } from './onboarding';
import {equipmentIds,equipmentNames,equipmentStats,type Slot} from './equipment';
import {isDrillMode,readDrillMetrics} from './drills';
import {DrillPanel,DrillReview} from './DrillPanel';

function CrosshairView({ value }: { value: Crosshair }) {
  const style = { '--cross-color': value.color, '--cross-size': `${value.size}px`, '--cross-gap': `${value.gap}px`, '--cross-thickness': `${value.thickness}px`, '--cross-outline': `${value.outline}px`, opacity: value.alpha } as CSSProperties;
  return <div className={`crosshair ${value.t ? 't-style' : ''} ${value.size === 0 ? 'dot-only' : ''}`} style={style} aria-hidden="true">
    <i className="arm top" /><i className="arm right" /><i className="arm bottom" /><i className="arm left" />{value.dot && <i className="dot" />}
  </div>;
}
function Slider({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (n: number) => void }) {
  return <label className="slider-row"><span>{label}<output>{value}{suffix}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} /></label>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="switch" /></label>;
}
function NumberField({ label, value, min, max, step = 1, onCommit }: { label: string; value: number; min: number; max: number; step?: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input aria-label={label} type="number" min={min} max={max} step={step} value={draft}
    onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    onBlur={() => { const n = Number(draft), next = draft.trim() && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : value; setDraft(String(next)); onCommit(next); }} />;
}
function readResults(): Result[] {
  try {
    const a = JSON.parse(localStorage.getItem('spraylab.results.v2') || '[]');
    return Array.isArray(a) ? a.filter(r => r && equipmentIds.includes(r.weapon) && typeof r.id === 'string'
      && ['shots', 'hits', 'heads', 'seconds', 'tracking'].every(k => Number.isFinite(r[k])) && Number.isFinite(Date.parse(r.date))
      && Array.isArray(r.samples) && r.samples.length <= 150 && r.samples.every((p: Record<string, unknown>) => p && ['x', 'y', 'bullet'].every(k => Number.isFinite(p[k])))).slice(0, 100).map(r => ({ ...r, drill:readDrillMetrics(r.drill), mode: r.mode === 'tracking' ? 'tracking' : migrateMode(r.mode) })) : [];
  } catch { return []; }
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const emptyStatus: RangeStatus = { weapon: 'ak47', equipped:'ak47',slot:1,equipReady:true,magazine:30, active: false, firing: false, shots: 0, hits: 0, heads: 0, remaining: 30, reload: 0, speed: 0, distance: 12, input: 'Ready', audio: 'locked', assets: 'Loading models', fps: 0 };
type Panel = 'settings' | 'weapons' | 'history' | null;
type Tab = 'game' | 'crosshair' | 'data';

export default function RangeApp() {
  const [settings, setSettings] = useState(loadSettings);
  const [setupHint, setSetupHint] = useState(needsSetupHint);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const [status, setStatus] = useState(emptyStatus);
  const [panel, setPanel] = useState<Panel>(null), [tab, setTab] = useState<Tab>('game');
  const [results, setResults] = useState(readResults);
  const [legacy] = useState(loadAttempts);
  const [selected, setSelected] = useState<Result>();
  const [profiles, setProfiles] = useState<Partial<Record<Weapon, MeasuredProfile>>>(() => {
    try { return Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('spraylab.profiles.v1') || '{}')).map(([k, v]) => [k, parseProfile(JSON.stringify(v))])); } catch { return {}; }
  });
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [generation, setGeneration] = useState(0);
  const [replay, setReplay] = useState(35);
  const host = useRef<HTMLDivElement>(null), follow = useRef<HTMLDivElement>(null), hitmarker = useRef<HTMLDivElement>(null);
  const engine = useRef<RangeEngine>();
  const drawer = useRef<HTMLElement>(null);
  const assetReady = status.assets === 'Models ready' && status.weapon === settings.weapon;
  const weapon = gameData.weapons[settings.weapon];
  const score = status.shots ? status.hits / status.shots * 100 : 0;
  const update = (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch }));
  const cross = (patch: Partial<Crosshair>) => setSettings(s => ({ ...s, crosshair: { ...s.crosshair, ...patch } }));
  const open = (next: Panel) => { engine.current?.pause(); setSetupHint(false); setPanel(next); };
  useEffect(() => { if (setupHint) markSetupHintSeen(); }, [setupHint]);
  useEffect(() => { if (status.active) setSetupHint(false); }, [status.active]);
  useEffect(() => {
    let range: RangeEngine;
    try {
      range = new RangeEngine(host.current!, setStatus, settingsRef.current, follow.current!, hitmarker.current!, setError);
      engine.current = range;
      range.sim.attempts = results.length;
      range.sim.onResult = result => {
        setSelected(result); setReplay(result.samples.length);
        setResults(previous => {
          const next = [result, ...previous].slice(0, 100);
          try { localStorage.setItem('spraylab.results.v2', JSON.stringify(next)); } catch { setNotice('Browser storage unavailable. This session is not saved.'); }
          return next;
        });
      };
      return () => { engine.current = undefined; range.dispose(); };
    } catch { setError('WebGL could not start. Enable browser hardware acceleration, then restart the range.'); }
  }, [generation]);
  useEffect(() => {
    engine.current?.configure(settings, profiles[settings.weapon]);
    if (!saveSettings(settings)) setNotice('Browser storage unavailable. Settings apply to this session.');
  }, [settings, profiles, generation]);
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    drawer.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setPanel(null); }
      if (e.key === 'Tab') {
        const elements = drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === drawer.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [panel]);
  const start = () => {
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (coarse) { engine.current!.sim.active = true; engine.current!.inputStatus = 'Touch'; void engine.current?.audio.unlock(engine.current.sim.equipped); }
    else void engine.current?.enter();
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
  return <main className="range-app">
    <header className="appbar">
      <a className="brand" href="/" aria-label="SprayLab home"><AimIcon size={25} strokeWidth={1.7} /><span>SPRAYLAB<span className="brand-sub">COUNTER-STRIKE TRAINING</span></span></a>
      <nav className="main-nav" aria-label="Workspace"><button className={!panel ? 'selected' : ''} onClick={() => setPanel(null)}><Target size={16} />Range</button><button className={panel === 'history' ? 'selected' : ''} onClick={() => open('history')}><History size={16} />Session<span className="count">{results.length}</span></button></nav>
      <div className="app-actions">
        <a className="header-donation" href="https://steamcommunity.com/tradeoffer/new/?partner=135963670&token=IS6KDROD" target="_blank" rel="noreferrer"><Gift size={16} />Donate</a>
        <button ref={settingsButton} className={`settings-button${setupHint ? ' settings-nudge' : ''}`} aria-describedby={setupHint ? 'settings-hint-text' : undefined} onClick={() => open('settings')}><Settings2 size={17} />Settings</button>
        {setupHint && !panel && <div className="settings-hint" role="status">
          <ArrowUp className="hint-arrow" size={22} aria-hidden="true" />
          <button className="hint-action" aria-label="Customize your CS2 settings" onClick={() => open('settings')}><b>Match your CS2 setup</b><span id="settings-hint-text">Sensitivity, crosshair & audio</span></button>
          <button className="icon-button" aria-label="Dismiss settings hint" title="Dismiss hint" onClick={() => { setSetupHint(false); settingsButton.current?.focus(); }}><X size={16} /></button>
        </div>}
      </div>
    </header>
    <section className="range-toolbar" aria-label="Range configuration">
      <button className="weapon-select" onClick={() => open('weapons')}><img src={`/models/${settings.weapon}.png`} alt="" /><span><small>LOADOUT</small>{weaponNames[settings.weapon]}</span><ChevronDown size={15} /></button>
      <label className="mode-select"><small>DRILL</small><select aria-label="Training mode" value={settings.mode} onChange={e => update({ mode: e.target.value as Mode })}>{Object.entries(modeNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <div className="distance-input"><small>DISTANCE</small><output>{status.distance.toFixed(1)} m</output></div>
      <div className="toolbar-actions"><button className="icon-button" title="Reset range" aria-label="Reset range" onClick={() => { engine.current?.sim.reset(); engine.current?.clearImpacts(); }}><RotateCcw size={18} /></button><button className="icon-button" title={settings.volume ? 'Mute' : 'Unmute'} aria-label={settings.volume ? 'Mute' : 'Unmute'} onClick={() => update({ volume: settings.volume ? 0 : .2 })}>{settings.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}</button><button className="icon-button fullscreen" title="Fullscreen" aria-label="Fullscreen" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void host.current?.closest('.range-stage')?.requestFullscreen?.().catch(() => setNotice('Fullscreen unavailable in this browser.')); }}><Maximize size={18} /></button></div>
    </section>
    <section className={`range-stage${isDrillMode(settings.mode)?' with-drill':''}`} aria-label="Practice range">
      <div className="range-view">
      <div className="canvas-host" ref={host} />
      <div className="range-topline"><span className="range-badge"><i />{status.active ? 'LIVE RANGE' : 'RANGE 01'}</span><span>{profiles[settings.weapon] ? 'IMPORTED RECOIL CAPTURE' : 'GAME-DERIVED RECOIL'}</span></div>
      {!isDrillMode(settings.mode)&&<div className="target-label">{modeNames[settings.mode]} <span>{status.distance.toFixed(1)} m</span></div>}
      <div className="equipment-slots" role="group" aria-label="Equipped weapon">
        {([1,2,3] as Slot[]).map(slot=>{const id=slot===1?settings.weapon:slot===2?'usp':'knife';return <button key={slot} aria-pressed={status.slot===slot} aria-label={`Equip ${equipmentNames[id]}`} title={`${equipmentNames[id]} (${slot})`} onClick={()=>{void engine.current?.equip(slot);}}><span>{slot}</span><img src={`/models/${id}.png`} alt=""/></button>;})}
      </div>
      <div className="follow-origin" ref={follow}><CrosshairView value={settings.crosshair} /></div>
      <div className="hit-marker" ref={hitmarker}><X size={42} strokeWidth={3} /></div>
      {!status.active && !error && <button className="enter-range" disabled={!assetReady} onClick={start}><Play size={18} fill="currentColor" />{assetReady ? 'Enter range' : 'Loading range'}</button>}
      {error && <div className="range-error" role="alert"><Shield size={24} /><p>{error}</p><button onClick={() => { setError(''); setGeneration(g => g + 1); }}><RotateCcw size={16} />Restart range</button></div>}
      {status.active && <div className="exit-hint"><span>Press ESC to exit</span><button className="icon-button" aria-label="Pause range" title="Pause range (Esc)" onClick={() => engine.current?.pause()}><Pause size={16} /></button></div>}
      <div className="range-hud">
        <div className="hud-performance"><span className="hud-stat"><Activity size={17} /><b>{Math.round(status.speed)}</b><small>u/s</small></span><span className="hud-stat"><Target size={17} /><b>{status.distance.toFixed(1)}</b><small>m</small></span></div>
        <div className="hud-result"><small>HIT RATE</small><strong data-testid="accuracy">{Math.round(score)}<em>%</em></strong><div className="hit-counts"><span className="head-count"><b>{status.heads}</b> HEAD</span><span className="body-count"><b>{status.hits - status.heads}</b> BODY</span><span className="miss-count"><b>{status.shots - status.hits}</b> MISS</span></div></div>
        <div className="hud-ammo"><small>{equipmentNames[status.equipped]}</small><strong data-testid="ammo">{status.slot===3?'--':status.remaining}{status.slot!==3&&<em>{`/ ${status.magazine}`}</em>}</strong><span>{status.reload?`Reloading ${status.reload.toFixed(1)} s`:!status.equipReady?'Drawing':status.firing ? 'Firing' : 'Ready'}</span>{status.slot===2&&<button className="reload-pistol" disabled={status.remaining===12||!!status.reload} onClick={()=>engine.current?.sim.reload()} title="Reload USP-S (R)"><RotateCcw size={13}/>Reload</button>}</div>
      </div>
      </div>
      {isDrillMode(settings.mode)&&<DrillPanel status={status} mode={settings.mode} challenge={settings.drillPace==='challenge'}/>}
    </section>
    <footer className="statusbar"><span><i className={status.active ? 'online' : ''} />{status.input}<span className="desktop-status">{status.fps} FPS</span></span><span className="status-center">{status.audio === 'unavailable' ? 'Audio unavailable' : status.slot===3?'250 u/s':`${Math.round(60 / equipmentStats(status.equipped).cycle)} RPM`}<span className="desktop-status">Build {gameData.build}</span></span><div className="project-links"><a href="https://github.com/HamzahAlrawi/cs2spraylab" target="_blank" rel="noreferrer"><Github size={14} />Source</a></div></footer>
    {notice && <div className="toast" role="status">{notice}<button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {panel && <div className="drawer-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setPanel(null); }}>
      <aside className={`drawer ${panel === 'history' ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="panel-title" tabIndex={-1} ref={drawer}>
        <div className="drawer-header"><div><small>SPRAYLAB</small><h1 id="panel-title">{panel === 'settings' ? 'Settings' : panel === 'weapons' ? 'Loadout' : 'Session history'}</h1></div><button className="icon-button" aria-label="Close panel" onClick={() => setPanel(null)}><X size={21} /></button></div>
        {panel === 'settings' && <>
          <div className="tabs" role="tablist" aria-label="Settings sections">{(['game', 'crosshair', 'data'] as Tab[]).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'game' ? 'Game' : t === 'crosshair' ? 'Crosshair' : 'Data & audio'}</button>)}</div>
          <div className="drawer-content" role="tabpanel">
            {tab === 'game' && <>
              <h2>Mouse</h2><div className="two-fields"><label>Sensitivity<NumberField label="Sensitivity" min={.05} max={10} step={.05} value={settings.sensitivity} onCommit={sensitivity => update({ sensitivity })} /></label><label>Mouse DPI<NumberField label="Mouse DPI" min={100} max={32000} step={100} value={settings.dpi} onCommit={dpi => update({ dpi })} /></label></div>
              <div className="readout"><span>cm / 360</span><b>{(360 / (.022 * settings.sensitivity * settings.dpi) * 2.54).toFixed(2)}</b></div>
              <div className="readout"><span>eDPI</span><b>{Math.round(settings.sensitivity * settings.dpi)}</b></div>
              <Toggle label="Invert mouse Y" checked={settings.invertY} onChange={v => update({ invertY: v })} />
              <h2>Training</h2><label className="select-row">Burst length<select aria-label="Burst length" value={settings.burst} onChange={e => update({ burst: +e.target.value })}><option value="0">Full magazine</option><option value="5">5 rounds</option><option value="10">10 rounds</option><option value="15">15 rounds</option></select></label>
              <label className="select-row">Peeking angles<select aria-label="Peeking angles" value={settings.peekScenario} onChange={e=>update({peekScenario:e.target.value as Settings['peekScenario']})}><option value="mixed">Mixed situations</option><option value="common">Common angles</option><option value="deep">Deep holds</option><option value="off-angle">Off-angles</option><option value="elevated">Elevated holds</option></select></label>
              <label className="select-row">Drill pace<select aria-label="Drill pace" value={settings.drillPace} onChange={e=>update({drillPace:e.target.value as Settings['drillPace']})}><option value="practice">Practice / 8 s exposure</option><option value="challenge">Challenge / 1.5 s exposure</option></select></label>
              <Toggle label="Follow recoil" checked={settings.follow} onChange={v => update({ follow: v })} />
              <Toggle label="Practice spread" checked={settings.spread} onChange={v => update({ spread: v })} />
              <Toggle label="Moving target" checked={settings.moving} onChange={v => update({ moving: v })} />
              <label className="select-row">Target movement<select aria-label="Target movement" value={settings.targetSpeed} onChange={e => update({ targetSpeed: e.target.value as Settings['targetSpeed'] })}><option value="rifle">{weaponNames[settings.weapon]} / {weapon.speed} u/s</option><option value="smg">MP9 / 240 u/s</option><option value="knife">Knife / 250 u/s</option></select></label>
              <h2>Wall guides</h2>
              <Toggle label="Impact pattern (left)" checked={settings.showImpactPattern} onChange={v => update({ showImpactPattern: v })} />
              <Toggle label="Mouse movement (right)" checked={settings.showMousePath} onChange={v => update({ showMousePath: v })} />
              <h2>Graphics</h2><label className="select-row">Render quality<select aria-label="Render quality" value={settings.quality} onChange={e => update({ quality: e.target.value as Settings['quality'] })}><option value="auto">Adaptive</option><option value="low">Low</option><option value="high">High</option></select></label>
              <label className="select-row">Display aspect<select aria-label="Display aspect" value={settings.aspect} onChange={e => update({ aspect: e.target.value as Settings['aspect'] })}>{['native', '16:9', '16:10', '4:3', '5:4'].map(a => <option key={a} value={a}>{a === 'native' ? 'Native viewport' : `${a} stretched`}</option>)}</select></label>
            </>}
            {tab === 'crosshair' && <>
              <div className="crosshair-preview" aria-label="Crosshair preview"><div className="preview-target" /><CrosshairView value={settings.crosshair} /></div>
              <div className="presets">{Object.entries(presets).map(([name, value]) => <button key={name} onClick={() => cross(value)}><div><CrosshairView value={value} /></div>{name}</button>)}</div>
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
            {tab === 'data' && <>
              <h2>Audio</h2><Slider label="Weapon volume" value={Math.round(settings.volume * 100)} min={0} max={100} suffix="%" onChange={v => update({ volume: v / 100 })} />
              <button className="secondary" onClick={async () => { await engine.current?.audio.unlock(settings.weapon); engine.current?.audio.play(settings.weapon, settings.volume); }}><Volume2 size={16} />Test {weaponNames[settings.weapon]}</button>
              <h2>Data provenance</h2><dl className="data-list"><dt>Installed CS2 build</dt><dd>{gameData.build}</dd><dt>Cadence, speed, magazine</dt><dd>Game weapon data</dd><dt>Models & shot samples</dt><dd>Local Valve assets</dd><dt>Spray trajectory</dt><dd>{profiles[settings.weapon] ? 'User capture' : 'Native seeds + recovered recoil math'}</dd><dt>Attempt recovery</dt><dd>Instant practice reset</dd></dl>
              <p className="data-note">Bursts are independent attempts. Recoil math is derived from the installed client; subtick movement, spread RNG and animation blending are not an exact CS2 reproduction.</p>
              <label className="secondary file-button"><Upload size={16} />Import angular capture<input aria-label="Import angular capture" type="file" accept="application/json,.json" onChange={e => { void importProfile(e.target.files?.[0]); e.target.value = ''; }} /></label>
              {profiles[settings.weapon] && <><p className="data-note">{profiles[settings.weapon]?.source} / build {profiles[settings.weapon]?.build}</p><button className="secondary" onClick={() => { const next = { ...profiles }; delete next[settings.weapon]; setProfiles(next); try { localStorage.setItem('spraylab.profiles.v1', JSON.stringify(next)); } catch { setNotice('Storage unavailable.'); } }}>Remove capture</button></>}
              <button className="secondary" onClick={() => download('spraylab-session.json', { settings, results, legacy, profiles })}><Download size={16} />Export session</button>
            </>}
          </div><div className="drawer-footer"><button className="secondary" onClick={() => setSettings({ ...defaults, crosshair: { ...defaults.crosshair } })}><RotateCcw size={15} />Restore defaults</button><button className="primary" onClick={() => setPanel(null)}><Check size={16} />Done</button></div>
        </>}
        {panel === 'weapons' && <div className="drawer-content arsenal">{weaponIds.map(id => <button className={`weapon-item ${settings.weapon === id ? 'chosen' : ''}`} key={id} onClick={() => { update({ weapon: id }); setPanel(null); }}><img src={`/models/${id}.png`} alt={weaponNames[id]} /><span><b>{weaponNames[id]}</b><small>{gameData.weapons[id].magazine} rounds <i /> {Math.round(60 / gameData.weapons[id].cycle)} RPM</small></span>{id === settings.weapon && <Check size={18} />}</button>)}</div>}
        {panel === 'history' && <div className="drawer-content history">
          <div className="session-summary"><div><small>ATTEMPTS</small><b>{results.length}</b></div><div><small>AVG. HIT RATE</small><b>{results.filter(r => r.shots).length ? Math.round(results.filter(r => r.shots).reduce((n, r) => n + r.hits / r.shots * 100, 0) / results.filter(r => r.shots).length) : 0}%</b></div><button className="icon-button" aria-label="Export history" title="Export history" onClick={() => download('spraylab-history.json', { results, legacy })}><Download size={18} /></button></div>
          {selected && <section className="replay"><div className="section-title"><h2>{equipmentNames[selected.weapon]} / {historyModeNames[selected.mode]}</h2><span>{selected.mode === 'tracking' ? `${selected.tracking.toFixed(1)}%` : `${selected.hits}/${selected.shots}`}</span></div>{selected.drill&&<DrillReview value={selected.drill}/>} {selected.samples.length > 0 && <><svg viewBox="0 0 400 240" role="img" aria-label="Shot replay, metres relative to target head"><path d="M200 0V240M0 120H400" stroke="#47524d" strokeDasharray="3 5" /><circle cx="200" cy="120" r="10" fill="none" stroke="#8daba0" /><path d="M182 139h36v42h-36z" fill="#394943" />{selected.samples.slice(0, replay).map((s, i) => <g key={i}><circle cx={200 + Math.max(-190, Math.min(190, s.x * 70))} cy={120 - Math.max(-110, Math.min(110, s.y * 70))} r="3" fill={s.head ? '#e6cf6b' : s.hit ? '#6ddbb1' : '#ed9186'} /><title>Round {s.bullet}: {s.x.toFixed(2)}m, {s.y.toFixed(2)}m</title></g>)}</svg><Slider label="Replay round" value={replay} min={0} max={selected.samples.length} onChange={setReplay} /></>}</section>}
          <h2>Recent attempts</h2>{!results.length && <p className="empty-state">No attempts yet.</p>}{results.map(r => <button key={r.id} className={`history-row ${selected?.id === r.id ? 'selected' : ''}`} onClick={() => { setSelected(r); setReplay(r.samples.length); }}><span><b>{equipmentNames[r.weapon]}</b><small>{historyModeNames[r.mode]} / {new Date(r.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span><strong>{Math.round(r.mode === 'tracking' ? r.tracking : r.shots ? r.hits / r.shots * 100 : 0)}%</strong><ChevronDown size={14} /></button>)}
          {legacy.length > 0 && <><h2>Previous-version history</h2>{legacy.map(r => <div className="history-row" key={r.id}><span>{r.weaponName}<small>{new Date(r.createdAt).toLocaleDateString()}</small></span><b>{r.scores.overall} score</b></div>)}</>}
        </div>}
      </aside>
    </div>}
  </main>;
}
