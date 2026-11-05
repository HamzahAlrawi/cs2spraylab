import {Vector3} from 'three';
import type {Settings} from './config';
import type {Vec} from './actor-physics';
import type {DuelScenario} from './duel/scenario';
import {DuelSimulation,type CombatActor} from './duel/simulation';
import {idleCommand,type ActorCommand} from './duel/types';
import {canFitInArena,traceSolid} from './duel/geometry';
import type {AwarenessWorld} from './awareness-map';
import {nearbyAwarenessSources,awarenessRunEdge,AWARENESS_RELOCATE_DISTANCE} from './awareness-sources';
import {sanitizeDuelConfig} from './duel/config';
import {AcousticScene,type AcousticPath} from './spatial-audio';
import {configureArenaAcoustics} from './duel/native-acoustics';
import {surfaceFootstepMaterial} from './prefire/native-surfaces';
import {footstepEventKey} from './sound-model';
import {randomStream} from './duel/rng';
import {DuelWeaponState} from './duel/weapon-state';
import type {Equipment} from './equipment';
import {awarenessCues,awarenessGain,scoreAwareness,type AwarenessConfig,type AwarenessCue,type AwarenessAnswer} from './awareness';

export class AwarenessSimulation extends DuelSimulation {
  activity?:{kind:'run'|'jump'|'shots'|'reload';start:number;until:number;anchor:Vec;edge:Vec;out:boolean;lastTurn:number;lastFire:number;started:boolean};
  protected override roundCanFinish(){return false;}
  protected override weaponCommand(actor:CombatActor,command:ActorCommand) {
    if(actor.id===0){actor.weapon.reload.infiniteReserve=true;actor.weapon.reserve=Math.max(actor.weapon.reserve,actor.weapon.reload.stats.magazine);}
    return command;
  }
  override step(){
    for(const actor of this.actors)actor.health=1e9;
    const actor=this.actors[1],a=this.activity;
    const command=idleCommand();
    command.crouch=(actor.duckAmount??0)>.5;
    if(a&&this.time>=a.start&&this.time<a.until){
      if(a.kind==='run'){
        let goal=a.out?a.edge:a.anchor;
        if(Math.hypot(goal.x-actor.position.x,goal.z-actor.position.z)<.16&&this.time-a.lastTurn>.12){a.out=!a.out;a.lastTurn=this.time;goal=a.out?a.edge:a.anchor;}
        const dx=goal.x-actor.position.x,dz=goal.z-actor.position.z,d=Math.hypot(dx,dz);
        if(d>.04){const x=dx/d,z=dz/d;command.forward=-x*Math.sin(actor.yaw)-z*Math.cos(actor.yaw);command.side=x*Math.cos(actor.yaw)-z*Math.sin(actor.yaw);}
      }else if(a.kind==='jump'&&!a.started){command.jumpPressed=true;command.jump=true;a.started=true;}
      else if(a.kind==='reload'&&!a.started){command.reloadPressed=true;a.started=true;}
      else if(a.kind==='shots'){
        command.fireHeld=true;
        if(this.time-a.lastFire>(actor.weapon.id==='usp'?.24:.1)){command.firePressed=true;a.lastFire=this.time;}
      }
    }
    this.command(1,command);super.step();
  }
}
type Trial={cue:AwarenessCue;feet:Vec;point:Vec;target:Vec;listener:Vec;crouched:boolean;sequence:{at:number;key:string}[];
  start:number;cursor:number;heardAt?:number;lastHeardAt?:number;replays:number;volume:number;paused?:boolean;silenced?:boolean;answer?:AwarenessAnswer;finishedAt?:number;path?:AcousticPath;loading?:boolean;activity?:AwarenessSimulation['activity'];reloadAt?:number;playedLabel?:string};
export type AwarenessReport={message:string;cue?:string;origin?:string;answer?:AwarenessAnswer;heard:boolean;attempts:number;replays:number;unavailable:boolean};
export type AwarenessMarker={visible:boolean;hint:boolean;x:number;y:number;height:number;angle:number;offscreen:boolean};
const quiet=()=>({visible:false,hint:false,x:0,y:0,height:0,angle:0,offscreen:false});
export function awarenessDuelConfig(config:AwarenessConfig){return sanitizeDuelConfig({mapId:config.mapId,
  botCount:1,skill:1,behavior:'holder',health:500,playerHealth:100,utilitiesEnabled:false,botUtilities:false,tradeEnabled:false,
  routeGuide:false,radarEnabled:true,radarRotate:true,radarScale:.4});}

