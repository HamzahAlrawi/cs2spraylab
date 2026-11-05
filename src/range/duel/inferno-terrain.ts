import {UNIT,type Vec} from '../actor-physics';
import {traceSolid,type Arena} from './geometry';

// Current 2000942 server.dll: downward child-placement trace at 0x353042
// uses parent Z - 200; its start at 0x35310c uses candidate Z + 50.
// This bounded browser adapter is not the complete native placement solver.
export const INFERNO_TERRAIN={up:50*UNIT,down:200*UNIT,surfaceOffset:15*UNIT} as const;
export function projectInfernoChild(from:Vec,candidate:Vec,arena:Arena,minNormal:number):Vec|undefined {
  if(candidate.x<arena.minX||candidate.x>arena.maxX||candidate.z<arena.minZ||candidate.z>arena.maxZ)return;
  const start={...candidate,y:from.y+INFERNO_TERRAIN.up},limit=INFERNO_TERRAIN.up+INFERNO_TERRAIN.down;
  const hit=traceSolid(start,{x:0,y:-1,z:0},arena,limit);
  const ground=Number.isFinite(hit.distance)&&hit.normal&&hit.normal.y>=minNormal
    ? {...candidate,y:start.y-hit.distance}
    : !arena.native&&from.y>=0&&from.y<=INFERNO_TERRAIN.down?{...candidate,y:0}:undefined;
  if(!ground)return;
  // A flame may spill over a ledge; a diagonal ray aimed at the lower floor
  // would falsely hit the ledge's own vertical face. Keep the link above the
  // higher support, while an uphill/ceiling crossing still blocks that link.
  const a={...from,y:from.y+INFERNO_TERRAIN.surfaceOffset},b={...ground,y:Math.max(from.y,ground.y)+INFERNO_TERRAIN.surfaceOffset};
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,d=Math.hypot(dx,dy,dz);
  if(d>.01&&Number.isFinite(traceSolid(a,{x:dx/d,y:dy/d,z:dz/d},arena,d-.01).distance))return;
  return ground;
}
