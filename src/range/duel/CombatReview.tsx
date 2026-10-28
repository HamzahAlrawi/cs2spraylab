import {useEffect, useMemo, useRef, useState} from 'react';
import {Download, Pause, Play, SkipBack, X} from 'lucide-react';
import {diagnoseShot, recordingBounds, recordingFrame, type CombatRecording, type ReplayShot} from './combat-replay';
import {describeShotState} from '../shot-state';
import {equipmentNames} from '../equipment';
import './combat-review.css';

export function CombatReview({recording, show, close, download, suspended = false}: {recording: CombatRecording;
  show: (shot: ReplayShot | undefined, time: number, overview: boolean, diagnostic: boolean) => void; close: () => void; download: () => void; suspended?: boolean}) {
  const shots = useMemo(() => recording.shots.filter(shot => shot.shooter === 0), [recording]);
  const [index, setIndex] = useState(0);
  const shot = shots[index];
  const [overview, setOverview] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [analysis, setAnalysis] = useState(false);
  const {first, last} = recordingBounds(recording);
  const [time, setTime] = useState(first);
  const timeRef = useRef(time); timeRef.current = time;
  useEffect(() => {show(analysis ? shot : undefined, time, overview, analysis);}, [shot, time, overview, show, analysis]);
  useEffect(() => {if (suspended) setPlaying(false);}, [suspended]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape') {event.preventDefault(); close();}};
    const visibility = () => {if (document.hidden) setPlaying(false);};
    window.addEventListener('keydown', key); document.addEventListener('visibilitychange', visibility);
    return () => {window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility);};
  }, [close]);
  useEffect(() => {
    if (!playing || suspended) return;
    let previous = performance.now(), frame = 0;
    const advance = (now: number) => {
      const next = Math.min(last, timeRef.current + Math.min(.1, (now - previous) / 1000));
      previous = now; timeRef.current = next; setTime(next);
      if (next >= last) setPlaying(false); else frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [playing, last, suspended]);
  const diagnosis = shot ? diagnoseShot(shot) : undefined;
  const select = (next: number) => {setIndex(next); setTime(shots[next].time); setPlaying(false);};
  const player = recordingFrame(recording, time)?.actors.find(actor => actor.id === 0);
  return <section className="combat-review" aria-label="Combat replay" data-replay-time={time}>
    <div className="combat-review-heading"><strong>Fight replay</strong><span>{player ? `${Math.ceil(player.health)} HP` : ''}</span><button className="icon-button" title="Export recording" aria-label="Export combat recording" onClick={download}><Download size={17}/></button><button className="icon-button" title="Close replay (Esc)" aria-label="Close combat replay" onClick={close}><X size={18}/></button></div>
    <div className="combat-review-transport">
      <button className="icon-button" aria-label={playing ? 'Pause replay' : 'Play replay'} title={playing ? 'Pause replay' : 'Play replay'} disabled={last <= first || suspended} onClick={() => {if (time >= last) setTime(first); setAnalysis(false); setPlaying(value => !value);}}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button>
      <button className="icon-button" aria-label="Restart replay" title="Restart replay" onClick={() => {setTime(first); setPlaying(false); setAnalysis(false);}}><SkipBack size={17}/></button>
      <input aria-label="Replay time" type="range" min={first} max={Math.max(first + .001, last)} step="0.0078125" value={time} onChange={e => {setTime(Number(e.target.value)); setPlaying(false); setAnalysis(false);}}/>
      <output aria-label="Playback position">{Math.max(0, time - first).toFixed(1)} / {(last - first).toFixed(1)}s</output>
    </div>
    <div className="combat-review-view" role="group" aria-label="Replay camera"><button aria-pressed={overview} onClick={() => setOverview(true)}>Overview</button><button aria-pressed={!overview} onClick={() => setOverview(false)}>Player view</button></div>
    {shot && <details className="combat-shot-details" open={analysis} onToggle={event => {
      const open = event.currentTarget.open; setAnalysis(open);
      if (open) {setTime(shot.time); setPlaying(false);}
    }}><summary>Shot analysis</summary>
      <label>Shot <select aria-label="Review shot" value={index} onChange={e => select(Number(e.target.value))}>{shots.map((s, i) => <option key={s.id} value={i}>{i + 1} / {equipmentNames[s.weapon]} / {s.time.toFixed(2)}s</option>)}</select></label>
      <strong>{diagnosis?.label}</strong><p>{diagnosis?.detail}</p>
      {shot.accuracy && <p>{describeShotState(shot.accuracy).label} / {Math.round(shot.accuracy.speedUnits)} u/s</p>}
      <div className="combat-review-legend"><span>Aim ray</span><span>Bullet ray</span><span>Head shape</span></div>
    </details>}
    <details className="combat-decisions"><summary>Bot decisions</summary>{recordingFrame(recording, time)?.decisions?.map(({actor, decision}) => <p key={actor}>
        Bot {actor}: {[decision.phase, decision.peek, decision.intent].filter(Boolean).join(' / ') || 'Holding'}
        {decision.attention && <> / {decision.attention.reason} / {decision.attention.source} / {Math.round(decision.attention.confidence * 100)}% confidence</>}
      </p>)}</details>
  </section>;
}
