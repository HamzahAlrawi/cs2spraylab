import {existsSync, readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {NativeMapCollision, type NativeCollisionManifest} from '../prefire/native-collision';
import {bodyBehindCover, CoverDiscipline} from './cover-discipline';
import {testArena, type Arena, type CoverLane} from './geometry';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import rounds from './real-map-round-data.json';

const base='public/revamp/maps/dust2/duel/dust2-mid-ct/';
// Game-derived collision is deliberately not shipped in the source repository.
it.skipIf(!existsSync(`${base}collision.bin`))('tucks the real CT-to-Mid shoulder leak onto hull-supported ramp ground',async()=>{
  const manifest=JSON.parse(readFileSync(`${base}collision.json`,'utf8')) as NativeCollisionManifest;
  const bytes=readFileSync(`${base}collision.bin`);
  const collision=await NativeMapCollision.create(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
  try {
    const hold=rounds.chunks['dust2-mid-ct'].courses.flatMap(course=>course.holds)
      .find(hold=>hold.angle.id==='openprefire:ct_push_mid/11')!;
    const arena:Arena={...collision.bounds,solids:[],native:collision};
    const self={...new DuelSimulation(sanitizeDuelConfig({}),1,testArena()).snapshot()[1],
      position:{...hold.sheltered,y:hold.sheltered.y+1.6256},feet:hold.sheltered.y,duckAmount:0,grounded:true};
    expect(bodyBehindCover(hold.sheltered,0,hold.lane.watch,arena)).toBe(false);
    const discipline=new CoverDiscipline('10+',1),goal=discipline.update(self,hold.lane.watch,arena,hold.lane as CoverLane,1,true,false);
    expect(goal).toBeDefined();
    expect(bodyBehindCover(goal!,discipline.crouching?1:0,hold.lane.watch,arena)).toBe(true);
    expect(collision.fits(goal!,goal!.y,1.8288)).toBe(true);
    expect(goal!.y).toBeCloseTo(.011127993760599916,5);
  } finally {collision.dispose();}
},120000);
