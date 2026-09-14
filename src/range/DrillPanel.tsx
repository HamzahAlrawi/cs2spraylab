import {Check, MoveHorizontal, Target, Timer, X} from 'lucide-react';
import type {RangeStatus} from './engine';
import type {DrillMetrics} from './drills';
import type {Mode} from './config';

const degrees=(n:number|null)=>n===null?'--':`${n.toFixed(1)} deg`;
const ms=(n:number|null)=>n===null?'--':`${Math.round(n)} ms`;
export function DrillReview({value:m}:{value:DrillMetrics}) {
  return <div className="drill-review">
    <div className={`drill-verdict ${m.passed?'passed':''}`}>{m.passed?<Check size={16}/>:<Target size={16}/>}<b>{m.verdict}</b></div>
    <dl className="drill-metrics">
      <div><dt>Speed at shot</dt><dd>{Math.round(m.speedAtShot)} u/s</dd></div>
      <div><dt>Accurate shots</dt><dd>{m.accurateShots}/{m.shots}</dd></div>
      <div><dt>Counter-strafe</dt><dd>{m.counterStrafed?<Check size={15}/>:<X size={15}/>} {m.counterStrafed?'Yes':'No'}</dd></div>
      <div><dt>Aimed at stop</dt><dd>{m.stopError===null?'Not recorded':m.stoppedOnTarget?'On head':'Needs correction'}</dd></div>
      <div><dt>Aim on reveal</dt><dd>{degrees(m.entryError)}</dd></div>
      <div><dt>Aim at shot</dt><dd>{degrees(m.shotError)}</dd></div>
      <div><dt>Mouse correction</dt><dd>{degrees(m.mouseCorrection)}</dd></div>
      <div><dt>Extra correction</dt><dd>{degrees(m.excessCorrection)}</dd></div>
      <div><dt>Reveal to shot</dt><dd>{ms(m.exposureMs)}</dd></div>
      <div><dt>Stop to shot</dt><dd>{ms(m.stopToShotMs)}</dd></div>
    </dl>
    <p className="coach-feedback">{m.feedback}</p>
  </div>;
}
export function DrillPanel({status,mode,challenge}:{status:RangeStatus;mode:Mode;challenge:boolean}) {
  const d=status.drill;
  if(!d)return null;
  const instruction=mode==='peek'?'Pre-aim head height. Strafe out, tap the opposite direction, then shoot. Correct with the mouse when the angle needs it.':mode==='precision'?'Place one deliberate shot on the head. Settle the crosshair before clicking; the next rep appears after your shot.':'Fire a controlled three-round burst, move at least 0.9 m sideways, then stop before firing again.';
  return <aside className="drill-panel" aria-label="Drill coach">
    <div className="coach-heading"><span>REP {d.round}</span><span>{d.passed}/{d.completed} CLEAN</span></div>
    <h2>{d.scenario}</h2>
    <div className="coach-condition"><span>{d.covered?'Partial cover':'Open target'}</span><span>{challenge?'1.5 s exposure':'Practice pace'}</span></div>
    <div className={`coach-state ${d.accurate?'settled':''}`}><MoveHorizontal size={16}/><b>{d.phase==='reposition'?'Reposition for next burst':d.phase==='feedback'?'Next angle shortly':d.phase==='prepare'?`Peek ${d.side>0?'right':'left'}`:d.accurate?'Speed settled':'Brake before shooting'}</b></div>
    <p className="coach-instruction">{instruction}</p>
    {d.last?<DrillReview value={d.last}/>:<div className="coach-awaiting"><Timer size={16}/><span>Shot timing and aim feedback appear after the rep.</span></div>}
  </aside>;
}
