import {describe,it,expect,vi} from 'vitest';
import {UNIT,type Vec} from '../actor-physics';
import {fitsHull,sweepHull,verticalContact} from '../actor-collision';
import {SightingMemory} from './awareness';
import {traceSolid,type Arena} from './geometry';
import {nativeReachableAround,prepareNativeNavigation} from './native-navigation';
import * as navigation from './native-navigation';
import type {DuelActorSnapshot} from './types';

function fixture(height=0) {
  const boxes=[{center:{x:0,y:height+1.5,z:0},size:{x:6,y:3,z:1.2}}];
  const source:Arena={minX:-9,maxX:9,minZ:-10,maxZ:8,solids:boxes};
  const arena:Arena={...source,solids:[],native:{
    ray:(from,direction,range)=>{
      const hit=traceSolid(from,direction,source,range);
      return Number.isFinite(hit.distance)?{surfaceId:hit.surfaceId,distance:hit.distance,normal:hit.normal!}:undefined;
    },
    fits:(p,feet,h)=>fitsHull(p,feet,h,boxes),sweep:(from,to,h)=>sweepHull(from,to,h,boxes),
    vertical:(p,from,to,h)=>verticalContact(p,from,to,h,boxes,height),
  }};
  const self:DuelActorSnapshot={id:1,generation:0,side:'enemy',position:{x:0,y:height+64*UNIT,z:-8},feet:height,
    grounded:true,velocity:{x:0,z:0},yaw:Math.PI,pitch:0,crouched:false,duckAmount:0,health:100,armor:100,helmet:true,
    alive:true,equipment:'ak47',ammo:30,reloading:false};
  const sight={id:0,position:{x:4.4,y:height+64*UNIT,z:1.4},aimPoint:{x:4.4,y:height+64*UNIT,z:1.4}};
  prepareNativeNavigation(arena,[self.position,sight.position]);
  return {arena,self,sight};
}
const clear=(from:Vec,to:Vec,arena:Arena)=>{
  const distance=Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z);
  return !Number.isFinite(traceSolid(from,{x:(to.x-from.x)/distance,y:(to.y-from.y)/distance,z:(to.z-from.z)/distance},arena,distance-.02).distance);
};

describe('native geometry-aware re-peek attention',()=>{
  it.each([0,14])('looks at a reachable opening instead of the wall containing the last sighting, floor %sm',height=>{
    const {arena,self,sight}=fixture(height),memory=new SightingMemory(10,arena);
    memory.observe({time:0,self,visible:sight});self.position={...self.position,x:-5.5};
    expect(clear(self.position,sight.aimPoint,arena)).toBe(false);
    memory.observe({time:.5,self,visible:null});
    const points=memory.expectations(.5);expect(points.length).toBeGreaterThan(0);
    expect(points.every(exit=>clear(self.position,exit.point,arena))).toBe(true);
    expect(points.every(exit=>exit.travel<=250*UNIT*.5+.3)).toBe(true);
    expect(memory.focus(.5)!.y).toBeCloseTo(height+64*UNIT,8);
    expect(clear(self.position,memory.focus(.5)!,arena)).toBe(true);
    expect(memory.seen!.position).toEqual(sight.position);
  });
  it('uses actual native graph travel, not straight-line distance through cover',()=>{
    const {arena,sight}=fixture(),paths=nativeReachableAround(sight.position,arena,16);
    const other=paths.filter(row=>row.point.x<-3.5 && row.point.z>0);
    expect(other.length).toBeGreaterThan(0);
    expect(other.every(row=>row.travel>=Math.hypot(row.point.x-sight.position.x,row.point.z-sight.position.z))).toBe(true);
    expect(paths.every(row=>row.travel<=16)).toBe(true);expect(paths.length).toBeLessThanOrEqual(384);
  });
  it('caches repeated near-identical native sight losses and does not extend precise memory indefinitely',()=>{
    const {arena,self,sight}=fixture(),memory=new SightingMemory(10,arena),build=vi.spyOn(navigation,'nativeReachableAround');
    try {
      for(let frame=0;frame<32;frame++)memory.observe({time:frame/32,self,visible:frame%2===0?sight:null});
      expect(build.mock.calls.length).toBeLessThanOrEqual(3);
      memory.observe({time:5,self,visible:null});expect(memory.focus(5)).toBeNull();
    }finally{build.mockRestore();}
  });
  it('returns no invented floor route when a native graph or support is unavailable',()=>{
    const {arena}=fixture();const unbaked={...arena,native:{...arena.native!}};
    expect(nativeReachableAround({x:0,y:64*UNIT,z:-8},unbaked,10)).toEqual([]);
    expect(nativeReachableAround({x:0,y:100,z:-8},arena,10)).toEqual([]);
  });
});
