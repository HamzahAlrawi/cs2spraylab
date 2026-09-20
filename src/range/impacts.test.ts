import {it,expect} from 'vitest';
import {Group,Mesh,Vector3} from 'three';
import {RangeEngine} from './engine';
import {Simulation} from './simulation';
import {defaults} from './config';

it('resizes existing wall and target marks without changing physical impact coordinates or target geometry',()=>{
  const engine=Object.create(RangeEngine.prototype) as RangeEngine;
  engine.sim=new Simulation({...defaults,impactSize:3});engine.impacts=new Group();engine.targets=[new Group()];
  const wall=new Mesh(),hit=new Mesh(),model=new Group();
  wall.userData.impactScale=2;hit.userData.impactScale=1;
  wall.position.set(1,2,-100);hit.position.set(.2,1.6,0);engine.targets[0].position.set(4,0,-90);
  engine.impacts.add(wall);engine.targets[0].add(hit,model);
  const before=hit.getWorldPosition(new Vector3());engine.resizeImpacts();
  expect(wall.scale.x).toBe(6);expect(hit.scale.x).toBe(3);expect(model.scale.x).toBe(1);
  expect(wall.position.toArray()).toEqual([1,2,-100]);expect(hit.getWorldPosition(new Vector3())).toEqual(before);
  engine.sim.settings={...engine.sim.settings,impactSize:.5};engine.resizeImpacts();
  expect(wall.scale.x).toBe(1);expect(hit.scale.x).toBe(.5);
});
