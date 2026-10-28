import type {Vec} from '../actor-physics';
import {add, subtract, scale, dot, hullPlanes, type TerrainSolid} from '../terrain';
import type {HullSweep} from '../actor-collision';
import type {Arena} from './geometry';
import {blocksShots, resolveEnvironmentSolid} from './environment';

/** Grenade-centred cube sweep, separate from the player and bullet trace masks. */
export function sweepGrenadeHull(from:Vec,to:Vec,radius:number,arena:Arena):HullSweep {
  const native=arena.native?.sweepGrenade?.(from,to,radius)??arena.native?.sweepSphere?.(from,to,radius);
  let fraction=native?.fraction??1,contact=native?.contact,startSolid=native?.startSolid??false;
  const a={...from,y:from.y-radius},b={...to,y:to.y-radius},epsilon=1e-8;
  for(let index=0;index<arena.solids.length;index++) {
    const solid=resolveEnvironmentSolid(arena.solids[index],index);
    if(!blocksShots(solid))continue;
    const c=solid.center,s=solid.size;
    if(Math.max(from.x,to.x)<c.x-s.x/2-radius||Math.min(from.x,to.x)>c.x+s.x/2+radius||
      Math.max(from.y,to.y)<c.y-s.y/2-radius||Math.min(from.y,to.y)>c.y+s.y/2+radius||
      Math.max(from.z,to.z)<c.z-s.z/2-radius||Math.min(from.z,to.z)>c.z+s.z/2+radius)continue;
    const box:TerrainSolid={center:c,size:s,traversal:solid.shape?
      {kind:'ramp',axis:solid.shape.axis,rise:s.y,direction:solid.shape.highSide}:{kind:'solid'}};
    let enter=0,exit=1,inside=true,miss=false,normal:Vec|undefined;
    // Expand the authored convex planes by this hull, not by the actor's 16u hull.
    for(const plane of hullPlanes(box,radius*2,radius)) {
      const start=dot(a,plane.normal)-plane.distance,end=dot(b,plane.normal)-plane.distance;
      inside&&=start < -epsilon;
      if(start>=-epsilon&&end>=-epsilon){miss=true;break;}
      if(start < -epsilon&&end < -epsilon)continue;
      const time=start/(start-end);
      if(start>end&&Math.max(0,time)>=enter){enter=Math.max(0,time);normal=plane.normal;}
      else if(start<end)exit=Math.min(exit,time);
      if(enter>exit+epsilon){miss=true;break;}
    }
    if(miss)continue;
    if(inside){startSolid=true;fraction=0;contact={normal:{x:0,y:0,z:0},solid:box};}
    else if(normal&&enter<=fraction&&enter<=exit+epsilon){fraction=Math.max(0,enter);contact={normal,solid:box};}
  }
  return {position:add(from,scale(subtract(to,from),fraction)),fraction,contact,startSolid};
}
