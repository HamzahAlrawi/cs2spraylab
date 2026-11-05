import {expect, it, vi} from 'vitest';
import {bodyBehindCover, CoverDiscipline, findBodyCover} from './cover-discipline';
import {testArena, type CoverLane} from './geometry';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {TacticalBrain} from './tactics';
import {createBotTraits} from './skill';
import type {Arena} from './geometry';
import * as geometry from './geometry';

const threat = {x: 0, y: 1.62, z: -8};
const arena = () => ({...testArena(), solids: [{center: {x: 0, y: 1.2, z: 0}, size: {x: 2, y: 2.4, z: .4}}]});
const lane: CoverLane = {side: 1, role: 'camp', anchor: {x: 1.3, y: 0, z: 1},
  retreat: {x: 1.3, y: 0, z: 1}, edge: {x: 2.3, y: 0, z: 1}, watch: threat, axis: {x: 1, z: 0}};
function actor() {
  const self = new DuelSimulation(sanitizeDuelConfig({}), 1, testArena()).snapshot()[1];
  return {...self, position: {x: .85, y: 1.6256, z: 1}, feet: 0, grounded: true, duckAmount: 0};
}
it('rejects eye-safe shoulder/leg exposure and accepts the inset body', () => {
  expect(bodyBehindCover({x: .85, y: 0, z: 1}, 0, threat, arena())).toBe(false);
  expect(bodyBehindCover({x: 0, y: 0, z: 1}, 0, threat, arena())).toBe(true);
});
it('distinguishes a deliberate head-only hold from a hidden reset position', () => {
  const world = arena(); world.solids[0] = {center: {x: 0, y: .81, z: .5}, size: {x: 3, y: 1.62, z: .4}};
  expect(bodyBehindCover({x: 0, y: 0, z: 1}, 0, threat, world)).toBe(false);
  expect(bodyBehindCover({x: 0, y: 0, z: 1}, 0, threat, world, true)).toBe(true);
});
it('finds supported reachable cover without changing actor position or reading another actor', () => {
  const self = actor(), before = structuredClone(self);
  expect(findBodyCover(self, threat, arena(), [{x: 0, y: 0, z: 1}])).toEqual({x: 0, y: 0, z: 1});
  expect(findBodyCover(self, threat, arena(), [{x: 0, y: 0, z: -.6}])).toBeUndefined();
  expect(self).toEqual(before);
});
it('uses actor support rather than a lower visual floor on native ramps', () => {
  const self = actor(), world: Arena = {...arena(), native: {
    ray: () => undefined, fits: (_p, feet) => feet >= .02,
    sweep: (_from, to) => ({position:to, fraction:1, startSolid:false}),
    vertical: () => ({feet:.02, grounded:true, ceiling:false, normal:{x:0,y:1,z:0}}),
  }};
  expect(findBodyCover(self,threat,world,[{x:0,y:0,z:1}])).toEqual({x:0,y:.02,z:1});
  world.native!.vertical=()=>({feet:0,grounded:false,ceiling:false});
  expect(findBodyCover(self,threat,world,[{x:0,y:0,z:1}])).toBeUndefined();
});
it('crouches behind low cover, keeps the stance while sheltered, and releases it for combat', () => {
  const self={...actor(),position:{x:0,y:1.6256,z:1.3}},world=arena();
  world.solids[0]={center:{x:0,y:.73,z:.5},size:{x:12,y:1.46,z:.4}};
  const discipline=new CoverDiscipline('10+',1);
  expect(bodyBehindCover({...self.position,y:0},0,threat,world)).toBe(false);
  expect(discipline.update(self,threat,world,lane,1,true,false)).toBeDefined();
  expect(discipline.crouching).toBe(true);
  const ducked={...self,duckAmount:1,position:{...self.position,y:1.17}};
  discipline.update(ducked,threat,world,lane,2,true,false);
  expect(discipline.crouching).toBe(true);
  discipline.update(ducked,threat,world,lane,2.1,false,false);
  expect(discipline.crouching).toBe(false);
});
it('corrects strong waiting bots, leaves beginners and live combat alone, and caches bounded queries', () => {
  const self = actor(), world = arena(), spy = vi.spyOn(geometry, 'traceSolid');
  try {
    const elite = new CoverDiscipline('10+', 1);
    const goal = elite.update(self, threat, world, lane, 1, true, false);
    expect(goal).toBeDefined(); expect(goal!.x).toBeLessThan(self.position.x);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(170);
    spy.mockClear();
    for (let tick = 1; tick < 40; tick++) expect(elite.update(self, threat, world, lane, 1 + tick / 128, true, false)).toEqual(goal);
    expect(spy).not.toHaveBeenCalled();
    expect(elite.update(self, threat, world, lane, 1.4, false, false)).toBeUndefined();
    expect(new CoverDiscipline(2, 1).update(self, threat, world, lane, 1, true, false)).toBeUndefined();
  } finally {spy.mockRestore();}
});
it('wires body-safe repositioning into strong setup commands, not just a standalone cover utility', () => {
  const self = actor(), world = {...arena(), lanes: [lane]};
  const brain = new TacticalBrain(createBotTraits(10, 1, 1), 'holder', 1, () => .5, world, 10, 'ak47', 1);
  brain.phase = 'setup'; brain.perceive({time: 1, self, visible: null});
  const command = brain.command(self, 1);
  expect(Math.hypot(command.forward ?? 0, command.side ?? 0)).toBeGreaterThan(.1);
  expect(command.fireHeld).toBe(false);
});
it('gives a tucked static camper a validated peek out rather than hiding forever', () => {
  const self=actor(),anchor={x:self.position.x,y:0,z:1};
  const staticLane={...lane,anchor,edge:anchor,retreat:anchor};
  const world: Arena={...arena(),lanes:[staticLane],native:{
    ray:(origin,direction,limit=Infinity)=>direction.y<-.99 && origin.y>=0 && origin.y<=limit
      ? {distance:origin.y,normal:{x:0,y:1,z:0},surfaceId:0,position:{...origin,y:0}} : undefined,
    fits:()=>true,sweep:(_from,to)=>({position:to,fraction:1,startSolid:false}),
    vertical:(_p,_from,to)=>({feet:0,grounded:to<=0,ceiling:false}),
  }};
  const brain=new TacticalBrain(createBotTraits(10,1,1),'holder',1,()=>.5,world,10,'ak47',1);
  brain.phase='setup';brain.perceive({time:1,self,visible:null});brain.command(self,1);
  const updated=(brain as any).lane as CoverLane;
  expect(Math.hypot(updated.anchor.x-updated.edge.x,updated.anchor.z-updated.edge.z)).toBeGreaterThan(.15);
  expect(updated.retreat).toEqual(updated.anchor);
});
