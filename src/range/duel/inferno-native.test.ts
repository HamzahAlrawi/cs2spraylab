import {describe,expect,it} from 'vitest';
import fixture from './native-inferno-arithmetic-fixture.json';
import {InfernoSpread,nativeInfernoDamage,NATIVE_INFERNO} from './inferno-native';

describe('native inferno timing and bounded placement adapter',()=>{
  it.each(fixture.cases)('matches isolated raw damage at age=$age duration=$rampDuration',sample=>{
    expect(nativeInfernoDamage(sample.age,0,sample.dps,sample.interval,sample.rampDuration)).toBe(sample.nativeRawDamage);
  });
  it('starts at one flame, grows gradually and respects depth/range/trace caps',()=>{
    const spread=new InfernoSpread({x:0,y:0,z:0},0,4,7,false,1,1);
    expect(spread.advance(0,(_from,to)=>to)).toHaveLength(1);
    expect(spread.advance(.05,(_from,to)=>to)).toHaveLength(1);
    let previous=1;
    for(let i=1;i<=30;i++) {
      let queries=0;
      const cells=spread.advance(i*.1,(_from,to)=>{queries+=2;return to;});
      expect(queries).toBeLessThanOrEqual(NATIVE_INFERNO.maxTraces);
      expect(cells.length).toBeGreaterThanOrEqual(previous);expect(cells.length).toBeLessThanOrEqual(NATIVE_INFERNO.maxFlames);
      expect(cells.every(point=>Math.hypot(point.x,point.z)<=4)).toBe(true);previous=cells.length;
    }
    expect(previous).toBeGreaterThan(4);
  });
  it('does not create fire behind rejected projections or restore suppressed flames',()=>{
    const spread=new InfernoSpread({x:0,y:0,z:0},0,4,7,false,1,1);
    spread.advance(0,()=>undefined);expect(spread.advance(1,()=>undefined)).toHaveLength(1);
    spread.suppress([...spread.cells]);expect(spread.advance(1.1,(_from,to)=>to)).toHaveLength(0);
  });
  it('uses the inferno spawn reference, not a new ramp when a victim walks into old fire',()=>{
    expect(nativeInfernoDamage(10,0,40,Math.fround(.2))).toBe(8);
    expect(nativeInfernoDamage(10,9.8,40,Math.fround(.2))).toBeLessThan(1);
  });
});
