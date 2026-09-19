import {REPOSITION_SHOTS,type DrillMetrics,type DrillMode} from './drills';

function issue(mode:DrillMode,m:DrillMetrics) {
  if(m.passed)return 'clean';
  if(!m.shots)return 'late';
  if(mode==='peek'&&m.entryError===null)return 'cover';
  if(m.settledShots<m.shots)return 'moving';
  if(mode==='peek'&&!m.counterStrafed)return 'braking';
  if(m.diagonal&&mode!=='precision')return 'diagonal';
  if(!m.hits)return 'aim';
  if(!m.heads&&mode!=='burst')return 'height';
  if(mode==='burst'&&m.hits<Math.ceil(REPOSITION_SHOTS*2/3))return 'spray';
  return 'alignment';
}
const messages={clean:'Clean rep',late:'Commit to the shot',cover:'Clear the wall first',moving:'Stop before firing',braking:'Counter-strafe first',diagonal:'Use a lateral entry',aim:'Settle on the target',height:'Hold head height',spray:'Control the spray',alignment:'Prepare the angle'};
const tips={clean:'',late:'Pre-aim the angle, brake, then commit.',cover:'Strafe until the exposed head is clear before shooting.',moving:'Release your strafe, tap the opposite key, then shoot.',braking:'Build lateral speed, then briefly tap the opposite direction.',diagonal:'Release forward movement before clearing the corner.',aim:'Make one deliberate correction, then settle before firing.',height:'Prepare at head height before exposing the angle.',spray:'Pull down smoothly through the burst; avoid large corrections.',alignment:'Let your strafe finish the pre-aim; correct unexpected angles.'};
export type RepFeedback={message:string;tip?:string;passed:boolean};
export function makeRepFeedback(mode:DrillMode,m:DrillMetrics,previous:DrillMetrics[]):RepFeedback {
  const key=issue(mode,m);
  const repeated=key!=='clean'&&previous.length>=2&&previous.slice(0,2).every(p=>issue(mode,p)===key);
  return {message:messages[key],passed:m.passed,tip:repeated ? key==='aim'&&m.covered?'Aim at the exposed part of the target, not through cover.':tips[key] : undefined};
}
