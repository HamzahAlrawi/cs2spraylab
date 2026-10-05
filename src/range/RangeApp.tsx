import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Code2 as Github, Crosshair as AimIcon, Download, Eye, Gauge, Gift, History, ListPlus, Maximize, Pause, Play, RotateCcw, ScanLine, Settings2, Shield, ShoppingCart, Target, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { Crosshair, defaults, gameData, historyModeNames, loadSettings, loadoutWeapon, MeasuredProfile, migrateMode, Mode, modeNames, parseProfile, presets, saveSettings, Settings, Weapon, weaponIds, weaponNames, pistolIds, type Pistol } from './config';
import { RangeEngine, RangeStatus } from './engine';
import { Result } from './simulation';
import { loadAttempts } from '../lib/storage';
import { markSetupHintSeen, needsSetupHint } from './onboarding';
import {equipmentIds,equipmentNames,equipmentStats,type Slot} from './equipment';
import {isDrillMode,readDrillMetrics} from './drills';
import {DrillPanel,DrillReview} from './DrillPanel';
import {makeRepFeedback,type RepFeedback} from './rep-feedback';
import {DuelStage} from './duel/DuelStage';
import {GraduationCap} from 'lucide-react';
import {MovementTutorial} from './MovementTutorial';
import {modeInfo} from './mode-info';
import recoilProvenance from './recoil-provenance.json';
import {createProgressionController, cosmeticsForEquipment, type ProgressionController, type ProgressionProfile} from './progression';
import {ProgressionPanel, XpNotification, useProgression} from './ProgressionPanel';
import {cosmeticCatalog, cosmeticLabel, cosmeticPreview} from './cosmetics';
import {Changelog} from './Changelog';
import {HearingPractice} from './HearingPractice';

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
type Panel = 'settings' | 'weapons' | 'history' | 'changelog' | null;
type Tab = 'game' | 'crosshair' | 'data';

