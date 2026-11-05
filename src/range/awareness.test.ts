import {expect,it,vi} from 'vitest';
import {Group,PerspectiveCamera} from 'three';
import {defaults} from './config';
import {awarenessCues,awarenessEventKeys,awarenessGain,awarenessDefaults,sanitizeAwareness,scoreAwareness,parseAwarenessHistory} from './awareness';
import {AwarenessSession,awarenessDuelConfig} from './awareness-session';
import {testArena,type Arena} from './duel/geometry';
import type {AwarenessWorld} from './awareness-map';
import type {RangeAudio} from './audio';
import type {DuelEvent} from './duel/types';
import jump from './awareness-native-audio.json';

const path={distance:5,gain:1,lowpass:18000,delay:0,apparentPosition:{x:0,y:1,z:0},routed:false,reverb:'outdoor' as const};
it('sanitizes map/assistance preferences without altering existing progression or mode defaults',()=>{
  expect(sanitizeAwareness(null)).toEqual(awarenessDefaults);
  expect(sanitizeAwareness({mapId:'missing',chunk:'missing',gain:Infinity,stage:'wallhack'})).toEqual(awarenessDefaults);
  expect(defaults.mode).toBe('duel');expect(awarenessDuelConfig(awarenessDefaults)).toMatchObject({botCount:1,utilitiesEnabled:false,routeGuide:false});
});
it('uses event-specific native cutoffs; radar broadcast distance is not an audio cutoff',()=>{
  expect(jump.build).toBe('2000942');expect(jump.footsteps.blockDuration).toBe(.15);
  expect(awarenessGain('jump',{...path,distance:3},1)).toBeGreaterThan(0);
  expect(awarenessGain('jump',{...path,distance:13},1)).toBe(0);
  expect(awarenessGain('step-concrete',{...path,distance:27},1)).toBeGreaterThan(0);
  expect(awarenessGain('step-concrete',{...path,distance:28},1)).toBe(0);
  expect(awarenessGain('ak47',{...path,distance:50},1)).toBeGreaterThan(0);
  expect(awarenessGain('ak47',{...path,distance:70},1)).toBeGreaterThan(0);
  expect(awarenessGain('ak47',{...path,distance:74},1)).toBe(0);
  expect(awarenessGain('utility-he-bounce',path,1)).toBeGreaterThan(0);
  expect(awarenessGain('unknown',path,1)).toBe(0);
  expect(awarenessGain('ak47',path,0)).toBe(0);
  expect(awarenessEventKeys('mixed')).not.toEqual(expect.arrayContaining(['utility-he-draw','utility-he-pin']));
  expect(awarenessCues.every(c=>c.sequence.length>0)).toBe(true);
});
it('scores the actual fired ray with distance optional, not crosshair screen coordinates',()=>{
  const origin={x:0,y:1.6,z:0},target={x:0,y:1.6,z:-10};
  expect(scoreAwareness(origin,{x:0,y:0,z:-1},target,10,.4)).toEqual({degrees:0,distanceError:0,milliseconds:400,score:100});
  expect(scoreAwareness(origin,{x:1,y:0,z:0},target,undefined,1).score).toBe(0);
  expect(scoreAwareness(origin,{x:0,y:0,z:0},target,undefined,1).degrees).toBe(180);
  expect(parseAwarenessHistory([{score:100},null])).toEqual([]);
});
function fixture(stage:'reveal'|'hint'|'training'='reveal',cues:'utility'|'steps'|'jump'|'shots'|'reload'='utility'){
  const config={...awarenessDefaults,stage,cues};
  const anchor={x:0,y:0,z:-3};
  const arena:Arena={...testArena(),solids:[{center:{x:0,y:2,z:0},size:{x:3,y:4,z:.4}}],
    lanes:[{side:1,anchor,retreat:anchor,edge:{...anchor,x:2}}],spawns:{player:{feet:{x:0,y:0,z:4},yaw:0},bots:[{feet:anchor,yaw:Math.PI}]}};
  const base:AwarenessWorld={scene:new Group(),mapId:config.mapId,name:'Fixture',arena,sources:[{feet:anchor,edge:{...anchor,x:2}}],
    updateView:vi.fn(),radarOverview:()=>undefined,loadingReport:()=>undefined,dispose:vi.fn()};
  const session=new AwarenessSession(base,config),sim=session.create(defaults,1),onMarker=vi.fn();session.onMarker=onMarker;
  const camera=new PerspectiveCamera(74,1.6,.03,100);camera.position.set(0,1.6,4);camera.updateMatrixWorld();
  const audio={context:{state:'running'},canPlayEvent:()=>true,playEvent:vi.fn(()=>true),cancelAction:vi.fn(),stopVoices:vi.fn(),unlockEvents:vi.fn(async()=>true)} as unknown as RangeAudio;
  const frame=(time:number,events:DuelEvent[]=[],volume=.2,active=true)=>{sim.time=time;session.present({sim,audio,camera,events,active,volume});};
  return {session,sim,frame,audio,onMarker};
}
it.each(['reveal','hint','training'] as const)('%s assistance cannot reveal a source before audible playback',stage=>{
  const {session,sim,frame,audio,onMarker}=fixture(stage);
  frame(1);expect(session.statusReport().heard).toBe(false);expect(session.radarContacts(sim)).toEqual([]);
  frame(1.6);expect(audio.playEvent).toHaveBeenCalled();frame(1.8);
  expect(session.statusReport().heard).toBe(true);
  expect(onMarker.mock.lastCall![0].visible).toBe(stage!=='training');
  expect(onMarker.mock.lastCall![0].hint).toBe(stage==='hint');
  expect(session.radarContacts(sim).length).toBe(stage==='reveal'?1:0);
  if(stage==='training')expect(session.statusReport().cue).toBeUndefined();
});
it('does not score silent/muted trials and records one answer at the frozen heard location',()=>{
  const {session,sim,frame,onMarker}=fixture('training');frame(1,[],0);expect(session.statusReport().heard).toBe(false);
  frame(2);frame(2.6);frame(2.8);
  const t=(session as any).trial,point={...t.target};
  sim.actors[1].position.x+=4;
  const origin=sim.actors[0].position,d={x:point.x-origin.x,y:point.y-origin.y,z:point.z-origin.z};
  const shot:DuelEvent={kind:'fire',tick:1,actorId:0,equipment:'ak47',shotId:1,origin:{...origin},direction:d};
  frame(3,[shot]);expect(session.takeAnswer()).toMatchObject({score:100,stage:'training'});
  frame(3.1,[shot]);expect(session.takeAnswer()).toBeUndefined();
  expect(onMarker.mock.lastCall![0].visible).toBe(true);
  expect(session.statusReport().attempts).toBe(1);
});
it('keeps infinite-reserve reloads and scripted sources out of the Duel reward path',()=>{
  const {sim}=fixture();sim.start();sim.actors[0].weapon.ammo=0;sim.actors[0].weapon.reserve=0;
  sim.step();expect(sim.actors[0].weapon.reload.infiniteReserve).toBe(true);
  expect(sim.actors[0].weapon.ammo).toBe(0);expect(sim.actors[0].weapon.reload.active).toBe(true);
  expect(sim.actors[1].weapon.reload.infiniteReserve).toBe(false);
});
it('keeps a low-cover source crouched during its sound demonstration',()=>{
  const {sim}=fixture();sim.start();const source=sim.actors[1];
  source.duckAmount=1;source.eyeHeight=46*.0254;source.position.y=source.feet+source.eyeHeight;
  for(let i=0;i<128;i++)sim.step();
  expect(source.command.crouch).toBe(true);expect(source.duckAmount).toBe(1);
});
it.each(['steps','jump','shots'] as const)('%s cues come from native shared-physics actor actions, not stationary sample playback',group=>{
  const {sim,session,frame}=fixture('reveal',group);sim.start();let eventCount=0;
  for(let i=0;i<6*128;i++){
    sim.step();const events=sim.drainEvents();
    eventCount+=events.filter(e=>group==='shots'?e.kind==='fire'&&e.actorId===1:e.kind==='sound'&&e.actorId===1).length;
    expect(events.some(e=>e.kind==='hit'&&e.victim===0)).toBe(false);
    frame(sim.time,events);
  }
  expect(eventCount).toBeGreaterThan(0);expect(session.statusReport().heard).toBe(true);
});
it('preserves a heard trial across pause for a distance estimate, excludes it from strict baselines, and can replay it',()=>{
  const {session,sim,frame}=fixture('training');frame(1);frame(1.6);frame(1.8);
  const target={...(session as any).trial.target};frame(2,[],.2,false);
  expect(session.statusReport().heard).toBe(true);
  const origin=sim.actors[0].position;
  frame(2.1,[{kind:'fire',tick:1,actorId:0,equipment:'ak47',shotId:1,origin,direction:{x:target.x-origin.x,y:target.y-origin.y,z:target.z-origin.z}}]);
  expect(session.takeAnswer()).toMatchObject({score:100,paused:true});
  session.replay(3);frame(3.3);frame(3.5);
  expect(session.statusReport()).toMatchObject({heard:true,replays:1});
});
it('discards an unanswered distant trial when the learner walks to another part of the map',()=>{
  const {session,sim,frame,audio,onMarker}=fixture();frame(1);frame(1.6);frame(1.8);
  expect(session.statusReport().heard).toBe(true);sim.actors[0].position.x+=9;frame(2);
  expect(session.statusReport().heard).toBe(false);expect(session.takeAnswer()).toBeUndefined();
  expect(audio.stopVoices).toHaveBeenCalled();expect(onMarker.mock.lastCall![0].visible).toBe(false);
});
it('runs a real reload rather than playing foley while the demonstrator holds a full magazine',()=>{
  const {sim,frame,session}=fixture('reveal','reload');sim.start();let started=false;
  for(let i=0;i<5*128;i++){sim.step();const events=sim.drainEvents();started ||= events.some(e=>e.kind==='action'&&e.actorId===1&&e.action==='reload-start');frame(sim.time,events);}
  expect(started).toBe(true);expect(session.statusReport().heard).toBe(true);
});
it.each([['rifle',0],['suppressed',.4],['sniper',.9]] as const)('%s demonstrations actually fire after native readiness gates',(_id,random)=>{
  const {sim,session,frame}=fixture('reveal','shots');(session as any).random=()=>random||.1;sim.start();let fired=0;
  for(let i=0;i<4*128;i++){sim.step();const events=sim.drainEvents();fired+=events.filter(e=>e.kind==='fire'&&e.actorId===1).length;frame(sim.time,events);}
  expect((session as any).trial.cue.id).toBe(_id);expect(fired).toBeGreaterThan(0);expect(session.statusReport().heard).toBe(true);
});
