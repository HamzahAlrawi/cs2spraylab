import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {DuelAnimator} from './animation';
import {nativeFlinchClips} from './native-flinch';
import type {DuelActorSnapshot} from './types';

afterEach(()=>vi.unstubAllGlobals());
async function asset(name:string) {
  const bytes=readFileSync(`public/revamp/models/${name}.glb`),length=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.toString('utf8',20,20+length));
  json.buffers[0].uri=`data:application/octet-stream;base64,${bytes.subarray(28+length).toString('base64')}`;
  for(const mesh of json.meshes??[])for(const primitive of mesh.primitives)delete primitive.material;
  delete json.materials;delete json.images;delete json.textures;
  json.extensionsRequired=(json.extensionsRequired??[]).filter((name:string)=>name!=='EXT_texture_webp');
  return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}
async function fixture(duck=0, headshot=false, direction={x:1,y:0,z:0}) {
  vi.stubGlobal('ProgressEvent',class {constructor(_type:string,init:unknown){Object.assign(this,init);}});
  const [target,motion,flinch]=await Promise.all([asset('target'),asset('duel-motion'),asset('duel-flinches')]);
  const model=target.scene;model.position.set(3,1,-2);model.rotation.y=-Math.PI;
  const animator=new DuelAnimator(model,[...motion.animations,...nativeFlinchClips(flinch)],0,'ak47');
  const actor:DuelActorSnapshot={id:1,generation:1,side:'enemy',position:{x:3,y:2.6,z:-2},feet:1,
    velocity:{x:0,z:0},yaw:0,pitch:0,duckAmount:duck,crouched:duck>.5,health:100,armor:0,helmet:false,
    alive:true,equipment:'ak47',ammo:30,reloading:false};
  animator.update(actor,0);model.updateWorldMatrix(true,true);
  const head=model.getObjectByName('head_0')!,pelvis=model.getObjectByName('pelvis')!;
  const start=head.getWorldPosition(new THREE.Vector3()),root=model.matrix.clone();
  actor.alive=false;actor.deathDirection=direction;actor.deathGroup=headshot?'head':'chest';
  animator.setDeathWorld({floor:1});animator.update(actor,0,0);
  return {model,animator,actor,head,pelvis,start,root};
}

describe('native-derived contact-aware death presentation',()=>{
  it.each([0,.5,1])('drops promptly at stance %s, preserves root and settles on raised support',async duck=>{
    const f=await fixture(duck,true);
    for(let n=1;n<=48;n++)f.animator.update(f.actor,1/60,n/60);
    expect(f.head.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(f.start.y-.25);
    f.model.updateMatrix();expect(f.model.matrix.equals(f.root)).toBe(true);
    for(let n=49;n<=180;n++)f.animator.update(f.actor,1/60,n/60);
    expect(f.head.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThanOrEqual(1.119);
    expect(f.head.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(1.7);
    f.animator.dispose();
  });
  it('steers opposite side hits in opposite world directions without moving the actor root',async()=>{
    const a=await fixture(0,false,{x:1,y:0,z:0}),b=await fixture(0,false,{x:-1,y:0,z:0});
    for(let n=1;n<=30;n++){a.animator.update(a.actor,1/60,n/60);b.animator.update(b.actor,1/60,n/60);}
    expect(a.head.getWorldPosition(new THREE.Vector3()).x-a.start.x).toBeGreaterThan(.05);
    expect(b.head.getWorldPosition(new THREE.Vector3()).x-b.start.x).toBeLessThan(-.05);
    expect(a.model.position.toArray()).toEqual([3,1,-2]);expect(b.model.position.toArray()).toEqual([3,1,-2]);
    a.animator.dispose();b.animator.dispose();
  });
  it('uses distinct head impulses and native head layers, and repeats/rewinds on absolute death age',async()=>{
    const head=await fixture(0,true),body=await fixture();
    head.animator.update(head.actor,.1,.1);body.animator.update(body.actor,.1,.1);
    const first=head.head.getWorldPosition(new THREE.Vector3());
    expect(first.distanceTo(body.head.getWorldPosition(new THREE.Vector3()))).toBeGreaterThan(.005);
    for(let n=0;n<5;n++)head.animator.update(head.actor,.1,.1);
    expect(head.head.getWorldPosition(new THREE.Vector3()).distanceTo(first)).toBeLessThan(1e-7);
    head.animator.update(head.actor,.1,.3);head.animator.update(head.actor,0,.1);
    expect(head.head.getWorldPosition(new THREE.Vector3()).distanceTo(first)).toBeLessThan(1e-7);
    head.animator.dispose();body.animator.dispose();
  });
  it('carries the weapon anchor with the solved hand rather than leaving it floating at standing height',async()=>{
    const f=await fixture(),hand=f.model.getObjectByName('hand_R')!,anchor=f.model.getObjectByName('wpnPivot')!;
    f.model.updateWorldMatrix(true,true);
    const relative=new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(anchor.matrixWorld);
    f.animator.update(f.actor,.8,.8);f.model.updateWorldMatrix(true,true);
    const after=new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(anchor.matrixWorld);
    expect(after.elements.every((value,i)=>Math.abs(value-relative.elements[i])<1e-5)).toBe(true);
    f.animator.dispose();
  });
});