export default function RangeApp() {
  const [progression] = useState(() => createProgressionController({catalog: cosmeticCatalog}));
  const progressionState = useProgression(progression);
  const [armoryOpen, setArmoryOpen] = useState(false);
  const [armoryRequest, setArmoryRequest] = useState<string | null>(null);
  const [achievementRequest, setAchievementRequest] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [setupHint, setSetupHint] = useState(needsSetupHint);
  const [tutorial, setTutorial] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const [status, setStatus] = useState(emptyStatus);
  const [panel, setPanel] = useState<Panel>(null), [tab, setTab] = useState<Tab>('game');
  const [finishSlot, setFinishSlot] = useState<1 | 2>(1);
  const [finishFocusRequest, setFinishFocusRequest] = useState(0);
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
  const engine = useRef<RangeEngine>();
  const drawer = useRef<HTMLElement>(null);
  const selectedWeapon = loadoutWeapon(settings);
  const assetReady = status.assets === 'Models ready' && status.weapon === selectedWeapon;
  const weapon = gameData.weapons[selectedWeapon];
  const score = settings.mode==='precision' ? status.drill?.last?.movementScore ?? 0 : status.shots ? status.hits / status.shots * 100 : 0;
  const showRepFeedback=repFeedback?.mode===settings.mode && status.active && !status.firing && !status.hitFlash;
  const update = (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch }));
  const cross = (patch: Partial<Crosshair>) => setSettings(s => ({ ...s, crosshair: { ...s.crosshair, ...patch } }));
  const open = (next: Panel) => { engine.current?.pause(); setSetupHint(false); setPanel(next); };
  useEffect(() => { if (setupHint) markSetupHintSeen(); }, [setupHint]);
  useEffect(() => { if (status.active) setSetupHint(false); }, [status.active]);
  useEffect(()=>{if(!repFeedback)return;const timer=setTimeout(()=>setRepFeedback(null),4000);return()=>clearTimeout(timer);},[repFeedback]);
  useEffect(()=>setRepFeedback(null),[settings.mode]);
  useEffect(() => {
    if (settings.mode === 'duel' || settings.mode === 'hearing') {engine.current = undefined; return;}
    let range: RangeEngine;
    try {
      range = new RangeEngine(host.current!, setStatus, settingsRef.current, follow.current!, hitmarker.current!, setError, progression);
      engine.current = range;
      range.sim.attempts = results.length;
      range.sim.onResult = result => {
        range.settleProgression(result);
        if(result.drill&&isDrillMode(result.mode)) {
          const previous=resultsRef.current.filter(r=>r.mode===result.mode&&r.drill).map(r=>r.drill!);
          setRepFeedback({id:result.id,mode:result.mode,...makeRepFeedback(result.mode,result.drill,previous)});
        } else if (result.shots && result.mode !== 'tracking') {
          setRepFeedback({id: result.id, mode: result.mode, passed: result.hits / result.shots >= .7,
            message: `${result.hits}/${result.shots} hits / ${result.heads} head hits`,
            tip: result.hits / result.shots < .5 ? 'Start on the head, stop moving, then correct recoil as it climbs. Use shorter bursts until the first shots connect.'
              : 'Keep the same starting aim. Check the wall marks for shots that drifted away as the spray continued.'});
        }
        resultsRef.current=[result,...resultsRef.current].slice(0,100);
        setSelected(result); setReplay(result.samples.length);
        setResults(previous => {
          const next = [result, ...previous].slice(0, 100);
          try { localStorage.setItem('spraylab.results.v2', JSON.stringify(next)); } catch { setNotice('Browser storage unavailable. This session is not saved.'); }
          return next;
        });
      };
      return () => { engine.current = undefined; range.dispose(); };
    } catch { setError('WebGL could not start. Enable browser hardware acceleration, then restart the range.'); }
  }, [generation, settings.mode === 'duel', settings.mode === 'hearing']);
  useEffect(() => {
    engine.current?.configure(settings, profiles[settings.weapon]);
    if (!saveSettings(settings)) setNotice('Browser storage unavailable. Settings apply to this session.');
  }, [settings, profiles, generation]);
  useEffect(() => {void engine.current?.refreshCosmetics();}, [progressionState.profile.equipped]);
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
        <button type="button" className="changelog-button" aria-label="Changelog" title="Changelog" aria-haspopup="dialog" aria-expanded={panel === 'changelog'} onClick={event => {event.currentTarget.focus(); open('changelog');}}><ListPlus size={17} aria-hidden="true"/><span>Changelog</span></button>
        <ProgressionPanel controller={progression} activeEquipment={selectedWeapon} equipmentLabels={equipmentNames} requestedEquipment={armoryRequest} requestedAchievements={achievementRequest} onRequestHandled={()=>{setArmoryRequest(null);setAchievementRequest(false);}} onOpenChange={value=>{setArmoryOpen(value); if(value)engine.current?.pause();}}/>
        <a className="header-donation" href="https://steamcommunity.com/tradeoffer/new/?partner=135963670&token=IS6KDROD" target="_blank" rel="noreferrer"><Gift size={16} /><span>Donate unwanted<br className="donation-wrap"/> CS2 skins</span></a>
        <button ref={settingsButton} className={`settings-button${setupHint ? ' settings-nudge' : ''}`} aria-describedby={setupHint ? 'settings-hint-text' : undefined} onClick={() => open('settings')}><Settings2 size={17} />Settings</button>
      </div>
      {setupHint && !panel && <div className="settings-hint" role="status">
        <button className="hint-action" aria-label="Customize your CS2 settings" onClick={() => open('settings')}><b>Match your CS2 setup</b><span id="settings-hint-text">Sensitivity, crosshair & audio</span></button>
        <ArrowUp className="hint-arrow" size={22} aria-hidden="true" />
        <button className="icon-button" aria-label="Dismiss settings hint" title="Dismiss hint" onClick={() => { setSetupHint(false); settingsButton.current?.focus(); }}><X size={16} /></button>
      </div>}
    </header>
    <section className="range-toolbar" aria-label="Range configuration">
      {settings.mode !== 'hearing' && <button className="weapon-select" onClick={() => open('weapons')}><img src={cosmeticPreview(progressionState.profile, selectedWeapon)} alt="" /><span><small>{settings.primaryEnabled ? 'LOADOUT' : 'SIDEARM ONLY'}</small>{weaponNames[selectedWeapon]}</span><ChevronDown size={15} /></button>}
      <label className="mode-select"><small>DRILL</small><select aria-label="Training mode" value={settings.mode} onChange={e => {const mode = e.target.value as Mode; update({mode, spread: modeInfo[mode].spread});}}>{Object.entries(modeNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      {settings.mode !== 'duel' && settings.mode !== 'hearing' && <div className="distance-input"><small>DISTANCE</small><output>{status.distance.toFixed(1)} m</output></div>}
      <div className="toolbar-actions">
        {settings.mode !== 'duel' && settings.mode !== 'hearing' && <button className="icon-button" title="Reset range" aria-label="Reset range" onClick={() => engine.current?.reset()}><RotateCcw size={18} /></button>}
        {settings.mode !== 'hearing' && <button type="button" className="icon-button fps-toggle" title={settings.showFps ? 'Hide FPS counter' : 'Show FPS counter'} aria-label="Toggle FPS counter" aria-pressed={settings.showFps} onClick={() => update({showFps: !settings.showFps})}><Gauge size={18} aria-hidden="true"/></button>}
        <button className="icon-button" title={settings.volume ? 'Mute' : 'Unmute'} aria-label={settings.volume ? 'Mute' : 'Unmute'} onClick={() => update({ volume: settings.volume ? 0 : .2 })}>{settings.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        {settings.mode !== 'hearing' && <button className="icon-button fullscreen" title="Fullscreen" aria-label="Fullscreen" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void host.current?.closest('.range-stage')?.requestFullscreen?.().catch(() => setNotice('Fullscreen unavailable in this browser.')); }}><Maximize size={18} /></button>}
      </div>
    </section>
    <section className="mode-brief" aria-label="Drill purpose"><div><strong>{modeInfo[settings.mode].benefit}</strong><p>{modeInfo[settings.mode].task}</p></div><button onClick={() => {engine.current?.pause(); setTutorial(true);}}><GraduationCap size={19}/>Learn the fundamentals</button></section>
    <section className={`range-stage${settings.mode === 'duel' ? ' duel-stage' : isDrillMode(settings.mode)?' with-drill':''}`} aria-label="Practice range">
      <XpNotification controller={progression} onOpenAchievements={()=>{setPanel(null);setAchievementRequest(true);}}/>
      {settings.mode === 'hearing' ? <HearingPractice volume={settings.volume} openSettings={() => open('settings')} suspended={!!panel || tutorial || armoryOpen}/> : settings.mode === 'duel' ? <DuelStage settings={settings} progression={progression} cosmeticRevision={progressionState.profile.equipped} openSettings={() => open('settings')} onEnter={() => setSetupHint(false)} suspended={!!panel || tutorial || armoryOpen}/> : <>
      <div className={`range-view${showRepFeedback?' has-rep-feedback':''}`}>
      <div className="canvas-host" ref={host} />
      <div className="range-topline"><span className="range-badge"><i />{status.active ? 'LIVE RANGE' : 'RANGE 01'}</span><span>{profiles[settings.weapon] ? 'IMPORTED RECOIL CAPTURE' : 'GAME-DERIVED RECOIL'}</span></div>
      {!isDrillMode(settings.mode)&&<div className="target-label">{modeNames[settings.mode]} <span>{status.distance.toFixed(1)} m</span></div>}
      {settings.mode === 'transfer' && settings.transferRule === 'kill' && <div className="transfer-health" aria-label="Transfer target health">
        {(status.targetHealth ?? [100,100]).map((health, i) => <span key={i} className={health === 0 ? 'down' : ''}>{i ? 'B' : 'A'} <b>{health === 0 ? 'DOWN' : `${Math.ceil(health)} HP`}</b></span>)}
      </div>}
      <div className="equipment-slots" role="group" aria-label="Equipped weapon">
        {([1,2,3,4] as Slot[]).filter(slot=>slot!==1||settings.primaryEnabled).map(slot=>{const id=slot===1?settings.weapon:slot===2?settings.sidearm:slot===4?'zeus':'knife';return <button key={slot} aria-pressed={status.slot===slot} aria-label={`Equip ${equipmentNames[id]}`} title={`${cosmeticLabel(progressionState.profile, id)} (${slot})`} onClick={()=>{void engine.current?.equip(slot);}}><span>{slot}</span><img src={cosmeticPreview(progressionState.profile, id)} alt=""/></button>;})}
      </div>
      <div className="weapon-action-tools"><button className="icon-button" aria-label="Inspect weapon" title="Inspect weapon (F)" onClick={()=>engine.current?.inspect()}><Eye size={16}/></button>
        {status.equipped !== 'knife' && (gameData.weapons[status.equipped].zoomLevels > 0 || gameData.weapons[status.equipped].hasBurst || gameData.weapons[status.equipped].isRevolver) && <button className="icon-button" aria-label="Secondary weapon mode" title={status.equipped === 'revolver' ? 'Quick alternate shot (right click)' : 'Scope / burst mode (right click)'} onClick={()=>engine.current?.secondary()}><ScanLine size={16}/></button>}</div>
      <div className="follow-origin" ref={follow}><CrosshairView value={settings.crosshair} /></div>
      {settings.mode==='peek'&&status.active&&!!status.drill?.peekDirection&&<div className="peek-direction" role="status" aria-label={`Peek ${status.drill.peekDirection<0?'left':'right'}`}>
        {status.drill.peekDirection<0?<ArrowLeft size={32}/>:<ArrowRight size={32}/>}<span>Peek {status.drill.peekDirection<0?'left':'right'}</span>
      </div>}
      {!settings.spread&&<button className="spread-warning" onClick={()=>{update({spread:true});}} title="Enable movement and firing inaccuracy">Spread off<Shield size={12}/></button>}
      <div className="hit-marker" ref={hitmarker}><X size={42} strokeWidth={3} /></div>
      {showRepFeedback&&repFeedback&&<div className={`rep-feedback${repFeedback.passed?' passed':''}`} role="status" aria-label="Rep feedback"><b>{repFeedback.message}</b>{repFeedback.tip&&<p>{repFeedback.tip}</p>}</div>}
      {!status.active && !error && <button className="enter-range" disabled={!assetReady} onClick={start}><Play size={18} fill="currentColor" />{assetReady ? 'Enter range' : 'Loading range'}</button>}
      {error && <div className="range-error" role="alert"><Shield size={24} /><p>{error}</p><button onClick={() => { setError(''); setGeneration(g => g + 1); }}><RotateCcw size={16} />Restart range</button></div>}
      {status.active && <div className="exit-hint"><span>Press ESC to exit</span><button className="icon-button" aria-label="Pause range" title="Pause range (Esc)" onClick={() => engine.current?.pause()}><Pause size={16} /></button></div>}
      {status.active && status.input !== 'Touch' && !status.shortcutProtected && <div className="range-shortcut-warning" role="status">C to crouch. Ctrl+W may close this tab.</div>}
      <div className="range-hud">
        <div className="hud-performance"><span className="hud-stat"><Activity size={17} /><b>{Math.round(status.speed)}</b><small>u/s</small></span><span className="hud-stat"><Target size={17} /><b>{status.distance.toFixed(1)}</b><small>m</small></span></div>
        <div className="hud-result"><small>{settings.mode==='precision'?'MOVEMENT SCORE':'HIT RATE'}</small><strong data-testid="accuracy">{Math.round(score)}<em>{settings.mode==='precision'?'/100':'%'}</em></strong><div className="hit-counts"><span className="head-count"><b>{status.heads}</b> HEAD</span><span className="body-count"><b>{status.hits - status.heads}</b> BODY</span><span className="miss-count"><b>{status.shots - status.hits}</b> MISS</span></div></div>
        <div className="hud-ammo"><small>{cosmeticLabel(progressionState.profile, status.equipped)}</small><strong data-testid="ammo">{status.slot===3?'--':status.remaining}{status.slot!==3&&status.equipped!=='zeus'&&<em>{`/ ${status.reserve ?? status.magazine}`}</em>}</strong><span>{status.reload?`${status.reloadSilent?'Silent reload':'Reloading'} ${status.reload.toFixed(1)} s`:status.recharge?`Recharge ${Math.ceil(status.recharge)}s`:!status.equipReady?'Drawing':status.firing ? 'Firing' : 'Ready'}</span>{status.slot!==3&&status.equipped!=='zeus'&&<button className="reload-pistol" disabled={status.remaining===status.magazine||!!status.reload||!status.reserve} onClick={()=>engine.current?.sim.reload()} title={`Reload ${equipmentNames[status.equipped]} (R)`}><RotateCcw size={13}/>Reload</button>}</div>
      </div>
      </div>
      {isDrillMode(settings.mode)&&<DrillPanel status={status} mode={settings.mode} challenge={settings.drillPace==='challenge'} peekDuration={settings.peekDuration}/>}
      </>}
    </section>
    <footer className="statusbar"><span><i className={settings.mode !== 'hearing' && status.active ? 'online' : ''} />{settings.mode === 'hearing' ? 'Hearing practice' : settings.mode === 'duel' ? 'AI Duel' : status.input}</span><span className="status-center">{settings.mode === 'hearing' ? 'Native samples / browser spatial audio' : settings.mode === 'duel' ? 'Simulation' : status.audio === 'unavailable' ? 'Audio unavailable' : status.slot===3?'250 u/s':`${Math.round(60 / equipmentStats(status.equipped).cycle)} RPM`}<span className="desktop-status">Build {gameData.build}</span></span><div className="project-links"><a href="https://github.com/HamzahAlrawi/cs2spraylab" target="_blank" rel="noreferrer"><Github size={14} />Source</a></div></footer>
    {notice && <div className="toast" role="status">{notice}<button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {panel && <div className="drawer-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setPanel(null); }}>
      <aside className={`drawer ${panel === 'history' || panel === 'changelog' ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="panel-title" tabIndex={-1} ref={drawer}>
        <div className="drawer-header"><div><small>SPRAYLAB</small><h1 id="panel-title">{panel === 'settings' ? 'Settings' : panel === 'weapons' ? 'Loadout' : panel === 'changelog' ? 'Changelog' : 'Session history'}</h1></div><button className="icon-button" aria-label="Close panel" onClick={() => setPanel(null)}><X size={21} /></button></div>
        {panel === 'changelog' && <Changelog/>}
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
              <Slider label="Peeking target duration" value={settings.peekDuration} min={.5} max={10} step={.25} suffix=" s" onChange={peekDuration=>update({peekDuration})}/>
              <label className="select-row">Counterstrafe / burst pace<select aria-label="Drill pace" value={settings.drillPace} onChange={e=>update({drillPace:e.target.value as Settings['drillPace']})}><option value="practice">Practice / 8 s exposure</option><option value="challenge">Challenge / 1.5 s exposure</option></select></label>
              <Toggle label="Follow recoil" checked={settings.follow} onChange={v => update({ follow: v })} />
              <Toggle label="Practice spread" checked={settings.mode === 'duel' || settings.spread} disabled={settings.mode === 'duel'} onChange={v => update({ spread: v })} />
              <p className="setting-explanation">Spread adds the weapon's random shot dispersion and the extra inaccuracy from movement, jumping and repeated fire. Turning it off does not remove recoil. Switching drills applies the recommended setting: off for Guided spray, on for other drills. AI Duel always applies it equally to you and the bots.</p>
              <label className="select-row">Transfer to B<select aria-label="Transfer trigger" value={settings.transferRule} onChange={e => update({transferRule: e.target.value as Settings['transferRule']})}><option value="bullet">After a bullet count</option><option value="kill">After A loses 100 health</option></select></label>
              {settings.transferRule === 'bullet' && <Slider label="Transfer after bullet" value={settings.transferAfter} min={1} max={weapon.magazine - 1} onChange={transferAfter => update({transferAfter})}/>}
              <p className="setting-explanation">Transfer targets have 100 health and no armor. Recoil continues across A and B. A short selected burst caps the transfer count before its last round.</p>
              <Slider label="Bullet impact size" value={settings.impactSize} min={.5} max={4} step={.25} suffix="x" onChange={impactSize=>update({impactSize})}/>
              <Toggle label="Moving target" checked={settings.moving} onChange={v => update({ moving: v })} />
              <label className="select-row">Target movement<select aria-label="Target movement" value={settings.targetSpeed} onChange={e => update({ targetSpeed: e.target.value as Settings['targetSpeed'] })}><option value="rifle">{weaponNames[settings.weapon]} / {weapon.speed} u/s</option><option value="smg">MP9 / 240 u/s</option><option value="knife">Knife / 250 u/s</option></select></label>
              <h2>Wall guides</h2>
              <Toggle label="Impact pattern (left)" checked={settings.showImpactPattern} onChange={v => update({ showImpactPattern: v })} />
              <Toggle label="Mouse movement (right)" checked={settings.showMousePath} onChange={v => update({ showMousePath: v })} />
              <Toggle label="Animated wall guides" checked={settings.animatedGuides} onChange={animatedGuides => update({animatedGuides})}/>
              <h2>Graphics</h2><label className="select-row">Render quality<select aria-label="Render quality" value={settings.quality} onChange={e => update({ quality: e.target.value as Settings['quality'], ...(e.target.value === 'performance' ? {frameLimit:60} : {}) })}><option value="auto">Adaptive</option><option value="performance">Performance (older PCs)</option><option value="low">Low</option><option value="high">High</option></select></label>
              <label className="select-row">Frame limit<select aria-label="Frame limit" value={settings.frameLimit} onChange={e => update({frameLimit: +e.target.value})}>{[0,30,60,120,144,240].map(n => <option key={n} value={n}>{n ? `${n} FPS` : 'Display refresh rate'}</option>)}</select></label>
              <Toggle label="Show FPS counter" checked={settings.showFps} onChange={showFps => update({showFps})}/>
              <Toggle label="Protect range Ctrl+W" checked={settings.protectShortcuts} onChange={protectShortcuts => update({protectShortcuts})}/>
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
              <h2>Data provenance</h2><dl className="data-list"><dt>Weapon data build</dt><dd>{gameData.build}</dd><dt>Recoil math inspected</dt><dd>{recoilProvenance.build}</dd><dt>Cadence, speed, magazine</dt><dd>Game weapon data</dd><dt>Models & shot samples</dt><dd>Local Valve assets</dd><dt>Spray trajectory</dt><dd>{profiles[settings.weapon] ? 'Capture-fitted impulses' : 'Native seeds + recovered recoil math'}</dd><dt>Recoil recovery</dt><dd>Persistent punch + recoil index</dd></dl>
              <p className="settings-note">Weapon parameters match the latest local export. Recoil math was inspected on an earlier build; full trajectories, camera motion and subtick timing are not an exact CS2 reproduction.</p>
              <p className="data-note">Recoil and firing inaccuracy persist between trigger presses. Recovery math is derived from the installed client; subtick movement, spread RNG and animation blending are not an exact CS2 reproduction.</p>
              <label className="secondary file-button"><Upload size={16} />Import angular capture<input aria-label="Import angular capture" type="file" accept="application/json,.json" onChange={e => { void importProfile(e.target.files?.[0]); e.target.value = ''; }} /></label>
              {profiles[settings.weapon] && <><p className="data-note">{profiles[settings.weapon]?.source} / build {profiles[settings.weapon]?.build}</p><button className="secondary" onClick={() => { const next = { ...profiles }; delete next[settings.weapon]; setProfiles(next); try { localStorage.setItem('spraylab.profiles.v1', JSON.stringify(next)); } catch { setNotice('Storage unavailable.'); } }}>Remove capture</button></>}
              <button className="secondary" onClick={() => download('spraylab-session.json', { settings, results, legacy, profiles })}><Download size={16} />Export session</button>
            </>}
          </div><div className="drawer-footer"><button className="secondary" onClick={() => setSettings({ ...defaults, crosshair: { ...defaults.crosshair } })}><RotateCcw size={15} />Restore defaults</button><button className="primary" onClick={() => setPanel(null)}><Check size={16} />Done</button></div>
        </>}
        {panel === 'weapons' && <div className="drawer-content arsenal">
          <Toggle label="Carry a primary weapon" checked={settings.primaryEnabled} onChange={primaryEnabled=>update({primaryEnabled})}/>
          <label className="select-row">Sidearm<select aria-label="Sidearm" value={settings.sidearm} onChange={e=>update({sidearm:e.target.value as Pistol})}>{pistolIds.map(id=><option key={id} value={id}>{weaponNames[id]}</option>)}</select></label>
          {settings.primaryEnabled && settings.weapon !== settings.sidearm && <label className="select-row">Finishes for<select aria-label="Skin weapon" value={finishSlot} onChange={e=>setFinishSlot(+e.target.value as 1 | 2)}><option value="1">{weaponNames[settings.weapon]}</option><option value="2">{weaponNames[settings.sidearm]}</option></select></label>}
          <LoadoutFinishes equipment={settings.primaryEnabled && finishSlot === 1 ? settings.weapon : settings.sidearm} profile={progressionState.profile} controller={progression} focusRequest={finishFocusRequest} onShop={id=>{setPanel(null);setArmoryRequest(id);}}/>
          <h2>Weapons</h2>{weaponIds.map(id => <button className={`weapon-item ${selectedWeapon === id ? 'chosen' : ''}`} key={id} onClick={() => {
            const sidearm = pistolIds.includes(id as Pistol);
            update(sidearm ? {sidearm: id as Pistol, primaryEnabled:false} : {weapon:id,primaryEnabled:true});
            if (cosmeticsForEquipment(progressionState.profile, progression.catalog, id).some(item => !item.isDefault)) {
              setFinishSlot(sidearm ? 2 : 1); setFinishFocusRequest(request => request + 1);
            } else setPanel(null);
          }}><img src={cosmeticPreview(progressionState.profile,id)} alt={weaponNames[id]} /><span><b>{weaponNames[id]}</b><small>{gameData.weapons[id].magazine} rounds <i /> {Math.round(60 / gameData.weapons[id].cycle)} RPM</small></span>{id === selectedWeapon && <Check size={18} />}</button>)}</div>}
        {panel === 'history' && <div className="drawer-content history">
          <div className="session-summary"><div><small>ATTEMPTS</small><b>{results.length}</b></div><div><small>AVG. HIT RATE</small><b>{results.filter(r => r.shots).length ? Math.round(results.filter(r => r.shots).reduce((n, r) => n + r.hits / r.shots * 100, 0) / results.filter(r => r.shots).length) : 0}%</b></div><button className="icon-button" aria-label="Export history" title="Export history" onClick={() => download('spraylab-history.json', { results, legacy })}><Download size={18} /></button></div>
          {selected && <section className="replay"><div className="section-title"><h2>{equipmentNames[selected.weapon]} / {historyModeNames[selected.mode]}</h2><span>{selected.mode === 'tracking' ? `${selected.tracking.toFixed(1)}%` : `${selected.hits}/${selected.shots}`}</span></div>{selected.drill&&<DrillReview value={selected.drill}/>} {selected.samples.length > 0 && <><svg viewBox="0 0 400 240" role="img" aria-label="Shot replay, metres relative to target head"><path d="M200 0V240M0 120H400" stroke="#47524d" strokeDasharray="3 5" /><circle cx="200" cy="120" r="10" fill="none" stroke="#8daba0" /><path d="M182 139h36v42h-36z" fill="#394943" />{selected.samples.slice(0, replay).map((s, i) => <g key={i}><circle cx={200 + Math.max(-190, Math.min(190, s.x * 70))} cy={120 - Math.max(-110, Math.min(110, s.y * 70))} r="3" fill={s.head ? '#e6cf6b' : s.hit ? '#6ddbb1' : '#ed9186'} /><title>Round {s.bullet}: {s.x.toFixed(2)}m, {s.y.toFixed(2)}m</title></g>)}</svg><Slider label="Replay round" value={replay} min={0} max={selected.samples.length} onChange={setReplay} /></>}</section>}
          <h2>Recent attempts</h2>{!results.length && <p className="empty-state">No attempts yet.</p>}{results.map(r => <button key={r.id} className={`history-row ${selected?.id === r.id ? 'selected' : ''}`} onClick={() => { setSelected(r); setReplay(r.samples.length); }}><span><b>{equipmentNames[r.weapon]}</b><small>{historyModeNames[r.mode]} / {new Date(r.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span><strong>{r.mode==='precision' ? r.drill?.movementScore===undefined?'Unscored':`${r.drill.movementScore}/100` : `${Math.round(r.mode === 'tracking' ? r.tracking : r.shots ? r.hits / r.shots * 100 : 0)}%`}</strong><ChevronDown size={14} /></button>)}
          {legacy.length > 0 && <><h2>Previous-version history</h2>{legacy.map(r => <div className="history-row" key={r.id}><span>{r.weaponName}<small>{new Date(r.createdAt).toLocaleDateString()}</small></span><b>{r.scores.overall} score</b></div>)}</>}
        </div>}
      </aside>
    </div>}
    {tutorial && <MovementTutorial close={() => setTutorial(false)} practice={() => {setTutorial(false); update({mode: 'precision', spread: true, drillPace: 'practice'});}}/>}
  </main>;
}
