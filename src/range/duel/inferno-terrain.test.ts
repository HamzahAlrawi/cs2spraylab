import {expect,it} from 'vitest';
import {testArena,type Arena} from './geometry';
import {projectInfernoChild,INFERNO_TERRAIN} from './inferno-terrain';
import {InfernoSpread} from './inferno-native';
const point=(x=0,y=0,z=0)=>({x,y,z});
it('projects onto a lower elevation instead of rejecting a 35cm height difference',()=>{
  const world:Arena={...testArena(),solids:[{center:point(-1,.6),size:point(2,1.2,3)}]};
  const from=point(-.5,1.2),to=point(.6,1.2);
  expect(projectInfernoChild(from,to,world,.7)).toEqual(point(.6,0));
});
it('reaches stair treads but does not pass solid partitions or detached overhead floors',()=>{
  const world:Arena={...testArena(),solids:[{center:point(.8,.15),size:point(1,.3,3)}]};
  expect(projectInfernoChild(point(-.5),point(.8),world,.7)?.y).toBeCloseTo(.3);
  world.solids.push({center:point(0,2),size:point(.2,4,4)});
  expect(projectInfernoChild(point(-.5),point(.8),world,.7)).toBeUndefined();
  const ceiling:Arena={...testArena(),solids:[{center:point(0,.8),size:point(4,.2,4)}]};
  expect(projectInfernoChild(point(-.5),point(.5),ceiling,.7)).toBeUndefined();
});
it('does not create unsupported native flames or unbounded vertical projection',()=>{
  const world:Arena={...testArena(),native:{ray:()=>undefined,fits:()=>true,sweep:(_a,b)=>({position:b,fraction:1,startSolid:false}),vertical:(_p,_a,b)=>({feet:b,grounded:false,ceiling:false})}};
  expect(projectInfernoChild(point(),point(1),world,.7)).toBeUndefined();
  expect(INFERNO_TERRAIN.up/.0254).toBe(50);expect(INFERNO_TERRAIN.down/.0254).toBe(200);
});
it('multi-height propagation respects the 3D range and original trace budget',()=>{
  const spread=new InfernoSpread(point(),0,4,7,false,1,1);
  for(let time=.1;time<3;time+=.1){let calls=0;const cells=spread.advance(time,(_from,p)=>{calls++;return {...p,y:p.x>.3?.6:0};});
    expect(calls).toBeLessThanOrEqual(8);expect(cells.every(p=>Math.hypot(p.x,p.y,p.z)<=4)).toBe(true);
  }
  expect(spread.cells.some(p=>p.y===.6)).toBe(true);
});