/** Training-only source placements. No live-player sensing, automatic aim or game integration. */
export class AwarenessSession implements DuelScenario {
  readonly kind='awareness' as const;
  readonly scene;
  private trial?:Trial;
  private nextAt=1;
  private random=randomStream(1,'awareness');
  private readonly acoustics=new AcousticScene();
  private previousSource='';
  private active=false;
  private message='Enter the map to listen';
  private unavailable=false;
  private attempts=0;
  private newAnswer?:AwarenessAnswer;
  private sim?:AwarenessSimulation;
  private audio?:import('./audio').RangeAudio;
  private stopSource(){if(this.sim){this.sim.activity=undefined;this.sim.actors[1].weapon.reload.cancel();}this.audio?.cancelAction(1);}
  estimate=12;
  onMarker?:(marker:AwarenessMarker)=>void;
  constructor(readonly base:AwarenessWorld,public config:AwarenessConfig) {this.scene=base.scene;}
  get mapId(){return this.base.mapId;}
  get name(){return this.base.name;}
  configure(config:AwarenessConfig){this.stopSource();this.config=config;this.trial=undefined;this.nextAt=0;this.unavailable=false;this.onMarker?.(quiet());}
  create(settings:Settings,seed:number) {
    const sim=new AwarenessSimulation(awarenessDuelConfig(this.config),seed,this.base.arena,settings.weapon,settings.sidearm,settings.primaryEnabled);
    for(const actor of sim.actors.slice(1))sim.command(actor.id,idleCommand());
    this.random=randomStream(seed,'awareness');this.trial=undefined;this.nextAt=1;this.active=false;
    this.sim=sim;configureArenaAcoustics(this.acoustics,sim.arena);return sim;
  }
  updateView(position:Vec){this.base.updateView(position);}
  radarOverview(feet:number){return this.base.radarOverview(feet);}
  loadingReport(){return this.base.loadingReport();}
  takeAnswer(){const answer=this.newAnswer;this.newAnswer=undefined;return answer;}
  statusReport():AwarenessReport {const t=this.trial;return {message:this.message,cue:t&&(t.heardAt!==undefined&&(this.config.stage!=='training'||t.answer)||t.answer)?t.playedLabel??t.cue.label:undefined,
    origin:t&&(this.config.stage==='reveal'||t.answer)?t.cue.origin:undefined,answer:t?.answer,heard:t?.heardAt!==undefined,
    attempts:this.attempts,replays:t?.replays??0,unavailable:this.unavailable};}
  next(now:number){this.stopSource();this.audio?.stopVoices();this.trial=undefined;this.nextAt=now+.6;this.message='Listen for the next cue';this.onMarker?.(quiet());}
  replay(now:number){const t=this.trial;if(!t)return;t.replays++;t.cursor=0;t.start=now+.2;
    t.answer=undefined;t.finishedAt=undefined;t.lastHeardAt=undefined;t.silenced=false;
    this.audio?.stopVoices();
    if(t.activity&&this.sim){const duration=t.activity.until-t.activity.start;t.activity={...t.activity,start:t.start,until:t.start+duration,out:true,lastTurn:-Infinity,started:false,lastFire:-Infinity};this.sim.activity=t.activity;
      const source=this.sim.actors[1];source.feet=t.activity.anchor.y;source.position={...t.activity.anchor,y:source.feet+source.eyeHeight};source.velocity={x:0,z:0};source.verticalVelocity=0;
      source.weapon.reload.cancel();source.weapon.ammo=t.activity.kind==='reload'?0:source.weapon.reload.stats.magazine;t.reloadAt=undefined;}
    if(!t.answer)t.heardAt=undefined;this.unavailable=false;this.message='Replaying the same source';}
  radarContacts(sim:DuelSimulation){const t=this.trial,now=sim.time;
    return t&&t.heardAt!==undefined&&now>=t.heardAt&&(t.answer||this.config.stage==='reveal'&&this.config.display!=='screen')&&
      now-(t.finishedAt??t.lastHeardAt??t.heardAt)<3?[{id:1,position:{...t.target},seenAt:now,dead:false}]:[];}
  private choose(sim:DuelSimulation,volume:number) {
    const player=sim.actors[0],arena=sim.arena;
    const unique=nearbyAwarenessSources({...player.position,y:player.feet},arena,this.base.sources,this.random);
    const cues=awarenessCues.filter(c=>(this.config.cues==='mixed'||c.group===this.config.cues)&&c.sequence.length);
    const offset=Math.floor(this.random()*Math.max(1,unique.length)),cueOffset=Math.floor(this.random()*Math.max(1,cues.length));
    const candidates=[...unique.slice(offset),...unique.slice(0,offset)].sort((a,b)=>+(a[0]===this.previousSource)-+(b[0]===this.previousSource));
    for(let i=0;i<candidates.length;i++){
      const [id,location]=candidates[i],feet=location.feet;
      if(Math.hypot(feet.x-player.position.x,feet.z-player.position.z)<2)continue;
      const crouched=!canFitInArena(feet,feet.y,72*.0254,arena);
      if(crouched&&!canFitInArena(feet,feet.y,54*.0254,arena))continue;
      const target={...feet,y:feet.y+(crouched?1:1.5)};
      const d=Math.hypot(target.x-player.position.x,target.y-player.position.y,target.z-player.position.z);
      const direction={x:(target.x-player.position.x)/d,y:(target.y-player.position.y)/d,z:(target.z-player.position.z)/d};
      // The unaided drill must not accidentally turn into a visible-target test.
      if(!Number.isFinite(traceSolid(player.position,direction,arena,d-.03).distance))continue;
      for(let j=0;j<cues.length;j++) {
        const cue=cues[(j+cueOffset)%cues.length],low=cue.group==='steps'||cue.id==='land'||cue.origin==='grenade';
        const point={...feet,y:feet.y+(low ? .08 : cue.id==='jump'?30*.0254:60*.0254)};
        const path=this.acoustics.resolve(player.position,point,sim.time);
        const floor=arena.native?.floorSurfaceAt?.(feet.x,feet.z,feet.y+.2,.5);
        const material=floor?surfaceFootstepMaterial(floor.surface):'concrete';
        const sequence=cue.sequence.map(s=>({...s,key:s.key.startsWith('step-')?footstepEventKey(material):s.key.startsWith('land-')?footstepEventKey(material,true):s.key}));
        if(cue.group==='jump'&&!sequence.some(s=>s.key.startsWith('land-')))sequence.push({at:.8,key:footstepEventKey(material,true)});
        if(cue.id==='sniper')sequence.push({at:0,key:'awp-scope-in'});
        if(!sequence.some(s=>awarenessGain(s.key,path,volume)>=.0015))continue;
        const edge=cue.id==='run'&&!crouched?awarenessRunEdge(feet,arena,location.edge):undefined;
        if(cue.id==='run'&&(crouched||!edge))continue;
        this.previousSource=id;this.unavailable=false;
        const source=sim.actors[1];source.feet=feet.y;source.position={...feet,y:feet.y+(crouched?46:64)*.0254};source.duckAmount=crouched?1:0;
        source.eyeHeight=source.position.y-feet.y;source.velocity={x:0,z:0};source.verticalVelocity=0;source.grounded=true;source.command.crouch=crouched;
        const equipment:Equipment=cue.id==='suppressed'?'usp':cue.id==='sniper'?'awp':'ak47';
        source.weapon=source.inventory.get(equipment)??new DuelWeaponState(equipment,this.random);source.inventory.set(equipment,source.weapon);
        source.weapon.reload.cancel();source.weapon.ammo=cue.group==='reload'?0:source.weapon.reload.stats.magazine;source.weapon.reserve=500;
        // Demo shots are real simulated shots directed away from the listener.
        // They demonstrate the sound; this mode is not a combat encounter.
        source.yaw=Math.atan2(player.position.x-source.position.x,player.position.z-source.position.z);source.pitch=0;
        const start=sim.time+.5,kind:NonNullable<AwarenessSimulation['activity']>['kind']|undefined=cue.id==='run'?'run':cue.group==='jump'?'jump':cue.group==='shots'?'shots':cue.group==='reload'?'reload':undefined;
        const activity=kind?{kind,start,until:start+(kind==='shots'?cue.id==='sniper'?1:.45:3.5),anchor:{...feet},edge:{...edge??feet},out:true,lastTurn:-Infinity,lastFire:-Infinity,started:false}:undefined;
        this.trial={cue,feet:{...feet},point,target:cue.origin==='grenade'?point:target,listener:{...player.position},crouched,sequence,start,cursor:0,replays:0,activity,volume};
        if(this.sim)this.sim.activity=activity;
        this.message='Listen, then shoot toward the source';return;
      }
    }
    this.unavailable=true;this.message='No audible hidden source nearby. Move toward cover or try another cue.';this.nextAt=sim.time+1.5;
  }
  present({sim,audio,camera,events,active,volume,models}:Parameters<NonNullable<DuelScenario['present']>>[0]) {
    this.audio=audio;
    if(!active||volume<=0||audio.context?.state!=='running'){
      const model=models?.get(1);if(model)model.visible=false;
      if(this.active){
        this.stopSource();audio.stopVoices();
        if(this.trial?.heardAt!==undefined&&volume>0){this.trial.paused=true;this.trial.silenced=true;this.trial.cursor=this.trial.sequence.length;}
        else {this.trial=undefined;this.nextAt=sim.time+.6;}
      }
      this.active=false;this.onMarker?.(quiet());return;
    }
    this.active=true;
    if(this.trial&&Math.abs(this.trial.volume-volume)>.001){this.next(sim.time);return;}
    if(!this.trial&&sim.time>=this.nextAt)this.choose(sim,volume);
    const t=this.trial;
    // A preview/unaided actor must not reveal the hidden demonstration source.
    // Grenade impacts identify the grenade, not an opponent standing there.
    const model=models?.get(1);
    if(model)model.visible=model.visible&&!!t&&t.cue.origin==='opponent'&&
      (t.answer!==undefined||this.config.stage==='reveal'&&t.heardAt!==undefined&&sim.time>=t.heardAt);
    if(!t){this.onMarker?.(quiet());return;}
    const listener=sim.actors[0].position;
    if(!t.answer&&Math.hypot(listener.x-t.listener.x,listener.z-t.listener.z)>AWARENESS_RELOCATE_DISTANCE){this.next(sim.time);return;}
    if(t.activity&&t.heardAt===undefined&&t.sequence.some(c=>!audio.canPlayEvent(c.key))){
      const duration=t.activity.until-t.activity.start;t.start=t.activity.start=sim.time+.2;t.activity.until=t.start+duration;
      if(!t.loading){t.loading=true;void audio.unlockEvents(t.sequence.map(c=>c.key)).then(ok=>{
        if(this.trial!==t)return;t.loading=false;if(!ok){this.next(sim.time);this.unavailable=true;this.message='Sound samples unavailable. Try another cue.';}
      });}
      this.message='Preparing sound samples';this.onMarker?.(quiet());return;
    }
    if(t.answer&&this.config.autoNext&&sim.time-(t.finishedAt??sim.time)>2||this.config.experience&&t.heardAt!==undefined&&sim.time-t.heardAt>5){this.next(sim.time);return;}
    const heard=(point:Vec,key:string)=>{
      const path=this.acoustics.resolve(sim.actors[0].position,point,sim.time);
      if(!audio.canPlayEvent(key)||awarenessGain(key,path,volume*(t.cue.group==='shots'?.65:1))<.0015)return false;
      if(t.heardAt===undefined)t.heardAt=sim.time+path.delay;t.lastHeardAt=sim.time+path.delay;t.path=path;t.point={...point};
      const source=sim.actors[1];t.crouched=(source.duckAmount??0)>.5;t.feet={x:point.x,y:source.feet,z:point.z};t.target={...t.feet,y:source.feet+(t.crouched?1:1.5)};
      this.message=this.config.experience?'Listen and explore':'Sound played. Shoot toward its source';
      return true;
    };
    if(t.activity&&!t.answer&&!t.silenced){
      for(const event of events){
        if(event.kind==='fire'&&event.actorId===1&&heard(event.origin,event.equipment))t.playedLabel=t.cue.label;
        if(event.kind==='action'&&event.actorId===1&&event.action==='scope-in'&&heard(sim.actors[1].position,`${event.equipment}-scope-in`))t.playedLabel='Scope opening';
        if(event.kind==='sound'&&event.actorId===1){
          const source=sim.actors[1],point={...event.point,y:event.sound==='jump'?event.point.y:source.feet+.06};
          const floor=sim.arena.native?.floorSurfaceAt?.(point.x,point.z,source.feet+.2,.5),material=floor?surfaceFootstepMaterial(floor.surface):'concrete';
          if(heard(point,event.sound==='jump'?'jump':footstepEventKey(material,event.sound==='landing'))&&t.cue.group==='jump')
            t.playedLabel=event.sound==='jump'?'Jump launch':'Jump landing';
        }
      }
      if(t.activity.kind==='reload'&&sim.actors[1].weapon.reload.active){
        t.reloadAt??=sim.time;
        while(t.cursor<t.sequence.length&&sim.time>=t.reloadAt+t.sequence[t.cursor].at){heard(t.point,t.sequence[t.cursor++].key);}
      }
      if(t.heardAt===undefined&&sim.time>t.activity.until+.5){this.next(sim.time);this.message='No audible cue reached you. Trying another source.';return;}
    }
    while(!t.activity&&t.cursor<t.sequence.length&&sim.time>=t.start+t.sequence[t.cursor].at){
      const cue=t.sequence[t.cursor];
      if(!audio.canPlayEvent(cue.key)){
        this.message='Preparing sound samples';
        if(!t.loading){t.loading=true;void audio.unlockEvents(t.sequence.map(s=>s.key)).then(ok=>{
          if(this.trial!==t)return;t.loading=false;
          if(!ok){this.unavailable=true;this.message='Sound unavailable. Replay or try another cue.';this.trial=undefined;this.nextAt=sim.time+3;}
        });}
        break;
      }
      if(sim.time-t.start-cue.at>.25){t.start=sim.time-cue.at;}
      const path=this.acoustics.resolve(sim.actors[0].position,t.point,sim.time);
      const gain=awarenessGain(cue.key,path,volume);
      const played=gain>=.0015&&audio.playEvent(cue.key,volume,{position:t.point,path});
      t.cursor++;
      if(played){t.path=path;if(t.heardAt===undefined)t.heardAt=sim.time+path.delay;t.lastHeardAt=sim.time+path.delay;this.message=this.config.experience?'Listen and explore':'Sound played. Shoot toward its source';}
    }
    if(!t.activity&&t.cursor===t.sequence.length&&t.heardAt===undefined){this.trial=undefined;this.nextAt=sim.time+1;return;}
    if(t.heardAt!==undefined&&sim.time>=t.heardAt&&!t.answer&&!this.config.experience){
      const shot=events.find((e):e is Extract<typeof e,{kind:'fire'}>=>e.kind==='fire'&&e.actorId===0&&e.equipment!=='knife');
      if(shot&&this.config.device!=='mono') {
        const result=scoreAwareness(shot.origin,shot.direction,t.target,this.config.distanceEstimate?this.estimate:undefined,sim.time-t.heardAt);
        t.answer={at:new Date().toISOString(),mapId:this.mapId,chunk:'full-map',stage:this.config.stage,cue:t.cue.id,device:this.config.device,panner:this.config.panner,
          volume,replays:t.replays,paused:t.paused,...result};t.finishedAt=sim.time;this.stopSource();this.attempts++;this.newAnswer=t.answer;
        this.message='Source revealed';
      } else if(shot)this.message='Mono practice is unscored. Switch to stereo for directional answers.';
    }
    const reveal=t.heardAt!==undefined&&sim.time>=t.heardAt&&(!!t.answer||this.config.stage==='reveal')&&
      sim.time-(t.finishedAt??t.lastHeardAt??t.heardAt)<3;
    const hint=t.heardAt!==undefined&&sim.time>=t.heardAt&&!t.answer&&this.config.stage==='hint'&&sim.time-(t.lastHeardAt??t.heardAt)<3;
    if((!reveal||this.config.display==='radar'&&!t.answer)&&!hint){this.onMarker?.(quiet());return;}
    const at=new Vector3(t.target.x,t.target.y,t.target.z),view=at.clone().applyMatrix4(camera.matrixWorldInverse),projected=at.clone().project(camera);
    const angle=Math.atan2(view.x,-view.z),offscreen=view.z>=0||Math.abs(projected.x)>.9||Math.abs(projected.y)>.85;
    const top=at.clone();top.y=t.feet.y+(t.crouched?54:72)*.0254;top.project(camera);const bottom=at.clone();bottom.y=t.feet.y;bottom.project(camera);
    this.onMarker?.({visible:true,hint,x:Math.max(-.86,Math.min(.86,projected.x)),y:Math.max(-.75,Math.min(.75,projected.y)),
      height:Math.min(1,Math.abs(top.y-bottom.y)),angle:Math.round(angle/(Math.PI/4))*(Math.PI/4),offscreen});
  }
  dispose(){this.trial=undefined;this.onMarker=undefined;this.base.dispose();}
}
