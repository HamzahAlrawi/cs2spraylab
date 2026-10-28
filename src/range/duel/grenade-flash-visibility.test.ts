import {describe,expect,it,vi} from 'vitest';
import {nativeFlashVisibility} from './grenade-flash-visibility';
import {testArena} from './geometry';

describe('native flash offset-path layout',()=>{
  const eye={x:0,y:1,z:5},point={x:0,y:1,z:0};
  it('uses a single direct ray for an unobstructed flash',()=>{
    const arena=testArena(),ray=vi.fn(()=>undefined);Object.assign(arena,{native:{ray}});
    expect(nativeFlashVisibility(eye,point,arena)).toBe(1);expect(ray).toHaveBeenCalledTimes(1);
  });
  it('lets the two side paths contribute fractional visibility around thin cover',()=>{
    const arena=testArena();arena.solids.push({center:{x:0,y:1,z:2.5},size:{x:.2,y:100,z:.1}});
    expect(nativeFlashVisibility(eye,point,arena)).toBe(Math.fround(Math.fround(.167)+Math.fround(.167)));
  });
  it('does not transmit through a sealed separating wall',()=>{
    const arena=testArena();arena.solids.push({center:{x:0,y:1,z:2.5},size:{x:100,y:100,z:.1}});
    expect(nativeFlashVisibility(eye,point,arena)).toBe(0);
  });
  it('traces to the first ray reached endpoint rather than requiring both rays clear',()=>{
    const arena=testArena(),ray=vi.fn(()=>ray.mock.calls.length===1?{distance:1,surfaceId:0,normal:{x:0,y:0,z:1}}:
      ray.mock.calls.length===2?{distance:.5,surfaceId:0,normal:{x:0,y:-1,z:0}}:undefined);
    Object.assign(arena,{native:{ray}});
    expect(nativeFlashVisibility(eye,point,arena)).toBeCloseTo(.501,6);
    expect(ray).toHaveBeenCalledTimes(7);
    expect((ray.mock.calls as unknown[][])[2][2]).toBeCloseTo(Math.hypot(5,.5),6);
  });
});
