import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import {ArrowRight, ArrowUp, Check, Crosshair, Ear, Headphones, Play, RotateCcw, RotateCw, Settings2, Trash2, Volume2} from 'lucide-react';
import {RangeAudio as NativeRangeAudio} from './audio';
import {
  HEARING_CONFIG_KEY, HEARING_HISTORY_KEY, HEARING_HISTORY_LIMIT, HEARING_RADIUS,
  HearingPlayback, HearingTrialDeck, boardHearingPoint, hearingAngle, hearingBoardPosition, hearingDefaults,
  hearingGunNames, hearingGuns, hearingPoint, hearingScoring, hearingSequence, hearingStats,
  normalizeDegrees, normalizeHearingConfig, parseHearingHistory, readHearingStorage, saveHearingStorage, scoreHearing,
  type HearingConfig, type HearingPoint, type HearingResult, type HearingTrial,
} from './hearing-practice';
import './hearing-practice.css';

type Phase = 'idle' | 'loading' | 'playing' | 'waiting' | 'review' | 'paused' | 'error';
export type HearingPracticeProps = {volume: number; suspended?: boolean; openSettings?: () => void};
const metric = (value: number | null, unit = '') => value === null ? '--' : `${value.toFixed(1)}${unit}`;

export function HearingPractice({volume, suspended = false, openSettings}: HearingPracticeProps) {
  const [config, setConfig] = useState(() => normalizeHearingConfig(readHearingStorage(HEARING_CONFIG_KEY)));
  const [history, setHistory] = useState(() => parseHearingHistory(readHearingStorage(HEARING_HISTORY_KEY)));
  const [session, setSession] = useState<HearingResult[]>([]);
  const [phase, setPhase] = useState<Phase>('idle'), [message, setMessage] = useState('Ready');
  const [result, setResult] = useState<HearingResult | null>(null);
  const [heading, setHeading] = useState(0), [angle, setAngle] = useState(0), [distance, setDistance] = useState(12);
  const [hidden, setHidden] = useState(() => document.hidden), [storageFailed, setStorageFailed] = useState(false);
  const audio = useRef<NativeRangeAudio>(), trial = useRef<HearingTrial>(), deck = useRef(new HearingTrialDeck());
  const heard = useRef(false), answered = useRef(false), replays = useRef(0), mounted = useRef(false);
  const playback = useRef<HearingPlayback>();
  if (!playback.current) playback.current = new HearingPlayback(() => audio.current?.stopVoices());
  const gate = playback.current;
  const available = !suspended && !hidden && Number.isFinite(volume) && volume > 0;
  const canAnswer = available && heard.current && !answered.current && (phase === 'playing' || phase === 'waiting');
  const stats = hearingStats(session), savedStats = hearingStats(history);
  const scoring = hearingScoring(config);

  useEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false; gate.cancel();};
  }, [gate]);
  useEffect(() => {
    const native = new NativeRangeAudio({panningModel: config.panner, monoOutput: config.device === 'mono', nativeDistanceCurves: config.falloff === 'native'});
    audio.current = native;
    return () => {gate.cancel(); native.dispose(); if (audio.current === native) audio.current = undefined;};
  }, [config.panner, config.device, config.falloff, gate]);
  useEffect(() => {
    const onVisibility = () => {
      setHidden(document.hidden);
      if (document.hidden) {
        gate.cancel(); heard.current = false;
        setPhase(p => p === 'review' ? p : 'paused'); setMessage('Tab hidden. Audio stopped.');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [gate]);
  useEffect(() => {
    gate.cancel(); heard.current = false;
    if (!available || phase === 'playing' || phase === 'loading' || phase === 'waiting') {
      setPhase(p => p === 'review' ? p : 'paused'); setMessage('Audio paused. Replay to continue.');
    }
  }, [volume, suspended, hidden, gate]);

  function changeConfig(patch: Partial<HearingConfig>) {
    gate.cancel(); heard.current = false; trial.current = undefined; answered.current = false;
    const next = normalizeHearingConfig({...config, ...patch});
    setConfig(next); setResult(null); setPhase('idle'); setMessage('Ready');
    setStorageFailed(!saveHearingStorage(HEARING_CONFIG_KEY, next));
  }

  async function playTrial(next: HearingTrial, yaw = heading, calibration?: string) {
    const token = gate.begin(); heard.current = false;
    const native = audio.current;
    if (!available || !native) return;
    setPhase('loading'); setMessage('Loading native audio...');
    // resume() is invoked synchronously from this click before loading any samples.
    const ready = await native.unlockEvents([next.event]);
    if (!mounted.current || !gate.current(token)) return;
    if (!ready) {setPhase('error'); setMessage('Audio unavailable. Check browser audio permissions and native assets.'); return;}
    native.updateListener({x: 0, y: 0, z: 0}, -yaw * Math.PI / 180, 0);
    const emit = () => {
      if (native.context?.state !== 'running') {
        gate.cancel(); heard.current = false; setPhase('error'); setMessage('Audio interrupted. Replay to resume.'); return;
      }
      let played = false;
      try {
        played = native.playEvent(next.event, Math.min(1, volume) * config.gain * (next.steps ? 1 : .65),
          {position: {...next.point, y: 0}, occluded: next.muffled, range: 55});
      } catch { /* Unsupported audio nodes must not enable a silent answer. */ }
      if (!played) {gate.cancel(); heard.current = false; setPhase('error'); setMessage('Native sample unavailable. Replay to retry.'); return;}
      if (!calibration) heard.current = true;
    };
    setPhase('playing'); setMessage(calibration ? `Calibration: ${calibration}` : 'Listening');
    emit();
    const sequence = hearingSequence(next.steps);
    for (const delay of sequence.slice(1)) gate.schedule(token, delay, emit);
    gate.schedule(token, sequence[sequence.length - 1] + 700, () => {
      native.stopVoices();
      setPhase(calibration ? result ? 'review' : 'paused' : answered.current ? 'review' : 'waiting');
      setMessage(calibration ? `Calibration complete: ${calibration}` : answered.current ? 'Answer revealed' : 'Awaiting answer');
    });
  }

  function nextRound() {
    if (!available) return;
    gate.cancel(); answered.current = false; replays.current = 0;
    const next = deck.current.next(config); trial.current = next;
    setResult(null); setAngle(0); setDistance(12);
    void playTrial(next);
  }
  function replay(yaw = heading) {
    if (!trial.current || !available) return;
    replays.current++;
    void playTrial(trial.current, yaw);
  }
  function rotate(delta: number) {
    const next = normalizeDegrees(heading + delta); setHeading(next);
    gate.cancel(); heard.current = false;
    if (trial.current && available) replay(next);
  }
  function calibrate(kind: 'left' | 'right' | 'near' | 'far') {
    const bearing = kind === 'left' ? -90 : kind === 'right' ? 90 : 0;
    const metres = kind === 'near' ? 4 : kind === 'far' ? 24 : 8;
    void playTrial({point: hearingPoint(heading + bearing, metres), event: config.sounds === 'shots' ? config.gun : `step-${config.surface}`,
      steps: config.sounds !== 'shots', muffled: false}, heading, `${kind}, ${metres} m`);
  }
  function answer(guess: HearingPoint) {
    if (!canAnswer || !trial.current || answered.current || Math.hypot(guess.x, guess.z) < .25) return;
    answered.current = true; gate.cancel(); heard.current = false;
    const target = {...trial.current.point};
    const row: HearingResult = {date: new Date().toISOString(), target, guess, scoring, replays: replays.current, ...scoreHearing(target, guess, scoring)};
    setAngle(hearingAngle(guess)); setDistance(Math.hypot(guess.x, guess.z));
    setResult(row); setPhase('review'); setMessage('Answer revealed');
    setSession(rows => [row, ...rows].slice(0, HEARING_HISTORY_LIMIT));
    const saved = [row, ...history].slice(0, HEARING_HISTORY_LIMIT);
    setHistory(saved); setStorageFailed(!saveHearingStorage(HEARING_HISTORY_KEY, saved));
  }
  function boardKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!canAnswer) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => setAngle(a => normalizeDegrees(a - 5)), ArrowRight: () => setAngle(a => normalizeDegrees(a + 5)),
      ArrowUp: () => setDistance(d => Math.min(24, d + 1)), ArrowDown: () => setDistance(d => Math.max(1, d - 1)),
      Enter: () => answer(hearingPoint(angle, distance)), ' ': () => answer(hearingPoint(angle, distance)),
    };
    if (actions[event.key]) {event.preventDefault(); event.stopPropagation(); actions[event.key]();}
  }
  const status = suspended ? 'Paused while another panel is open.' : hidden ? 'Tab hidden. Audio stopped.'
    : !Number.isFinite(volume) || volume <= 0 ? 'Audio muted. Raise the range volume to practice.' : message;
  const option = <K extends keyof HearingConfig>(key: K, label: string, values: readonly HearingConfig[K][], labels?: readonly string[]) =>
    <label className="hearing-field"><span>{label}</span><select aria-label={label} value={String(config[key])}
      onChange={e => changeConfig({[key]: e.target.value} as Partial<HearingConfig>)}>
      {values.map((v, i) => <option key={String(v)} value={String(v)}>{labels?.[i] ?? String(v)}</option>)}
    </select></label>;

  return <section className="hearing-practice" aria-label="Hearing practice" data-hearing-phase={phase} onKeyDown={e => e.stopPropagation()}>
    <header className="hearing-header"><div><Ear size={21}/><h1>Hearing practice</h1></div>
      <span><Headphones size={16}/>{config.device === 'headphones' ? 'Headphones' : config.device === 'mono' ? 'Mono' : 'Stereo speakers'}</span>
      {openSettings && <button className="hearing-icon" title="Range audio settings" aria-label="Range audio settings" onClick={() => {gate.cancel(); heard.current = false; setPhase(p => p === 'review' ? p : 'paused'); openSettings();}}><Settings2 size={18}/></button>}
    </header>
    <div className="hearing-layout"><main className="hearing-main">
      <div className="hearing-stage-line"><span role="status" aria-live="polite">{status}</span><span>Facing {heading.toFixed(0)}&deg;</span></div>
      <div className="hearing-board" role="group" aria-label="Overhead range board" tabIndex={0} aria-disabled={!canAnswer}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space"
        onKeyDown={boardKey} onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const point = boardHearingPoint((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
          answer(point);
        }}>
        <div className="hearing-rings" aria-hidden="true">{[8, 16, 24].map(r => <div key={r} style={{width: `${r / 28 * 100}%`, height: `${r / 28 * 100}%`}}><span>{r} m</span></div>)}</div>
        <span className="hearing-north">N</span><span className="hearing-east">E</span><span className="hearing-south">S</span><span className="hearing-west">W</span>
        <span className="hearing-listener" title={`Listener facing ${heading} degrees`} style={{transform: `translate(-50%, -50%) rotate(${heading}deg)`}}><ArrowUp size={25}/></span>
        <span className="hearing-guess" aria-label="Your estimate" style={hearingBoardPosition(hearingPoint(angle, distance))}><Crosshair size={21}/></span>
        {result && <span className="hearing-actual" aria-label="Actual sound position" style={hearingBoardPosition(result.target)}><Ear size={20}/></span>}
      </div>
      <div className="hearing-legend"><span><Crosshair size={14}/>Your estimate</span>{result && <span><Ear size={14}/>Actual sound</span>}</div>
      <div className="hearing-actions">
        <button className="hearing-primary" disabled={!available || phase === 'loading'} onClick={nextRound}><Play size={16}/>{result ? 'Next sound' : trial.current ? 'New sound' : 'Start listening'}</button>
        <button className="hearing-icon" disabled={!available || !trial.current} onClick={() => replay()} aria-label="Replay sound" title="Replay sound"><RotateCcw size={18}/></button>
        <button className="hearing-icon" disabled={!available || phase === 'loading'} onClick={() => rotate(-90)} aria-label="Turn listener left 90 degrees" title="Turn left 90 degrees and replay"><RotateCcw size={18}/><span>90&deg;</span></button>
        <button className="hearing-icon" disabled={!available || phase === 'loading'} onClick={() => rotate(90)} aria-label="Turn listener right 90 degrees" title="Turn right 90 degrees and replay"><RotateCw size={18}/><span>90&deg;</span></button>
      </div>
      <div className="hearing-answer-controls">
        <label className="hearing-field"><span>Bearing, &deg;</span><input aria-label="Estimated bearing" type="number" min="0" max="359" step="1" value={Math.round(angle)}
          disabled={!canAnswer} onChange={e => setAngle(normalizeDegrees(Number(e.target.value)))}/></label>
        <label className="hearing-field"><span>Distance, m</span><input aria-label="Estimated distance" type="number" min="1" max={HEARING_RADIUS} step=".5" value={Number(distance.toFixed(1))}
          disabled={!canAnswer} onChange={e => setDistance(Math.max(1, Math.min(24, Number(e.target.value))))}/></label>
        <button disabled={!canAnswer} onClick={() => answer(hearingPoint(angle, distance))}><Check size={17}/>Confirm estimate</button>
      </div>
      <div className="hearing-result" aria-live="polite">
        {result ? <><dl className="hearing-metrics"><div><dt>Score</dt><dd>{result.score}<small>/ 100</small></dd></div>
          <div><dt>Direction error</dt><dd>{result.directionError.toFixed(1)}&deg;{result.scoring === 'distance' && <small>Not scored</small>}</dd></div>
          <div><dt>Distance error</dt><dd>{result.distanceError.toFixed(1)} m{result.scoring === 'direction' && <small>Not scored</small>}</dd></div></dl>
          <p>Actual: {hearingAngle(result.target).toFixed(0)}&deg; / {Math.hypot(result.target.x, result.target.z).toFixed(1)} m
            {trial.current?.muffled ? ' / muffled' : ' / clear'} / {result.replays} replays</p></> : <span>Sound position hidden</span>}
      </div>
    </main><aside className="hearing-settings" aria-label="Hearing configuration">
      <h2>Sound setup</h2>
      <div className="hearing-settings-grid">
        {option('sounds', 'Sounds', ['mix', 'steps', 'shots'], ['Mixed', 'Footsteps', 'Gunshots'])}
        {option('surface', 'Surface', ['concrete', 'wood', 'metal'], ['Concrete', 'Wood', 'Metal'])}
        {option('gun', 'Gun', hearingGuns, hearingGunNames)}
        {option('panner', 'Spatial audio', ['HRTF', 'equalpower'], ['HRTF', 'Equal power'])}
        {option('falloff', 'Distance falloff', ['native', 'calibrated'], ['CS2 native curves', 'Browser calibrated'])}
        {option('device', 'Output device', ['headphones', 'stereo', 'mono'], ['Headphones', 'Stereo speakers', 'Mono'])}
        {option('task', 'Scoring', ['direction-distance', 'direction'], ['Direction + distance', 'Direction only'])}
      </div>
      {config.device === 'mono' && <p className="hearing-note hearing-warning">Mono output is downmixed. Left/right cannot be learned here; only distance is scored.</p>}
      {config.device === 'stereo' && <p className="hearing-note">Speaker placement affects direction cues. HRTF is intended for headphones.</p>}
      <label className="hearing-gain"><span><Volume2 size={15}/>Audio level<output>{Math.round(config.gain * 100)}%</output></span>
        <input aria-label="Audio level" type="range" min="10" max="100" step="5" value={config.gain * 100} onChange={e => changeConfig({gain: +e.target.value / 100})}/></label>
      <label className="hearing-toggle"><input type="checkbox" checked={config.muffled} onChange={e => changeConfig({muffled: e.target.checked})}/>Mix muffled sounds</label>
      <h2>Level calibration</h2>
      <div className="hearing-calibration">{(['left', 'right', 'near', 'far'] as const).map(kind => <button key={kind} disabled={!available} onClick={() => calibrate(kind)}><Volume2 size={14}/>{kind}</button>)}</div>
      <p className="hearing-note">Native sound samples and CS2 distance curves. Browser spatialization is not exact CS2 HRTF. Keep device volume fixed while practicing distance.</p>
      <div className="hearing-section-title"><h2>Session</h2><button className="hearing-icon" aria-label="Reset session statistics" title="Reset session statistics" onClick={() => setSession([])}><RotateCcw size={15}/></button></div>
      <dl className="hearing-session"><div><dt>Answers</dt><dd>{stats.count}</dd></div><div><dt>Mean score</dt><dd>{metric(stats.score)}</dd></div>
        <div><dt>Direction</dt><dd>{metric(stats.direction, '\u00b0')}</dd></div><div><dt>Distance</dt><dd>{metric(stats.distance, ' m')}</dd></div></dl>
      <details className="hearing-history"><summary>Saved history ({history.length})</summary>
        <p>Mean score: {metric(savedStats.score)} / 100</p>
        {history.length > 0 && <><ol>{history.slice(0, 10).map((row, index) => <li key={`${row.date}-${index}`}><span>{new Date(row.date).toLocaleDateString()} <small>{row.scoring}</small></span><b>{row.score}</b></li>)}</ol>
          <button onClick={() => {setHistory([]); setStorageFailed(!saveHearingStorage(HEARING_HISTORY_KEY, []));}}><Trash2 size={14}/>Clear history</button></>}
      </details>
      {storageFailed && <p className="hearing-note hearing-warning" role="status">Browser storage unavailable. Changes last for this visit only.</p>}
      <button className="hearing-reset" onClick={() => changeConfig(hearingDefaults)}><RotateCcw size={14}/>Reset sound setup<ArrowRight size={14}/></button>
    </aside></div>
  </section>;
}

export default HearingPractice;
