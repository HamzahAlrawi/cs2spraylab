import {defaultNativeMapId,nativeMaps} from './prefire/maps';
import {nativeSoundTimelines,soundEnvelopeGain,type SoundEnvelope} from './sound-model';
import sounds from './sound-events-data.json';
import native from './awareness-native-audio.json';
import footsteps from './native-footsteps-data.json';
import weaponAudio from './weapon-sound-events-data.json';
import type {Vec} from './actor-physics';
import type {AcousticPath} from './spatial-audio';

export type AwarenessStage='reveal'|'hint'|'training';
export type CueGroup='mixed'|'steps'|'jump'|'shots'|'reload'|'utility';
export type AwarenessConfig={mapId:string;chunk:string;stage:AwarenessStage;display:'screen'|'radar'|'both';
  cues:CueGroup;experience:boolean;autoNext:boolean;device:'headphones'|'stereo'|'mono';panner:'HRTF'|'equalpower';gain:number;distanceEstimate:boolean};
export const awarenessKey='spraylab.awareness.v1',awarenessHistoryKey='spraylab.awareness.history.v1';
export const awarenessDefaults:AwarenessConfig={mapId:defaultNativeMapId,chunk:'random',stage:'reveal',display:'both',cues:'mixed',experience:false,autoNext:true,device:'headphones',panner:'HRTF',gain:1,distanceEstimate:false};
export function sanitizeAwareness(raw:unknown):AwarenessConfig {
  const o=(raw&&typeof raw==='object'?raw:{}) as Partial<AwarenessConfig>;
  const mapId=nativeMaps.has(o.mapId)?o.mapId:defaultNativeMapId;
  return {...awarenessDefaults,mapId,chunk:nativeMaps.get(mapId).chunks.some(c=>c.id===o.chunk)?o.chunk!:'random',
    stage:['reveal','hint','training'].includes(o.stage!)?o.stage!:'reveal',display:['screen','radar','both'].includes(o.display!)?o.display!:'both',
    cues:['mixed','steps','jump','shots','reload','utility'].includes(o.cues!)?o.cues!:'mixed',experience:o.experience===true,autoNext:o.autoNext!==false,
    device:['headphones','stereo','mono'].includes(o.device!)?o.device!:'headphones',panner:o.panner==='equalpower'?'equalpower':'HRTF',
    gain:typeof o.gain==='number'&&Number.isFinite(o.gain)?Math.max(.1,Math.min(1,o.gain)):1,distanceEstimate:o.distanceEstimate===true};
}
export type AwarenessCue={id:string;label:string;group:Exclude<CueGroup,'mixed'>;origin:'opponent'|'grenade';sequence:readonly {at:number;key:string}[]};
const sequence=(key:string,times=[0])=>times.map(at=>({at,key}));
export const awarenessCues:readonly AwarenessCue[]=[
  {id:'run',label:'Running footsteps',group:'steps',origin:'opponent',sequence:sequence('step-concrete',[0,.3,.6,.9])},
  {id:'jump',label:'Jump launch',group:'jump',origin:'opponent',sequence:sequence('jump')},
  {id:'land',label:'Jump landing',group:'jump',origin:'opponent',sequence:sequence('land-concrete')},
  {id:'rifle',label:'AK-47 burst',group:'shots',origin:'opponent',sequence:sequence('ak47',[0,.1,.2])},
  {id:'suppressed',label:'Suppressed USP-S',group:'shots',origin:'opponent',sequence:sequence('usp')},
  {id:'sniper',label:'AWP report',group:'shots',origin:'opponent',sequence:sequence('awp')},
  {id:'reload',label:'AK-47 reload',group:'reload',origin:'opponent',sequence:(nativeSoundTimelines.ak47?.reload?.cues??[])
    .filter(cue=>cue.audience!=='local').map(cue=>({at:cue.time,key:cue.key}))},
  {id:'bounce',label:'HE grenade bounce',group:'utility',origin:'grenade',sequence:sequence('utility-he-bounce',[0,.4,.7])},
  {id:'smoke-bounce',label:'Smoke grenade bounce',group:'utility',origin:'grenade',sequence:sequence('utility-smoke-bounce',[0,.4,.7])},
  {id:'explosion',label:'HE explosion',group:'utility',origin:'grenade',sequence:sequence('utility-he-detonate')},
  {id:'flash',label:'Flashbang pop',group:'utility',origin:'grenade',sequence:sequence('utility-flash-detonate')},
];
const metadata:Readonly<Record<string,SoundEnvelope>>={...weaponAudio.weapons,...sounds.cues,...footsteps.events,...native.cues,jump:native.jump};
export function awarenessGain(key:string,path:AcousticPath,volume:number) {
  const event=metadata[key];
  return event?Math.max(0,volume)*soundEnvelopeGain(event,path.distance)*path.gain:0;
}
export const awarenessEventKeys=(group:CueGroup)=>[...new Set(awarenessCues.filter(c=>group==='mixed'||c.group===group).flatMap(c=>c.sequence.map(s=>s.key)))];
export type AwarenessAnswer={at:string;mapId:string;chunk:string;stage:AwarenessStage;cue:string;device:AwarenessConfig['device'];panner:AwarenessConfig['panner'];volume:number;
  degrees:number;distanceError:number|null;milliseconds:number;score:number;replays:number;paused?:boolean};
