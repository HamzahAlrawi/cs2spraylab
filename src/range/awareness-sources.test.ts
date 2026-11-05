import {expect,it} from 'vitest';
import {nearbyAwarenessSources,awarenessRunEdge,AWARENESS_SOURCE_RADIUS} from './awareness-sources';
import {testArena,type Arena} from './duel/geometry';
import {randomStream} from './duel/rng';

const plane=():Arena=>({...testArena(),minX:-100,maxX:100,minZ:-100,maxZ:100,native:{
  ray:()=>undefined,fits:()=>true,vertical:(_p,_a,_b)=>({feet:0,grounded:true,ceiling:false}),
  sweep:(_a,b)=>({position:b,fraction:1,startSolid:false}),
}});
it('chooses bounded sources around the current player, not the original spawn',()=>{
  const arena=plane(),sources=[{feet:{x:0,y:0,z:5}},{feet:{x:55,y:0,z:5}},{feet:{x:0,y:0,z:90}}];
  for(const x of [0,55]){
    const listener={x,y:0,z:0},pool=nearbyAwarenessSources(listener,arena,sources,randomStream(1,'test'));
    expect(pool.length).toBeGreaterThan(15);expect(pool.length).toBeLessThanOrEqual(64);
    expect(pool.every(([,p])=>Math.hypot(p.feet.x-x,p.feet.y,p.feet.z)<=AWARENESS_SOURCE_RADIUS)).toBe(true);
    expect(pool.some(([,p])=>p.feet.x===x&&p.feet.z===5)).toBe(true);
  }
});
it('does not place a local sound source in voids or inside a solid',()=>{
  const arena=plane();arena.native!.vertical=()=>({feet:-100,grounded:false,ceiling:false});
  expect(nearbyAwarenessSources({x:0,y:0,z:0},arena,[],()=>.5)).toEqual([]);
  arena.native!.vertical=()=>({feet:0,grounded:true,ceiling:false});arena.native!.fits=()=>false;
  expect(nearbyAwarenessSources({x:0,y:0,z:0},arena,[],()=>.5)).toEqual([]);
});
it('requires a supported, walkable local edge for running demonstrations',()=>{
  const arena=plane(),feet={x:0,y:0,z:0};
  expect(awarenessRunEdge(feet,arena)).toEqual({x:1.6,y:0,z:0});
  arena.native!.vertical=()=>({feet:0,grounded:false,ceiling:false});
  expect(awarenessRunEdge(feet,arena)).toBeUndefined();
});
