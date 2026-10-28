import {afterEach,describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {nativeFlinchClips,nativeFlinchSample} from './native-flinch';
import type {HitReactionEvent} from './hit-reaction';
import {DuelAnimator} from './animation';
import {NativeActorHitboxes} from './actor-hitboxes';
import type {DuelActorSnapshot} from './types';

const hit:HitReactionEvent={time:1,region:'head',actorYaw:0,incoming:{x:1,z:0}};
afterEach(()=>vi.unstubAllGlobals());
async function rig(name:string) {
  const bytes=readFileSync(`public/revamp/models/${name}.glb`),length=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.toString('utf8',20,20+length));
  json.buffers[0].uri=`data:application/octet-stream;base64,${bytes.subarray(28+length).toString('base64')}`;
  for(const mesh of json.meshes??[])for(const primitive of mesh.primitives)delete primitive.material;
  delete json.materials;delete json.images;delete json.textures;
  json.extensionsRequired=(json.extensionsRequired??[]).filter((name:string)=>name!=='EXT_texture_webp');
  return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}
describe('source native hit layers',()=>{
  it('subtracts bind rotation, not the idle pose, and strips translations',()=>{
    const scene=new THREE.Group(),head=new THREE.Bone();head.name='head_0';scene.add(head);
    head.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.4);
    const delta=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.2);
    const q=head.quaternion.clone().multiply(delta);
    const asset={scene,animations:[new THREE.AnimationClip('animation/anims/world/shared/flinch_head',.6,[
      new THREE.QuaternionKeyframeTrack('head_0.quaternion',[0,.6],[...q.toArray(),...head.quaternion.toArray()]),
      new THREE.VectorKeyframeTrack('head_0.position',[0,.6],[0,0,0,10,0,0]),
    ])]};
    const [clip]=nativeFlinchClips(asset);
    expect(clip.blendMode).toBe(THREE.AdditiveAnimationBlendMode);expect(clip.tracks).toHaveLength(1);
    expect(new THREE.Quaternion().fromArray(clip.tracks[0].values).angleTo(delta)).toBeLessThan(1e-6);
    expect(asset.animations[0].tracks).toHaveLength(2);
  });
  it('selects family/region/direction, fades and rejects future or expired hits',()=>{
    const duration=(name:string)=>['flinch_head_right_pistol','flinch_chest'].includes(name) ? .6 : undefined;
    expect(nativeFlinchSample([hit],1.1,'pistol',duration)).toMatchObject({name:'flinch_head_right_pistol',weight:1});
    expect(nativeFlinchSample([{...hit,helmet:true}],1.1,'pistol',duration)?.weight).toBe(.65);
    expect(nativeFlinchSample([{...hit,region:'chest'}],1.1,'pistol',duration)?.name).toBe('flinch_chest');
    expect(nativeFlinchSample([hit],.99,'pistol',duration)).toBeUndefined();
    expect(nativeFlinchSample([hit],1.61,'pistol',duration)).toBeUndefined();
    expect(nativeFlinchSample([hit],1.58,'pistol',duration)?.weight).toBeCloseTo(.25);
  });
  it('loads the bounded shipped native pack with finite rotation-only additive clips',async()=>{
    const bytes=readFileSync('public/revamp/models/duel-flinches.glb');expect(bytes.byteLength).toBeLessThan(512*1024);
    const asset=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'');
    const clips=nativeFlinchClips(asset);expect(clips).toHaveLength(16);
    for(const clip of clips){expect(clip.duration).toBeGreaterThan(.2);expect(clip.duration).toBeLessThan(.7);
      expect(clip.tracks.length).toBeGreaterThan(0);
      for(const track of clip.tracks){expect(track.name).toMatch(/\.quaternion$/);expect([...track.values].every(Number.isFinite)).toBe(true);}
    }
  });
  it('normalizes incoming direction, falls back to available head clips and selects the latest timestamp',()=>{
    const duration=(name:string)=>['flinch_head','flinch_head_right','flinch_chest'].includes(name)?.6:undefined;
    const sample=nativeFlinchSample([hit],1.1,'rifle',duration);
    expect(nativeFlinchSample([{...hit,incoming:{x:100,z:0}}],1.1,'rifle',duration)).toEqual(sample);
    expect(nativeFlinchSample([hit],1.1,'pistol',name=>name==='flinch_head'?.6:undefined)?.name).toBe('flinch_head');
    expect(nativeFlinchSample([{...hit,region:'chest',time:1.05},hit],1.1,'rifle',duration)?.name).toBe('flinch_chest');
    for(const bad of [{...hit,time:NaN},{...hit,actorYaw:Infinity},{...hit,incoming:{x:0,z:0}}])
      expect(nativeFlinchSample([bad],1.1,'rifle',duration)).toBeUndefined();
    expect(nativeFlinchSample([hit],NaN,'rifle',duration)).toBeUndefined();
  });
  it.each(['ak47','usp'] as const)('%s keeps feet fixed and native hit capsules aligned during repeat/rewind flinch samples',async equipment=>{
    vi.stubGlobal('ProgressEvent',class {constructor(_type:string,init:unknown){Object.assign(this,init);}});
    const [target,motion,flinch]=await Promise.all([rig('target'),rig('duel-motion'),rig('duel-flinches')]);
    const animator=new DuelAnimator(target.scene,[...motion.animations,...nativeFlinchClips(flinch)],0,equipment);
    const actor:DuelActorSnapshot={id:1,generation:1,side:'enemy',position:{x:0,y:1.6256,z:0},feet:0,
      velocity:{x:0,z:0},yaw:0,pitch:0,duckAmount:0,crouched:false,health:80,armor:0,helmet:false,
      alive:true,equipment,ammo:10,reloading:false};
    animator.update(actor,0,undefined,{poseTime:1.1});target.scene.updateMatrixWorld(true);
    const head=target.scene.getObjectByName('head_0')!,foot=target.scene.getObjectByName('ankle_L')!;
    const clean=head.getWorldPosition(new THREE.Vector3()),feet=foot.getWorldPosition(new THREE.Vector3());
    const boxes=new NativeActorHitboxes(target.scene);actor.recentHits=[hit];
    animator.update(actor,0,undefined,{poseTime:1.1});target.scene.updateMatrixWorld(true);
    const moved=head.getWorldPosition(new THREE.Vector3()),capsule=structuredClone(boxes.capture().capsules[0]);
    expect(moved.distanceTo(clean)).toBeGreaterThan(.0001);
    expect(foot.getWorldPosition(new THREE.Vector3()).distanceTo(feet)).toBeLessThan(1e-6);
    for(let i=0;i<6;i++){animator.update(actor,0,undefined,{poseTime:1.1});target.scene.updateMatrixWorld(true);}
    expect(head.getWorldPosition(new THREE.Vector3()).distanceTo(moved)).toBeLessThan(1e-6);
    expect(boxes.capture().capsules[0]).toEqual(capsule);
    animator.update(actor,0,undefined,{poseTime:.9});target.scene.updateMatrixWorld(true);
    animator.update(actor,0,undefined,{poseTime:1.1});target.scene.updateMatrixWorld(true);
    expect(head.getWorldPosition(new THREE.Vector3()).distanceTo(moved)).toBeLessThan(1e-6);
    expect(boxes.pose.capsules[0].radius).toBeCloseTo(.10922,7);animator.dispose();
  });
});
