import * as THREE from 'three';
import {stanceCurve,type Vec} from '../actor-physics';
import {traceSolid,type Arena} from './geometry';
import type {DuelActorSnapshot} from './types';
import type {EnemyShadowProxy} from './shadows';

export type ActorShadow=EnemyShadowProxy & {polygon:Vec[]};
const sun={x:-9,y:18,z:8};

// A bounded projected silhouette is shared by rendering and perception. It is
// not a Source 2 shadow map, and never exposes the hidden caster to the sensor.
export function actorShadow(actor:DuelActorSnapshot,arena:Arena):ActorShadow|undefined {
  if(!actor.alive)return;
  const height=1.72-.45*stanceCurve(actor.duckAmount);
  const top={x:actor.position.x,y:actor.feet+height,z:actor.position.z};
  const sunlightLength=Math.hypot(sun.x,sun.y,sun.z);
  if(Number.isFinite(traceSolid(top,{x:sun.x/sunlightLength,y:sun.y/sunlightLength,z:sun.z/sunlightLength},arena,40).distance))return;
  const root={x:actor.position.x,y:actor.feet+.035,z:actor.position.z};
  const projected={x:top.x-top.y*sun.x/sun.y,y:.015,z:top.z-top.y*sun.z/sun.y};
  const base={x:root.x-root.y*sun.x/sun.y,y:.015,z:root.z-root.y*sun.z/sun.y};
  const dx=projected.x-base.x,dz=projected.z-base.z,length=Math.hypot(dx,dz),yaw=Math.atan2(dz,dx);
  const center={x:(base.x+projected.x)/2,y:.015,z:(base.z+projected.z)/2};
  const polygon:Vec[]=[];
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6,x=Math.cos(a)*(length/2+.16),z=Math.sin(a)*.18;
    const point={x:center.x+x*Math.cos(yaw)-z*Math.sin(yaw),y:.015,z:center.z+x*Math.sin(yaw)+z*Math.cos(yaw)};
    const vector={x:point.x-top.x,y:point.y-top.y,z:point.z-top.z},distance=Math.hypot(vector.x,vector.y,vector.z);
    if(Number.isFinite(traceSolid(top,{x:vector.x/distance,y:vector.y/distance,z:vector.z/distance},arena,distance-.02).distance))return;
    polygon.push(point);
  }
  return {id:`actor-shadow:${actor.id}:${actor.generation}`,side:actor.side,contrast:.27,samples:[center,...polygon],polygon};
}

export function actorShadows(actors:readonly DuelActorSnapshot[],arena:Arena) {
  return actors.flatMap(actor=>{const shadow=actorShadow(actor,arena);return shadow?[shadow]:[];});
}

export class ActorShadowRenderer {
  readonly group=new THREE.Group();
  private meshes=new Map<string,THREE.Mesh>();
  private material=new THREE.MeshBasicMaterial({color:'#182426',transparent:true,opacity:.27,depthWrite:false,side:THREE.DoubleSide});
  update(shadows:readonly ActorShadow[]) {
    const active=new Set(shadows.map(shadow=>shadow.id));
    for(const [id,mesh] of this.meshes)if(!active.has(id)){this.group.remove(mesh);mesh.geometry.dispose();this.meshes.delete(id);}
    for(const shadow of shadows) {
      let mesh=this.meshes.get(shadow.id);
      if(!mesh){mesh=new THREE.Mesh(new THREE.BufferGeometry(),this.material);this.meshes.set(shadow.id,mesh);this.group.add(mesh);}
      const vertices:number[]=[];
      for(let i=1;i<shadow.polygon.length-1;i++)for(const p of [shadow.polygon[0],shadow.polygon[i],shadow.polygon[i+1]])vertices.push(p.x,p.y,p.z);
      const old=mesh.geometry.getAttribute('position');
      if(old?.count===vertices.length/3){(old.array as Float32Array).set(vertices);old.needsUpdate=true;}
      else mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      mesh.geometry.computeBoundingSphere();
    }
  }
  dispose(){for(const mesh of this.meshes.values())mesh.geometry.dispose();this.meshes.clear();this.group.clear();this.material.dispose();}
}
