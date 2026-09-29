import {EXCESS_MOUSE_LIMIT,REPOSITION_SHOTS,type DrillMetrics,type DrillMode} from './drills';

function issue(mode:DrillMode,m:DrillMetrics) {
  if(!m.shots)return 'late';
  if(mode==='peek'&&m.entryError===null)return 'cover';
  if(mode==='precision'&&(m.entrySpeedRatio ?? 0)<.65)return 'stationary';
  if(m.settledShots<m.shots)return 'moving';
  if((mode==='peek'||mode==='precision')&&!m.counterStrafed)return 'braking';
  if(m.excessCorrection>EXCESS_MOUSE_LIMIT)return 'mouse';
  if(m.passed)return 'clean';
  if(m.diagonal&&mode!=='precision')return 'diagonal';
  if(!m.hits)return 'aim';
  if(!m.heads&&mode!=='burst')return 'height';
  if(mode==='burst'&&m.hits<Math.ceil(REPOSITION_SHOTS*2/3))return 'spray';
  return 'alignment';
}
const messages={clean:'Clean rep',late:'No shot before the timer ended',cover:'Your shot was blocked by cover',stationary:'Move, then counter-strafe',mouse:'Your aim needed extra correction',moving:'You fired while still moving',braking:'You stopped without counter-strafing',diagonal:'You moved diagonally around the corner',aim:'Your shot missed the target',height:'Body hit: start your aim higher',spray:'Too many shots missed the burst',alignment:'Your aim settled after your movement'};
const tips={clean:'Keep the same stop-and-shoot rhythm for the next repetition.',late:'Move out of cover, stop, then fire. Practice pace gives you longer to prepare.',cover:'Move farther sideways until you can see and hit the head. Do not shoot through the wall.',stationary:'Hold A or D to build sideways speed. Release it, briefly tap the opposite key, then shoot.',mouse:'Start at head height. Use a small strafe for horizontal alignment; mouse correction is normal for unexpected positions.',moving:'Moving right? Release D, tap A briefly, then fire as you stop. Crouching alone is not an instant stop.',braking:'Counter-strafing means briefly pressing the opposite movement key to brake. Release D and tap A, or release A and tap D.',diagonal:'Release W or S before the edge. Using A or D alone makes your sideways stop easier to time.',aim:'Move the crosshair onto the visible head before firing. Use the mouse if movement alone cannot line it up.',height:'Raise your crosshair to head height before moving out. Let a small sideways move finish the horizontal alignment.',spray:'Stop before the burst, then pull down as recoil climbs. Review the impact marks to see where the shots went.',alignment:'Prepare the crosshair near the head before moving out, so you need less adjustment after stopping.'};
export type RepFeedback={message:string;tip?:string;passed:boolean};
export function makeRepFeedback(mode:DrillMode,m:DrillMetrics,previous:DrillMetrics[]):RepFeedback {
  const key=issue(mode,m);
  const repeated=key!=='clean'&&previous.length>=2&&previous.slice(0,2).every(p=>issue(mode,p)===key);
  return {message:mode==='precision'?`${messages[key]} / ${m.movementScore ?? 0}/100`:messages[key],passed:m.passed,
    tip: `${repeated ? 'Try this next: ' : ''}${key==='aim'&&m.covered?'Aim at the exposed part of the target, not through cover.':tips[key]}`};
}
