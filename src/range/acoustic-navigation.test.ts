import {describe,it,expect} from 'vitest';
import {AcousticNavigation,type AcousticNode} from './acoustic-navigation';
import {AcousticScene} from './spatial-audio';

const source={x:-2,y:1.2,z:0},listener={x:2,y:1.2,z:0};
const nodes:AcousticNode[]=[{point:{x:-1,y:1.2,z:2},links:[1]},
  {point:{x:1,y:1.2,z:2},links:[0]}];
const clear=(a:typeof source,b:typeof source)=>a.x*b.x>=0||a.z>=1.9&&b.z>=1.9;
describe('bounded native sound routing',()=>{
  it('routes around a doorway, retains path distance, and points at the audible corner',()=>{
    const graph=new AcousticNavigation(nodes,clear),scene=new AcousticScene();scene.setNavigation(graph);
    const path=scene.resolve(listener,source,0);
    expect(path.routed).toBe(true);expect(path.distance).toBeCloseTo(2*Math.sqrt(5)+2);
    expect(path.apparentPosition).toEqual(nodes[1].point);expect(path.gain).toBeLessThan(1);
    expect(path.delay).toBeCloseTo(path.distance/343);
  });
  it('does not invent a doorway across disconnected floors or a missing navigation graph',()=>{
    for(const graph of [new AcousticNavigation([],clear),new AcousticNavigation(nodes.map(n=>({...n,links:[]})),clear)]) {
      const scene=new AcousticScene();scene.setNavigation(graph);
      expect(scene.resolve(listener,source)).toMatchObject({routed:false,gain:.32,lowpass:1300});
    }
  });
  it('keeps open paths direct and invalidates cached paths when geometry changes',()=>{
    const scene=new AcousticScene();scene.setNavigation(new AcousticNavigation(nodes,clear));
    scene.resolve(listener,source,1);scene.resolve(listener,source,1.01);expect(scene.computations).toBe(1);
    scene.setNavigation(new AcousticNavigation(nodes,()=>true));
    expect(scene.resolve(listener,source,1.02)).toMatchObject({routed:false,gain:1,distance:4});
    expect(scene.computations).toBe(2);
  });
});
