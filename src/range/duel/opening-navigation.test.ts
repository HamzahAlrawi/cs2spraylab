import {expect,it,vi} from 'vitest';
import {fitsHull,sweepHull,verticalContact} from '../actor-collision';
import {sanitizeDuelConfig} from './config';
import {prepareNativeNavigation} from './native-navigation';
import {DuelSimulation} from './simulation';
import type {Arena} from './geometry';

function world():Arena {
  const boxes=[{center:{x:0,y:1.5,z:0},size:{x:1,y:3,z:4}}];
  const arena:Arena={minX:-6,maxX:6,minZ:-6,maxZ:6,solids:[],native:{ray:()=>undefined,
    sweep:(from,to,height)=>sweepHull(from,to,height,boxes),fits:(p,feet,height)=>fitsHull(p,feet,height,boxes),
    vertical:(p,from,to,height)=>verticalContact(p,from,to,height,boxes,0)},
    lanes:[{side:1,role:'entry',anchor:{x:3,y:0,z:0},edge:{x:3,y:0,z:1},retreat:{x:3,y:0,z:-1}}],
    spawns:{player:{feet:{x:-3,y:0,z:3},yaw:0},bots:[{feet:{x:3,y:0,z:-3},yaw:Math.PI,lane:0}]} };
  prepareNativeNavigation(arena,[arena.spawns!.player.feet,arena.spawns!.bots[0].feet]);return arena;
}
it('prepares one bot per turn without changing decisions, clocks, randomness or combat output',async()=>{
  const config=sanitizeDuelConfig({utilitiesEnabled:false,skill:8,botCount:1});
  const warm=new DuelSimulation(config,71,world()),cold=new DuelSimulation(config,71,world());
  const before=warm.snapshot(),yieldFrame=vi.fn(async()=>{});
  await warm.prepareOpeningNavigation(new AbortController().signal,yieldFrame);
  expect(yieldFrame).toHaveBeenCalledOnce();expect(warm.time).toBe(0);expect(warm.tick).toBe(0);
  expect(warm.snapshot()).toEqual(before);expect(warm.phase).toBe('ready');
  warm.start();cold.start();for(let tick=0;tick<128;tick++){warm.step();cold.step();}
  expect(warm.snapshot()).toEqual(cold.snapshot());expect(warm.drainEvents()).toEqual(cold.drainEvents());
});
it('honors cancellation without starting a round',async()=>{
  const sim=new DuelSimulation(sanitizeDuelConfig({botCount:1}),71,world()),controller=new AbortController();
  await expect(sim.prepareOpeningNavigation(controller.signal,async()=>{controller.abort();})).rejects.toMatchObject({name:'AbortError'});
  expect(sim.time).toBe(0);expect(sim.phase).toBe('ready');
});
