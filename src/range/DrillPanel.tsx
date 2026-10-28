import {Check, MoveHorizontal, Target, Timer, X} from 'lucide-react';
import type {RangeStatus} from './engine';
import {exposureNames,type DrillMetrics} from './drills';
import type {Mode} from './config';
import {CoachingReview} from './CoachingReview';
import type {ReactNode} from 'react';

const hiddenTipsStyles = `
  [data-coaching-tips="false"] .coaching-review > header > h3,
  [data-coaching-tips="false"] .coaching-review > p:not(.coaching-evidence),
  [data-coaching-tips="false"] .coaching-metrics > div > p,
  [data-coaching-tips="false"] .coaching-terms,
  [data-coaching-tips="false"] .duel-coach,
  [data-coaching-tips="false"] .duel-analysis-empty {
    display: none;
  }
`;

// Scope shared review presentation here without changing scoring or the shared renderers.
export function TipsDisplay({showTips = true, children}: {showTips?: boolean; children: ReactNode}) {
  if (showTips) return <>{children}</>;
  return <div data-coaching-tips="false" style={{display: 'contents'}}>
    <style dangerouslySetInnerHTML={{__html: hiddenTipsStyles}}/>
    {children}
  </div>;
}

const degrees=(n:number|null)=>n===null?'--':`${n.toFixed(1)} deg`;
const ms=(n:number|null)=>n===null?'--':`${Math.round(n)} ms`;
export function DrillReview({value:m,showTips=true}:{value:DrillMetrics;showTips?:boolean}) {
  return <TipsDisplay showTips={showTips}><div className="drill-review">
    <div className={`drill-verdict ${m.passed?'passed':''}`}>{m.passed?<Check size={16}/>:<Target size={16}/>}<b>{showTips?m.verdict:m.shots===0?'No shots recorded':m.passed?'Rep passed':'Rep not passed'}</b></div>
    {m.coaching&&<CoachingReview summary={m.coaching}/>}
    <details open={!m.coaching||!showTips}><summary>Rep measurements</summary>
    <dl className="drill-metrics">
      {m.movementScore!==undefined&&<div><dt>Movement score</dt><dd>{m.movementScore}/100</dd></div>}
      {m.peakSpeed!==undefined&&<div><dt>Speed before shot</dt><dd>{Math.round(m.peakSpeed)} u/s</dd></div>}
      <div><dt>Speed at shot</dt><dd>{Math.round(m.speedAtShot)} u/s</dd></div>
      <div><dt title="Shots fired on the ground and below the movement inaccuracy threshold; they may still miss">Shots after stopping</dt><dd>{m.settledShots}/{m.shots}</dd></div>
      <div><dt title="Shots that hit AND were fired after movement slowed down">Hits after stopping</dt><dd title={m.accuracyVerified?undefined:'Older rep: hit-and-movement accuracy was not recorded'}>{m.accuracyVerified?m.accurateShots:'--'}/{m.shots}</dd></div>
      <div><dt>Counter-strafe</dt><dd>{m.counterStrafed?<Check size={15}/>:<X size={15}/>} {m.counterStrafed?'Yes':'No'}</dd></div>
      <div><dt>Aim when you stopped</dt><dd>{m.stopError===null?'Not recorded':m.stoppedOnTarget?m.aimTarget==='body'?'On chest':m.aimTarget==='target'?'On target':'On head':'Needs correction'}</dd></div>
      <div><dt>Aim on reveal</dt><dd>{degrees(m.entryError)}</dd></div>
      <div><dt>Aim at shot</dt><dd>{degrees(m.shotError)}</dd></div>
      <div><dt>Mouse correction</dt><dd>{degrees(m.mouseCorrection)}</dd></div>
      <div><dt>Extra correction</dt><dd>{degrees(m.excessCorrection)}</dd></div>
      <div><dt>Reveal to shot</dt><dd>{ms(m.exposureMs)}</dd></div>
      <div><dt>Stop to shot</dt><dd>{ms(m.stopToShotMs)}</dd></div>
    </dl>
    </details>
    {showTips&&!m.coaching&&<p className="coach-feedback">{m.feedback}</p>}
  </div></TipsDisplay>;
}
export function DrillPanel({status,mode,challenge,peekDuration,showTips=true}:{status:RangeStatus;mode:Mode;challenge:boolean;peekDuration:number;showTips?:boolean}) {
  const d=status.drill;
  if(!d)return null;
  const instruction=mode==='peek'?'Pre-aim the likely angle before leaving cover. Strafe out, counter-strafe, correct to the exposed target and fire. Mouse adjustments are normal on off-angles.':mode==='precision'?'Build at least 65% running speed, release the strafe key and tap the opposite direction to counter-strafe. Land one accurate opening; standing still all rep skips the skill.':'Counter-strafe, fire six controlled rounds, then release the trigger and reposition at least 0.9 m sideways. Compare shots 1-3 with 4-6; body hits count.';
  return <aside className="drill-panel" aria-label="Drill coach">
    <div className="coach-heading"><span>REP {d.round}</span><span>{d.passed}/{d.completed} CLEAN</span></div>
    <h2>{d.scenario}</h2>
    <div className="coach-condition"><span>{exposureNames[d.exposure]}</span><span>{mode==='peek' ? d.remaining===undefined ? `${peekDuration} s from first shot` : `${d.remaining.toFixed(1)} s remaining` : challenge?'1.5 s exposure':'Practice pace'}</span></div>
    <div className={`coach-state ${d.accurate?'settled':''}`}><MoveHorizontal size={16}/><b>{showTips?(d.phase==='reposition'?'Reposition for next burst':d.phase==='feedback'?'Next angle shortly':d.phase==='prepare'?`Peek ${d.side>0?'right':'left'}`:d.accurate?'Speed settled':'Brake before shooting'):(d.phase==='reposition'?'Reposition phase':d.phase==='feedback'?'Rep complete':d.phase==='prepare'?'Ready':d.accurate?'Speed settled':'Not settled')}</b></div>
    {showTips&&<p className="coach-instruction">{instruction}</p>}
    {d.last?<DrillReview value={d.last} showTips={showTips}/>:showTips&&<div className="coach-awaiting"><Timer size={16}/><span>Shot timing and aim feedback appear after the rep.</span></div>}
  </aside>;
}
