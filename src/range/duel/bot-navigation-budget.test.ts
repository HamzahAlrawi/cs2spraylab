import {describe,it,expect,vi} from 'vitest';
import {TacticalBrain} from './tactics';
import {createBotTraits} from './skill';
import {randomStream} from './rng';
import type {Arena} from './geometry';
import * as navigation from './navigation';

function fixture() {
  const home={x:1,y:0,z:-4};
  const arena:Arena={minX:-8,maxX:8,minZ:-8,maxZ:8,solids:[],lanes:[{side:1,anchor:home,edge:home,retreat:home}],
    native:{ray:()=>undefined,fits:()=>false,sweep:()=>{throw Error('unsupported floor');},
      vertical:(_point,from)=>({feet:from,grounded:false,ceiling:false})}};
  const brain=new TacticalBrain(createBotTraits(8,1,1),'aggressive',1,randomStream(1,'budget'),arena,8,'ak47',1);
  const travel=(brain as unknown as {travel:(self:{position:typeof home},goal:typeof home,time:number)=>typeof home}).travel.bind(brain);
  return {travel,self:{position:home}};
}

describe('native bot navigation work budget',()=>{
  it('backs off unreachable routes instead of flooding hull queries every motor tick',()=>{
    const {travel,self}=fixture(),route=vi.spyOn(navigation,'routeTo');
    try {
      for(let tick=0;tick<256;tick++)expect(travel(self,{x:4,y:0,z:4},tick/128)).toEqual(self.position);
      expect(route.mock.calls.length).toBeGreaterThan(1);
      expect(route.mock.calls.length).toBeLessThanOrEqual(4);
    }finally{route.mockRestore();}
  });
  it('replans immediately for a substantially different goal',()=>{
    const {travel,self}=fixture(),route=vi.spyOn(navigation,'routeTo');
    try {
      travel(self,{x:4,y:0,z:4},0);travel(self,{x:4.1,y:0,z:4},.01);
      expect(route).toHaveBeenCalledTimes(1);
      travel(self,{x:6,y:0,z:4},.02);expect(route).toHaveBeenCalledTimes(2);
    }finally{route.mockRestore();}
  });
  it('does not recheck a valid native path at motor frequency after its first deadline',()=>{
    const {travel,self}=fixture(),clear=vi.spyOn(navigation,'clearSegment').mockReturnValue(true);
    try {
      for(let tick=0;tick<256;tick++)travel(self,{x:4,y:0,z:4},tick/128);
      expect(clear.mock.calls.length).toBeLessThanOrEqual(12);
    }finally{clear.mockRestore();}
  });
  it.each([3,-3])('invalidates a valid route immediately for a height-only goal change to %sm',height=>{
    const {travel,self}=fixture(),clear=vi.spyOn(navigation,'clearSegment').mockReturnValue(true);
    try {
      const original={x:4,y:0,z:4},stacked={...original,y:height};
      expect(travel(self,original,0)).toEqual(original);
      expect(travel(self,stacked,.01)).toEqual(stacked);
      expect(clear).toHaveBeenCalledTimes(2);
      for(let tick=2;tick<20;tick++)expect(travel(self,stacked,tick/128)).toEqual(stacked);
      expect(clear).toHaveBeenCalledTimes(2);
    }finally{clear.mockRestore();}
  });
  it('retries an unreachable new height without bypassing backoff for subsequent identical goals',()=>{
    const {travel,self}=fixture(),route=vi.spyOn(navigation,'routeTo');
    try {
      const original={x:4,y:0,z:4},stacked={...original,y:3};
      travel(self,original,0);travel(self,{...original,y:.25},.01);
      expect(route).toHaveBeenCalledTimes(1);
      travel(self,stacked,.02);expect(route).toHaveBeenCalledTimes(2);
      expect(route.mock.calls[1][1]).toEqual(stacked);
      for(let tick=4;tick<64;tick++)travel(self,stacked,tick/128);
      expect(route).toHaveBeenCalledTimes(2);
      travel(self,stacked,.53);expect(route).toHaveBeenCalledTimes(3);
    }finally{route.mockRestore();}
  });
});
