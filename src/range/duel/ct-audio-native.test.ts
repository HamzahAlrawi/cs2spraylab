import {existsSync,readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {NativeMapCollision,type NativeCollisionManifest} from '../prefire/native-collision';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {STEP,UNIT} from '../actor-physics';

const base='public/revamp/maps/dust2/duel/dust2-mid-ct/';
it.skipIf(!existsSync(`${base}collision.bin`))('runs the real CT corridor/ramp without repeated false landing or stride bursts',async()=>{
  const manifest=JSON.parse(readFileSync(`${base}collision.json`,'utf8')) as NativeCollisionManifest,bytes=readFileSync(`${base}collision.bin`);
  const map=await NativeMapCollision.create(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
  try {
    const baked=JSON.parse(readFileSync('src/range/duel/real-map-round-data.json','utf8'));
    const views=baked.chunks['dust2-mid-ct'].courses[0].views.slice(12,21) as {x:number;y:number;z:number}[];
    const feet={...views[0],y:views[0].y-64*UNIT};
    const arena={...map.bounds,solids:[],native:map,spawns:{player:{feet,yaw:0},bots:[{feet:{...feet,x:feet.x-4,z:feet.z+5},yaw:0}]}};
    const sim=new DuelSimulation(sanitizeDuelConfig({utilitiesEnabled:false}),1,arena);sim.command(1,{});sim.start();
    let index=1,traveled=0,steps=0,landings=0,lastStep=-Infinity,minStepGap=Infinity;
    for(let i=0;i<12/STEP&&index<views.length;i++){
      const actor=sim.actors[0],target=views[index],dx=target.x-actor.position.x,dz=target.z-actor.position.z;
      if(Math.hypot(dx,dz)<.25){index++;continue;}
      const previous={...actor.position};sim.command(0,{forward:1,yawDelta:Math.atan2(-dx,-dz)-actor.yaw});sim.step();
      traveled+=Math.hypot(actor.position.x-previous.x,actor.position.z-previous.z);
      for(const event of sim.drainEvents())if(event.kind==='sound'&&event.actorId===0){
        if(event.sound==='landing')landings++;
        if(event.sound==='footstep'){steps++;minStepGap=Math.min(minStepGap,sim.time-lastStep);lastStep=sim.time;}
      }
    }
    expect(index).toBe(views.length);expect(traveled).toBeGreaterThan(20);
    expect(landings).toBe(0);expect(steps).toBeGreaterThan(8);
    expect(steps).toBeLessThanOrEqual(Math.floor(traveled/1.35)+1);expect(minStepGap).toBeGreaterThan(.15);
  }finally{map.dispose();}
},120000);
