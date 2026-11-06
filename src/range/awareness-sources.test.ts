import {expect,it} from 'vitest';
import {nearbyAwarenessSources,awarenessRunEdge,awarenessMixtureWeights,walkAwarenessOffset,awarenessNovelty,rankAwarenessSources,AWARENESS_SOURCE_RADIUS} from './awareness-sources';
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
    expect(pool.every(([,p])=>Math.hypot(p.feet.x-x,p.feet.z-5)<4.51)).toBe(true);
    expect(pool.every(([,p])=>p.feet.x!==x||p.feet.z!==5)).toBe(true);
  }
});
it('does not place a local sound source in voids or inside a solid',()=>{
  const arena=plane();arena.native!.vertical=()=>({feet:-100,grounded:false,ceiling:false});
  const sources=[{feet:{x:0,y:0,z:5}}];
  expect(nearbyAwarenessSources({x:0,y:0,z:0},arena,sources,()=>.5)).toEqual([]);
  arena.native!.vertical=()=>({feet:0,grounded:true,ceiling:false});arena.native!.fits=()=>false;
  expect(nearbyAwarenessSources({x:0,y:0,z:0},arena,sources,()=>.5)).toEqual([]);
});
it('uses a continuous weighted density instead of fixed points or 360-degree listener rings',()=>{
  const arena=plane(),listener={x:0,y:0,z:0},random=randomStream(112,'density');
  const sources=[{feet:{x:-6,y:0,z:5},weight:9},{feet:{x:6,y:0,z:5},weight:1}];
  const samples=Array.from({length:60},()=>nearbyAwarenessSources(listener,arena,sources,random)).flat().map(([,p])=>p.feet);
  const common=samples.filter(p=>p.x<0).length;
  expect(common/samples.length).toBeGreaterThan(.85);expect(common/samples.length).toBeLessThan(.94);
  expect(new Set(samples.map(p=>`${p.x}:${p.z}`)).size).toBe(samples.length);
  expect(samples.every(p=>sources.some(s=>Math.hypot(p.x-s.feet.x,p.z-s.feet.z)<4.51))).toBe(true);
  expect(samples.some(p=>Math.min(...sources.map(s=>Math.hypot(p.x-s.feet.x,p.z-s.feet.z)))>3)).toBe(true);
  expect(nearbyAwarenessSources(listener,arena,[],random)).toEqual([]);
});
it('keeps route coverage from overwhelming hold likelihood because of more path samples',()=>{
  const hold={feet:{x:0,y:0,z:5},kind:'hold' as const,weight:1};
  const routes=Array.from({length:100},(_,i)=>({feet:{x:0,y:0,z:5+i/100},kind:'route' as const}));
  const weights=awarenessMixtureWeights([hold,...routes]);expect(weights[0]).toBeCloseTo(.65);
  expect(weights.slice(1).reduce((a,b)=>a+b,0)).toBeCloseTo(.35);
});
it('spaces recently heard regions and perceived bearings without ever making a common area impossible',()=>{
  const listener={x:0,y:1.6,z:0},old={x:-6,y:1.2,z:-5},fresh={x:6,y:1.2,z:5};
  const history=[{point:old,apparent:old}];
  expect(awarenessNovelty(old,old,listener,history)).toBeGreaterThan(0);
  expect(awarenessNovelty(old,old,listener,history)).toBeLessThan(awarenessNovelty(fresh,fresh,listener,history));
  const ranked=rankAwarenessSources([['old',{feet:{...old,y:0}}],['new',{feet:{...fresh,y:0}}]],listener,history,()=>.5);
  expect(ranked[0][0]).toBe('new');expect(ranked).toHaveLength(2);
  const sameCorner=awarenessNovelty(fresh,old,listener,history);
  expect(sameCorner).toBeLessThan(awarenessNovelty(fresh,fresh,listener,history));
});
it('still favors common areas over a long series with repetition control enabled',()=>{
  const arena=plane(),listener={x:0,y:1.6,z:0},random=randomStream(112,'weighted-series');
  const sources=[{feet:{x:-7,y:0,z:5},weight:9},{feet:{x:7,y:0,z:5},weight:1}];
  const recent:{point:{x:number;y:number;z:number};apparent:{x:number;y:number;z:number}}[]=[];
  let common=0;
  for(let rep=0;rep<200;rep++){
    const pool=nearbyAwarenessSources({...listener,y:0},arena,sources,random);
    const picked=rankAwarenessSources(pool,listener,recent,random)[0][1].feet;
    if(picked.x<0)common++;
    const point={...picked,y:1.2};recent.push({point,apparent:point});if(recent.length>8)recent.shift();
  }
  expect(common/200).toBeGreaterThan(.65);expect(common/200).toBeLessThan(.95);
});
it('rejects supported scenery across a wall or gap instead of snapping onto its floor',()=>{
  const arena=plane(),anchor={x:0,y:0,z:5};
  arena.solids=[{center:{x:.65,y:1,z:5},size:{x:.2,y:2,z:8}}];
  expect(walkAwarenessOffset(anchor,1.4,0,arena)).toBeUndefined();
  arena.solids=[];arena.native!.vertical=(p)=>({feet:0,grounded:p.x<.3||p.x>.8,ceiling:false});
  expect(walkAwarenessOffset(anchor,1.4,0,arena)).toBeUndefined();
  arena.native!.vertical=p=>({feet:p.x>.3?5:0,grounded:true,ceiling:false});
  expect(walkAwarenessOffset(anchor,1.4,0,arena)).toBeUndefined();
});
it('requires a supported, walkable local edge for running demonstrations',()=>{
  const arena=plane(),feet={x:0,y:0,z:0};
  expect(awarenessRunEdge(feet,arena)).toEqual({x:1.6,y:0,z:0});
  arena.native!.vertical=()=>({feet:0,grounded:false,ceiling:false});
  expect(awarenessRunEdge(feet,arena)).toBeUndefined();
});
