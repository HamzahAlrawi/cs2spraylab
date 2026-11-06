import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {brushEntities,entityTransform,grenadeBlocks} from '../grenade-map-geometry.mjs';

test('brush selection excludes triggers, skybox, disabled and never-solid entities',()=>{
  const entity=(id,classname,other='')=>`====${id}====\nclassname "${classname}"\nmodel resource_name:"maps/de_test/entities/brush.vmdl"\norigin [ 10, 20, 30 ]\nangles [ 0, 0, 0 ]\nscales [ 1, 1, 1 ]\n${other}\n`;
  const text=entity(0,'func_clip_vphysics','startdisabled false')+entity(1,'func_brush','startdisabled "0"')+
    entity(2,'func_buyzone')+entity(3,'func_brush','solidity "1"')+entity(4,'func_brush','startdisabled true')+
    entity(5,'func_brush','worldgroupid "skyboxWorldGroup0"');
  assert.deepEqual(brushEntities(text).map(e=>e.classname),['func_clip_vphysics','func_brush']);
  assert.equal(brushEntities(text)[0].model,'maps/de_test/entities/brush.vmdl');
});
test('Source entity yaw/scale/translation are applied before coordinate conversion',()=>{
  const p=new Vector3(1,0,0).applyMatrix4(entityTransform({origin:[10,20,30],angles:[0,90,0],scales:[2,3,4]}));
  assert.ok(Math.abs(p.x-10)<1e-8);assert.ok(Math.abs(p.y-22)<1e-8);assert.equal(p.z,30);
  assert.throws(()=>entityTransform({scales:[0,1,1]}),/transform/);
});
test('grenade masks honor native thrown-grenade exclusions and not just player/bullet tags',()=>{
  for(const tag of ['playerclip','npcclip','sky'])assert.equal(grenadeBlocks({tags:[tag]}),false);
  assert.equal(grenadeBlocks({excludes:['csgo_thrown_grenade']}),false);
  for(const tag of ['passbullets','csgo_grenadeclip','window'])assert.equal(grenadeBlocks({tags:[tag]}),true);
});
