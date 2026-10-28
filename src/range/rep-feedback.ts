import {drillCoaching,type DrillMetrics,type DrillMode} from './drills';
import type {CoachingSummary} from './coaching-types';

function smallerPractice(focus:string,mode:DrillMode) {
  if(focus==='Build a real entry')return 'Take 3 single-shot reps: build 65%+ running speed, counter-strafe, then fire. Train the stop before chasing headshots.';
  if(focus==='Brake before the opening shot'||focus==='Land before the opening shot'||focus==='Keep the burst settled')
    return 'Take 3 grounded single-shot reps. Release the strafe key, tap the opposite direction and click after stopping. Add the burst only after 3 clean openings.';
  if(focus==='Use the opposite key')return 'Take 3 dry peeks: build speed, release the strafe key, tap the opposite direction and stop. Then add one shot after the counter-strafe.';
  if(focus==='Clear the cover first')return 'Repeat this angle slowly 3 times. Follow the peek arrow to a clear sightline, then counter-strafe and fire at the exposed part.';
  if(focus==='Prepare the common angle')return 'Repeat this angle 3 times. Pre-aim before leaving cover, strafe into the line, then stop and correct onto the exposed target before clicking.';
  if(focus==='Hold the last three shots')return 'Repeat the six-shot burst at this range. Keep the first three hits and adjust from the late impact group; aim for 2/3 late hits.';
  if(focus==='Commit after alignment')return 'Repeat 3 entries at this angle. Keep the opening hit; shorten only the pause after the crosshair and stop are ready.';
  return mode==='burst'?'Repeat one six-shot burst without moving. Compare the first-three and last-three impact groups, then reposition.':
    'Take 3 deliberate one-shot entries. Pre-aim, counter-strafe and correct to the exposed target before clicking; check each impact before speeding up.';
}

export type RepFeedback={message:string;tip?:string;passed:boolean;evidence?:string;goal?:string;coaching?:CoachingSummary};
export function makeRepFeedback(mode:DrillMode,m:DrillMetrics,previous:DrillMetrics[]):RepFeedback {
  const summary=m.coaching??drillCoaching(mode,m);
  const repeated=!summary.focus.startsWith('Repeat the controlled')&&previous.length>=2&&previous.slice(0,2).every(p=>(p.coaching??drillCoaching(mode,p)).focus===summary.focus);
  const action=repeated?`Try this next (3 similar reps): ${smallerPractice(summary.focus,mode)}`:summary.action;
  return {message:`${summary.focus}${summary.score===null?'':` / ${summary.score}/100`}`,passed:m.passed,
    evidence:summary.evidence,goal:summary.goal,coaching:{...summary,action},tip:action};
}
