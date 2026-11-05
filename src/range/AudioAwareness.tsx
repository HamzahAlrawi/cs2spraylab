import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowRight,Ear,Eye,Headphones,Pause,Play,RotateCcw,Settings2,SkipForward} from 'lucide-react';
import type {Settings} from './config';
import type {ProgressionController} from './progression';
import {DuelEngine,type DuelStatus} from './duel/DuelEngine';
import {RealMapSession} from './duel/real-map';
import {nativeMaps} from './prefire/maps';
import {AwarenessSession,awarenessDuelConfig,type AwarenessReport} from './awareness-session';
import {awarenessCues,awarenessEventKeys,awarenessHistoryKey,awarenessKey,awarenessTip,parseAwarenessHistory,sanitizeAwareness,type AwarenessConfig} from './awareness';
import {readHearingStorage,saveHearingStorage} from './hearing-practice';
import './duel/duel.css';
import './audio-awareness.css';

const empty:AwarenessReport={message:'Loading map area',heard:false,attempts:0,replays:0,unavailable:false};
export default function AudioAwareness({settings,suspended,openSettings,onEnter,progression}: {
  settings:Settings;suspended:boolean;openSettings:()=>void;onEnter:()=>void;progression?:ProgressionController;
}) {
  const [config,setConfig]=useState(()=>sanitizeAwareness(readHearingStorage(awarenessKey)));
  const [history,setHistory]=useState(()=>parseAwarenessHistory(readHearingStorage(awarenessHistoryKey)));
  const [status,setStatus]=useState<DuelStatus>(),[report,setReport]=useState<AwarenessReport>(empty),[error,setError]=useState(''),[generation,setGeneration]=useState(0);
  const [storageFailed,setStorageFailed]=useState(false),[estimate,setEstimate]=useState(12);
  const host=useRef<HTMLDivElement>(null),crosshair=useRef<HTMLDivElement>(null),marker=useRef<HTMLDivElement>(null);
  const engine=useRef<DuelEngine>(),session=useRef<AwarenessSession>();
  const latest=useRef({settings,config});latest.current={settings,config};
  useEffect(()=>{
    if(!host.current||!crosshair.current)return;
    const abort=new AbortController();let instance:DuelEngine|undefined,practice:AwarenessSession|undefined;
    setStatus(undefined);setReport(empty);setError('');
    void (async()=>{
      try {
        const duel=awarenessDuelConfig(latest.current.config),base=await RealMapSession.load(duel,Math.floor(Math.random()*0x7fffffff),abort.signal);
        if(abort.signal.aborted){base.dispose();return;}
        practice=new AwarenessSession(base,latest.current.config);session.current=practice;
        practice.onMarker=value=>{
          const node=marker.current;if(!node)return;node.hidden=!value.visible;
          node.dataset.origin=localOrigin();
          node.dataset.hint=String(value.hint);node.dataset.offscreen=String(value.offscreen);
          node.style.left=value.hint||value.offscreen?'50%':`${(value.x+1)*50}%`;
          node.style.top=value.hint||value.offscreen?'70%':`${(1-value.y)*50}%`;
          node.style.setProperty('--bearing',`${value.angle}rad`);
          const height=Math.max(22,value.height*(host.current?.clientHeight??500)/2);
          node.style.height=value.hint||value.offscreen?'42px':`${height}px`;node.style.width=`${Math.max(12,Math.min(70,height*.35))}px`;
        };
        const localOrigin=()=>practice?.statusReport().origin??'opponent';
        const local=practice;
        instance=new DuelEngine(host.current!,crosshair.current!,next=>{
          setStatus(next);setReport(local.statusReport());
          const answer=local.takeAnswer();if(answer)setHistory(old=>{
            const rows=[answer,...old].slice(0,100);setStorageFailed(!saveHearingStorage(awarenessHistoryKey,rows));return rows;
          });
        },setError,{...latest.current.settings,volume:latest.current.settings.volume*latest.current.config.gain},duel,progression,practice);
        engine.current=instance;
        instance.audio.configure({panningModel:latest.current.config.panner,monoOutput:latest.current.config.device==='mono'});
      }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Map audio practice could not start.');practice?.dispose();}
    })();
    return()=>{abort.abort();instance?.dispose();practice?.dispose();if(engine.current===instance)engine.current=undefined;if(session.current===practice)session.current=undefined;};
  },[config.mapId,config.chunk,generation]);
  useEffect(()=>{engine.current?.setSettings({...settings,volume:settings.volume*config.gain});},[settings,config.gain]);
  useEffect(()=>{if(suspended)engine.current?.pause();},[suspended]);
  useEffect(()=>{session.current?.configure(config);engine.current?.audio.configure({panningModel:config.panner,monoOutput:config.device==='mono'});},[config]);
  const update=(patch:Partial<AwarenessConfig>)=>setConfig(old=>{
    const next=sanitizeAwareness({...old,...patch});setStorageFailed(!saveHearingStorage(awarenessKey,next));return next;
  });
  const busy=!status||!!status.loadingMap,playing=status?.phase==='fighting'&&!status.paused;
  const comparable=history.filter(a=>a.mapId===config.mapId&&a.stage===config.stage&&a.device===config.device&&a.panner===config.panner&&a.replays===0&&!a.paused&&
    (a.distanceError!==null)===config.distanceEstimate&&Math.abs(a.volume-settings.volume*config.gain)<.001&&
    (config.cues==='mixed'||awarenessCues.find(c=>c.id===a.cue)?.group===config.cues));
  const mean=(key:'score'|'degrees'|'milliseconds')=>comparable.length?(comparable.reduce((sum,a)=>sum+a[key],0)/comparable.length).toFixed(key==='degrees'?1:0):'--';
  const style={'--cross-color':settings.crosshair.color,'--cross-size':`${settings.crosshair.size}px`,'--cross-gap':`${settings.crosshair.gap}px`,
    '--cross-thickness':`${settings.crosshair.thickness}px`,'--cross-outline':`${settings.crosshair.outline}px`,opacity:settings.crosshair.alpha} as CSSProperties;
  const answer=report.answer;
  return <div className="duel-layout awareness-layout" aria-label="Map sound awareness">
    <div className="duel-view awareness-view"><div className="duel-canvas" ref={host} aria-busy={busy}/>
      <div className="duel-topline"><span className="range-badge"><Ear size={14}/>{nativeMaps.get(config.mapId).name} / SOUND AWARENESS</span>
        <span>{config.stage==='reveal'?'ASSISTED':config.stage==='hint'?'DIRECTION HINT':'UNAIDED'}</span></div>
      <div className="follow-origin" ref={crosshair} aria-hidden="true"><div className={`crosshair ${settings.crosshair.t?'t-style':''}`} style={style}>
        <i className="arm top"/><i className="arm right"/><i className="arm bottom"/><i className="arm left"/>{settings.crosshair.dot&&<i className="dot"/>}</div></div>
      <div className="awareness-marker" ref={marker} hidden aria-hidden="true"><span className="awareness-body"/><ArrowRight size={30}/></div>
      {playing&&<div className="awareness-exit"><span>Press ESC to exit</span><button className="icon-button" title="Pause listening" aria-label="Pause listening" onClick={()=>engine.current?.pause()}><Pause size={17}/></button></div>}
      {!playing&&!busy&&!error&&<div className="duel-entry"><button className="primary enter-range" disabled={suspended||settings.volume<=0} onClick={()=>{
        const e=engine.current;if(!e)return;void e.audio.unlockEvents(awarenessEventKeys(config.cues));void e.enter();onEnter();
      }}><Play size={18}/>{status?.paused?'Resume listening':'Start sound practice'}</button></div>}
      {busy&&!error&&<div className="duel-entry" role="status">Preparing map and audio scene</div>}
      {error&&<div className="duel-entry" role="alert"><p>{error}</p><button className="secondary" onClick={()=>setGeneration(n=>n+1)}><RotateCcw size={16}/>Retry</button></div>}
      <div className="awareness-feedback" role="status" aria-live="polite"><strong>{settings.volume<=0?'Audio is muted':report.message}</strong>
        {report.cue&&<span>{report.cue}{report.origin==='grenade'?' / locate the grenade, not the thrower':''}</span>}
        {answer&&<><b>{answer.degrees.toFixed(1)}&deg; error / {(answer.milliseconds/1000).toFixed(2)} s{answer.distanceError!==null?` / ${answer.distanceError.toFixed(1)} m error`:''}</b>
          {settings.showTips&&<p>{awarenessTip(answer)}</p>}</>}
      </div>
      <div className="awareness-ammo">{status?.ammo??'--'} <small>/ &infin;</small>{status?.reloading&&<span>Reloading</span>}</div>
    </div>
    <aside className="duel-controls awareness-settings" aria-label="Sound awareness setup"><header><h2>Sound Awareness</h2><button className="icon-button" title="Audio and mouse settings" aria-label="Audio and mouse settings" onClick={openSettings}><Settings2 size={17}/></button></header>
      <label>Map<select aria-label="Awareness map" value={config.mapId} onChange={e=>update({mapId:e.target.value,chunk:'random'})}>{nativeMaps.list().map(map=><option key={map.id} value={map.id}>{map.name}</option>)}</select></label>
      <label>Area<select aria-label="Awareness area" value={config.chunk} onChange={e=>update({chunk:e.target.value})}><option value="random">Random area</option>{nativeMaps.get(config.mapId).chunks.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button className="secondary" onClick={()=>{if(config.chunk!=='random')update({chunk:'random'});else setGeneration(n=>n+1);}}><RotateCcw size={14}/>New random area</button>
      <fieldset className="awareness-stages"><legend>Assistance</legend>{(['reveal','hint','training'] as const).map(stage=><label key={stage}><input type="radio" name="awareness-stage" value={stage} checked={config.stage===stage} onChange={()=>update({stage})}/>{stage==='reveal'?<Eye size={16}/>:stage==='hint'?<Ear size={16}/>:<Headphones size={16}/>}<span>{stage==='reveal'?'Learn with reveal':stage==='hint'?'Direction hint':'Unaided training'}</span></label>)}</fieldset>
      {config.stage==='reveal'&&<label>Reveal on<select aria-label="Reveal location" value={config.display} onChange={e=>update({display:e.target.value as AwarenessConfig['display']})}><option value="both">Screen and radar</option><option value="screen">Screen only</option><option value="radar">Radar only</option></select></label>}
      <label>Sounds<select aria-label="Awareness cues" value={config.cues} onChange={e=>update({cues:e.target.value as AwarenessConfig['cues']})}>
        <option value="mixed">Mixed cues</option><option value="steps">Running footsteps</option><option value="jump">Jump and landing</option><option value="shots">Gunfire, including suppressed</option><option value="reload">Reloads</option><option value="utility">Grenade impacts and bursts</option></select></label>
      <label className="awareness-toggle"><input type="checkbox" checked={config.experience} onChange={e=>update({experience:e.target.checked})}/>Listen and explore (no answers)</label>
      <label className="awareness-toggle"><input type="checkbox" checked={config.autoNext} onChange={e=>update({autoNext:e.target.checked})}/>Next sound after feedback</label>
      <div className="awareness-actions"><button className="secondary" disabled={!playing||!report.heard} onClick={()=>session.current?.replay(engine.current!.sim.time)}><RotateCcw size={15}/>Replay</button>
        <button className="secondary" disabled={!playing} onClick={()=>session.current?.next(engine.current!.sim.time)}><SkipForward size={15}/>Next sound</button></div>
      <details><summary>Audio setup</summary><label>Output<select aria-label="Awareness output" value={config.device} onChange={e=>update({device:e.target.value as AwarenessConfig['device']})}><option value="headphones">Stereo headphones</option><option value="stereo">Stereo speakers</option><option value="mono">Mono (unscored)</option></select></label>
        <label>Spatialization<select aria-label="Awareness spatialization" value={config.panner} onChange={e=>update({panner:e.target.value as AwarenessConfig['panner']})}><option value="HRTF">HRTF</option><option value="equalpower">Equal power</option></select></label>
        <label>Practice gain<output>{Math.round(config.gain*100)}%</output><input aria-label="Awareness gain" type="range" min="10" max="100" step="5" value={config.gain*100} onChange={e=>update({gain:+e.target.value/100})}/></label>
      </details>
      <label className="awareness-toggle"><input type="checkbox" checked={config.distanceEstimate} onChange={e=>update({distanceEstimate:e.target.checked})}/>Also estimate distance</label>
      {config.distanceEstimate&&<label>Estimated distance (m)<input aria-label="Awareness distance estimate" type="number" min="1" max="100" step="1" value={estimate} onChange={e=>{
        const n=Math.max(1,Math.min(100,+e.target.value||1));setEstimate(n);if(session.current)session.current.estimate=n;
      }}/></label>}
      <section className="awareness-stats" aria-label="Sound awareness results"><h3>{config.stage==='training'?'Unaided':'Assisted'} Results</h3><dl>
        <div><dt>First-listen answers</dt><dd>{comparable.length}</dd></div><div><dt>Direction error</dt><dd>{mean('degrees')}&deg;</dd></div><div><dt>Time to answer</dt><dd>{mean('milliseconds')} ms</dd></div><div><dt>Score</dt><dd>{mean('score')} / 100</dd></div></dl></section>
      <p className="awareness-note">Fire toward the source, even through cover. This scores your estimate, not wall penetration. Radar reveals are training assistance, not CS2 radar behavior.</p>
      <details><summary>Cue reliability</summary><p className="awareness-note">Running, jump/landing, gunfire, reloads and grenade impacts use native samples and event-specific distance curves. Walking/crouch movement stays quiet. Grenade draw/pin foley is not used to locate enemies: the inspected first-person clips are ClientOnly. A bounce marks the grenade, not the thrower.</p><p className="awareness-note">Browser HRTF and doorway propagation are approximations, not Source 2's exact sound engine. Keep system volume fixed. Results from different assistance/output/volume setups are separated.</p></details>
      {storageFailed&&<p role="status" className="awareness-note">Practice results are session-only until browser storage is available. Your progression save is separate.</p>}
    </aside>
  </div>;
}