export function scoreAwareness(origin:Vec,direction:Vec,target:Vec,estimated:number|undefined,seconds:number) {
  const dx=target.x-origin.x,dy=target.y-origin.y,dz=target.z-origin.z,range=Math.hypot(dx,dy,dz),length=Math.hypot(direction.x,direction.y,direction.z);
  const cosine=range>1e-8&&length>1e-8?(dx*direction.x+dy*direction.y+dz*direction.z)/(range*length):-1;
  const degrees=Math.acos(Math.max(-1,Math.min(1,cosine)))*180/Math.PI;
  const distanceError=estimated!==undefined&&Number.isFinite(estimated)?Math.abs(estimated-range):null;
  const directional=Math.max(0,1-degrees/60),distance=distanceError===null?null:Math.max(0,1-distanceError/Math.max(4,range*.6));
  return {degrees,distanceError,milliseconds:Math.max(0,seconds*1000),score:Math.round(100*(distance===null?directional:directional*.75+distance*.25))};
}
export function awarenessTip(answer:AwarenessAnswer) {
  if(answer.device==='mono')return 'Mono removes left/right information. Use stereo headphones for directional training; direction scores are not recorded in mono.';
  if(answer.degrees>90)return 'Front/back mix-up. Turn your view slightly and listen again: the change in pan helps resolve the side.';
  if(answer.degrees>25)return 'Clear the sound-side angle first. Use a short turn, then replay to narrow the bearing before committing.';
  if(answer.distanceError!==null&&answer.distanceError>5)return 'Keep your volume fixed. Compare the same cue at near and far positions; a suppressed shot is not a quiet rifle at long range.';
  if(awarenessCues.find(c=>c.id===answer.cue)?.origin==='grenade')return 'Good grenade localization. This sound locates the grenade, not its thrower. Combine it with other cues before committing to an enemy angle.';
  if(answer.cue==='reload')return 'A reload can open a timing to take space, but it can be cancelled. Keep your crosshair on the likely re-peek instead of swinging every possible angle.';
  if(answer.milliseconds>2500)return 'You found the bearing. Next rep, pre-aim the likely exit as soon as the cue starts rather than searching the whole wall.';
  return 'Good sound-side pre-aim. In a match, hold the next reachable exit: sound reveals a past position, not live wall vision.';
}
export function parseAwarenessHistory(raw:unknown):AwarenessAnswer[] {
  if(!Array.isArray(raw))return [];
  return raw.filter((r):r is AwarenessAnswer=>!!r&&typeof r==='object'&&typeof r.at==='string'&&typeof r.mapId==='string'&&typeof r.chunk==='string'&&
    ['reveal','hint','training'].includes(r.stage)&&['headphones','stereo','mono'].includes(r.device)&&['HRTF','equalpower'].includes(r.panner)&&typeof r.cue==='string'&&
    [r.degrees,r.milliseconds,r.score,r.volume,r.replays].every(Number.isFinite)&&r.degrees>=0&&r.degrees<=180&&r.milliseconds>=0&&r.score>=0&&r.score<=100&&
    (r.distanceError===null||Number.isFinite(r.distanceError)&&r.distanceError>=0)).slice(0,100);
}
