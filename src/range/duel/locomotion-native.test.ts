import {afterEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {DuelAnimator} from './animation';
import {NativeActorHitboxes} from './actor-hitboxes';
import type {DuelActorSnapshot} from './types';

async function rig(name:string) {
  const bytes=readFileSync(`public/revamp/models/${name}.glb`),length=bytes.readUInt32LE(12),json=JSON.parse(bytes.toString('utf8',20,20+length));
  json.buffers[0].uri=`data:application/octet-stream;base64,${bytes.subarray(28+length).toString('base64')}`;
  for(const mesh of json.meshes??[])for(const primitive of mesh.primitives)delete primitive.material;
  delete json.materials;delete json.images;delete json.textures;
  json.extensionsRequired=(json.extensionsRequired??[]).filter((name:string)=>name!=='EXT_texture_webp');
  return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}
afterEach(()=>vi.unstubAllGlobals());
describe('shipped native locomotion rig',()=>{
  it.each(['ak47','usp'] as const)('%s preserves body/hit pose through stop, crouch and reversal samples',async equipment=>{
    vi.stubGlobal('ProgressEvent',class{constructor(_type:string,init:unknown){Object.assign(this,init);}});
    const [target,motion]=await Promise.all([rig('target'),rig('duel-motion')]);
    const animator=new DuelAnimator(target.scene,motion.animations,0,equipment),boxes=new NativeActorHitboxes(target.scene);
    const actor:DuelActorSnapshot={id:1,generation:1,side:'enemy',position:{x:0,y:1.6256,z:0},feet:0,
      velocity:{x:0,z:0},yaw:0,pitch:0,duckAmount:0,crouched:false,health:100,armor:100,helmet:true,alive:true,equipment,ammo:30,reloading:false,grounded:true};
    const joints:THREE.Object3D[]=[];target.scene.traverse(node=>{if(node instanceof THREE.Bone)joints.push(node);});
    for(let n=0;n<=100;n++) {
      const time=n/128;actor.velocity.x=n<20?4:n<40?0:n<65?-3:0;actor.position.x+=actor.velocity.x/128;
      actor.duckAmount=n<40?0:n<70?(n-40)/30:1;actor.crouched=actor.duckAmount>.95;
      target.scene.position.set(actor.position.x,actor.feet,actor.position.z);
      animator.recordPose(actor,time);animator.update(actor,0,undefined,{poseTime:time});target.scene.updateMatrixWorld(true);
      const clean=joints.map(joint=>joint.quaternion.clone()),capsules=structuredClone(boxes.capture());
      for(let repeat=0;repeat<3;repeat++)animator.update(actor,0,undefined,{poseTime:time});
      const repeated=boxes.capture();
      repeated.capsules.forEach((capsule,index)=>{
        const before=capsules.capsules[index];
        for(const point of ['point0','point1'] as const)for(const axis of ['x','y','z'] as const)
          expect(Math.abs(capsule[point][axis]-before[point][axis]),`tick ${n} ${index}/${point}/${axis}`).toBeLessThan(1e-5);
      });
      joints.forEach((joint,index)=>{joint.quaternion.toArray().forEach((component,i)=>expect(component,`tick ${n} ${joint.name}`).toBeCloseTo(clean[index].toArray()[i],5));
        expect(joint.position.toArray().every(Number.isFinite)).toBe(true);});
      expect(target.scene.position.x).toBe(actor.position.x);
    }
    animator.dispose();
  });
});
