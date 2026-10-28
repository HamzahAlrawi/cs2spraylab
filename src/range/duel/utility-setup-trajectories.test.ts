import {existsSync,readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {NativeMapCollision} from '../prefire/native-collision';
import {utilityLaunchPose} from './utility-ballistics';
import {UtilitySimulation,UTILITY_KERNEL_VERSION} from './utilities';
import type {UtilityKind} from './utility-loadout';
import setups from './utility-opportunities.json';

const chunks=[...new Set(setups.entries.map(entry=>entry.chunk))];
describe.skipIf(chunks.some(chunk=>!existsSync(`public/revamp/maps/dust2/duel/${chunk}/collision.bin`)))('saved bot throws against installed chunk collision',()=>{
  it.each(chunks)('replays each utility type in %s with the current physics fingerprint',async chunk=>{
    expect(setups.kernelVersion).toBe(UTILITY_KERNEL_VERSION);
    const root=`public/revamp/maps/dust2/duel/${chunk}/`,bytes=readFileSync(root+'collision.bin');
    const collision=await NativeMapCollision.create(JSON.parse(readFileSync(root+'collision.json','utf8')),
      bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    try {
      const arena={...collision.bounds!,native:collision,solids:[]},seen=new Set<string>();
      for(const entry of setups.entries.filter(item=>item.chunk===chunk)) {
        if(seen.has(entry.kind))continue;seen.add(entry.kind);
        expect(entry.collisionSha256).toBe(collision.collisionSha256);
        const sim=new UtilitySimulation(1),launch=utilityLaunchPose(entry.eye,entry.yaw,entry.pitch,arena);
        sim.throw({actorId:1,side:'enemy',kind:entry.kind as UtilityKind,...launch,strength:1,time:0});
        let detonation;
        for(let tick=1;tick<=768&&!detonation;tick++)detonation=sim.advance(1/128,tick/128,arena,[]).find(event=>event.type==='detonate');
        expect(detonation,entry.id).toBeDefined();
        expect(detonation!.time).toBeCloseTo(entry.flightSeconds,7);
        expect(Math.hypot(detonation!.position.x-entry.landing.x,detonation!.position.y-entry.landing.y,
          detonation!.position.z-entry.landing.z)).toBeLessThan(.001);
        expect(Math.hypot(detonation!.position.x-entry.target.x,detonation!.position.z-entry.target.z)).toBeLessThanOrEqual(2);
      }
      expect(seen.size).toBeGreaterThan(0);
    }finally{collision.dispose();}
  },30000);
});
