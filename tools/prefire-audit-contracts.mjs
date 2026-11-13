const near=(a,b)=>!!a&&!!b&&Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<1e-8;

export const pointFromEvidence=(point,evidence)=>!point||evidence.some(other=>near(point,other));

export function boundedAimCommand(command,step=1/128){
  const maximum=350*Math.PI/180*step+1e-8;
  return [command.yawDelta,command.pitchDelta].every(delta=>Number.isFinite(delta)&&Math.abs(delta)<=maximum);
}

export const watchOnAuthoredRoute=(watch,coarse,dense)=>!watch||[...coarse,...dense].some(view=>near(watch,view));

export function anySilhouetteSight(origin,points,ray){
  return points.some(point=>{
    const dx=point.x-origin.x,dy=point.y-origin.y,dz=point.z-origin.z,d=Math.hypot(dx,dy,dz);
    return d>.01&&!ray(origin,{x:dx/d,y:dy/d,z:dz/d},d-.01);
  });
}

export function physicalStepDistance(before,afterSpeed,step,maximumSpeed){
  const speed=Math.max(before.speed,afterSpeed,Math.min(before.velocity,maximumSpeed));
  return [speed,step,maximumSpeed].every(Number.isFinite)&&step>0&&speed<=maximumSpeed
    ? speed*step+.002 : NaN;
}
