import * as THREE from 'three';
import type {HitReactionEvent} from './hit-reaction';

/** Exporter-composed clips are bind * delta, independently checked by the builder. */
export function nativeFlinchClips(asset:{scene:THREE.Object3D;animations:THREE.AnimationClip[]}) {
  const rotations=new Map<string,number[]>();asset.scene.traverse(node=>rotations.set(node.name,node.quaternion.toArray()));
  const reference=new THREE.AnimationClip('native_flinch_bind',0,[...rotations].map(([name,rotation])=>
    new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,[0],rotation)));
  return asset.animations.filter(clip=>clip.name.split('/').pop()!.startsWith('flinch_')).map(clip=>{
    const bound=clip.clone();bound.tracks=bound.tracks.filter(track=>track.name.endsWith('.quaternion')&&
      /^(spine_|neck_|head_|arm_|clavicle_|hand_)/.test(track.name)&&rotations.has(track.name.slice(0,-11)));
    THREE.AnimationUtils.makeClipAdditive(bound,0,reference);return bound;
  });
}

export function nativeFlinchSample(hits:readonly HitReactionEvent[],time:number,family:string,
  duration:(name:string)=>number|undefined) {
  if (!Number.isFinite(time)) return;
  let selected: {name:string;elapsed:number;weight:number;time:number}|undefined;
  for(let i=hits.length-1;i>=0;i--) {
    const hit=hits[i],elapsed=time-hit.time;if(elapsed<0||elapsed>.7)continue;
    if (![hit.time,hit.actorYaw,hit.incoming.x,hit.incoming.z].every(Number.isFinite)) continue;
    const magnitude=Math.hypot(hit.incoming.x,hit.incoming.z);if(magnitude<1e-8)continue;
    const side=(hit.incoming.x*Math.cos(hit.actorYaw)-hit.incoming.z*Math.sin(hit.actorYaw))/magnitude;
    const suffix=family==='pistol'?'_pistol':'';
    const part=hit.region==='head'?`head${side>.3?'_right':''}`:hit.region==='arm'||hit.region==='leg'
      ?`${hit.region}_${side>0?'right':'left'}`:hit.region;
    let name=`flinch_${part}${suffix}`,length=duration(name);
    if(length===undefined){name=`flinch_${part}`;length=duration(name);}
    if(length===undefined&&hit.region==='head'){name=`flinch_head${suffix}`;length=duration(name);
      if(length===undefined){name='flinch_head';length=duration(name);}}
    if(!length||!Number.isFinite(length)||elapsed>=length||selected&&selected.time>=hit.time)continue;
    selected={name,elapsed,weight:Math.min(1,elapsed/.025,(length-elapsed)/.08)*(hit.region==='head'&&hit.helmet ? .65 : 1),time:hit.time};
  }
  if(selected){const {name,elapsed,weight}=selected;return {name,elapsed,weight};}
}
