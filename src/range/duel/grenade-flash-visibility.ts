import {UNIT,type Vec} from '../actor-physics';
import {add,subtract,scale,normalize} from '../terrain';
import {traceSolid,type Arena} from './geometry';

const clear=(from:Vec,to:Vec,arena:Arena)=>{
  const delta=subtract(to,from),distance=Math.hypot(delta.x,delta.y,delta.z);
  return distance<1e-9||traceSolid(from,scale(delta,1/distance),arena,distance).distance>=distance-1e-7;
};
/** Native offset layout/weights. Trainer world queries do not reproduce every native trace-filter/material rule. */
export function nativeFlashVisibility(eye:Vec,point:Vec,arena:Arena):number {
  if(clear(eye,point,arena))return 1;
  const direction=normalize(subtract(eye,point)),horizontal=Math.hypot(direction.x,direction.z);
  const lateral=horizontal>1e-8?{x:direction.z/horizontal,y:0,z:-direction.x/horizontal}:{x:1,y:0,z:0};
  const up={x:direction.y*lateral.z,y:direction.z*lateral.x-direction.x*lateral.z,z:-direction.y*lateral.x};
  const offsets=[scale(up,50*UNIT),add(scale(lateral,-75*UNIT),scale(up,10*UNIT)),add(scale(lateral,75*UNIT),scale(up,10*UNIT))];
  let visibility=0;
  for(const offset of offsets) {
    const distance=Math.hypot(offset.x,offset.y,offset.z),axis=scale(offset,1/distance);
    const hit=traceSolid(point,axis,arena,distance),reached=add(point,scale(axis,Math.min(distance,hit.distance)));
    if(clear(eye,reached,arena))visibility=Math.fround(visibility+Math.fround(.167));
  }
  return visibility;
}
