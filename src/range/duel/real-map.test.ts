import {readFileSync,existsSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {Group} from 'three';
import {chooseRealMapChunk,chunkBounds,createRealMapArena,realMapChunks} from './real-map';
import {duelDefaults,sanitizeDuelConfig} from './config';
import {NativeMapCollision} from '../prefire/native-collision';
import type {PrefireMap} from '../prefire/map';
import {DuelSimulation} from './simulation';
import {UNIT,STEP} from '../actor-physics';
import {installNativeNavigation,nativeNavigationSize} from './native-navigation';
import {clearSegment,routeTo} from './navigation';
import rounds from './real-map-round-data.json';
import type {RoundCatalog} from './real-map-rounds';
import {angleIdentity} from '../prefire/occupancy';
import {revealsPrefireStart} from '../prefire/bot-behavior';

describe('real map Duel configuration',()=>{
  it('makes real chunks and arrows the new/legacy default, without losing procedural preferences',()=>{
    for(const input of [undefined,{}, {mapDesign:'Courtyard',arenaScale:1.3}]) {
      expect(sanitizeDuelConfig(input)).toMatchObject({generatedMaps:false,realMapChunk:'random',routeGuide:true});
    }
    expect(duelDefaults.generatedMaps).toBe(false);
    expect(sanitizeDuelConfig({generatedMaps:true,realMapChunk:'bad',routeGuide:false})).toMatchObject({generatedMaps:true,realMapChunk:'random',routeGuide:false});
  });
  it('uses deterministic map seeds, supports explicit selection and avoids repeats',()=>{
    const seen=new Set<string>();
    for(let seed=0;seed<50;seed++) {
      const chunk=chooseRealMapChunk('random',seed);seen.add(chunk.id);
      expect(chooseRealMapChunk('random',seed)).toEqual(chunk);
      expect(chooseRealMapChunk('random',seed,chunk.id).id).not.toBe(chunk.id);
      expect(chooseRealMapChunk(chunk.id,seed,'other').id).toBe(chunk.id);
    }
    expect(seen.size).toBe(realMapChunks.length);
  });
});

describe.each(realMapChunks)('$id native combat integration',chunk=>{
  it.skipIf(!existsSync(`public/revamp/maps/dust2/duel/${chunk.id}/collision.bin`))('preserves scale/holds, full Duel brains and terrain-supported navigation',async()=>{
    const base=`public/revamp/maps/dust2/duel/${chunk.id}/`;
    const bytes=readFileSync(base+'collision.bin');
    const collision=await NativeMapCollision.create(JSON.parse(readFileSync(base+'collision.json','utf8')),
      bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
    const map:PrefireMap={collision,scene:new Group(),settle:()=>{throw Error('unused');},dispose:()=>collision.dispose()};
    try {
      const config=sanitizeDuelConfig({botCount:5,skill:8,playerHealth:500,health:500});
      installNativeNavigation({...chunkBounds(chunk),solids:[],native:collision},JSON.parse(readFileSync(base+'navigation.json','utf8')));
      const catalog=(rounds as unknown as RoundCatalog).chunks[chunk.id];
      for(const seed of [1,7,23]) {
        const arena=createRealMapArena(map,chunk,config,seed,(rounds as unknown as RoundCatalog).chunks[chunk.id]),sim=new DuelSimulation(config,seed,arena);
        expect(arena.solids).toEqual([]);expect(arena.native).toBe(collision);
        const course=catalog.courses.find(course=>course.id===arena.roundSetup!.course)!;
        const start=course.starts.find(start=>start.viewIndex===arena.roundSetup!.start)!;
        expect(arena.spawns!.player.feet).toEqual(start.feet);
        expect(arena.maxX-arena.minX).toBeCloseTo((chunk.sourceMax[0]-chunk.sourceMin[0])*UNIT,8);
        expect(nativeNavigationSize(arena)).toBeGreaterThan(20);
        expect(sim.actors).toHaveLength(6);
        for(const actor of sim.actors) {
          expect(collision.fits(actor.position,actor.feet,(actor.duckAmount?54:72)*UNIT)).toBe(true);
          expect(actor.position.y-actor.feet).toBeCloseTo((actor.duckAmount?46:64)*UNIT,5);
          if(actor.id) {
            const hold=course.holds.find(hold=>angleIdentity(hold.angle)===arena.roundSetup!.holds[actor.id-1])!;
            expect([hold.source,hold.sheltered].some(p=>Math.hypot(p.x-actor.position.x,p.z-actor.position.z)<.001)).toBe(true);
            expect(revealsPrefireStart(collision,{...actor.position,y:actor.feet},!!actor.duckAmount,sim.actors[0].position,actor.yaw)).toBe(false);
            expect(sim.botDecision(actor.id)).toBeDefined();
          }
        }
        for(const lane of arena.lanes!) {
          expect(clearSegment(lane.anchor,lane.edge,arena)).toBe(true);
          expect(lane.watch).toBeDefined();
        }
        const walk=routeTo(sim.actors[0].position,arena.tactical!.searchPoints[0],arena);
        expect(walk.length,'covered start must connect to the clearing path').toBeGreaterThan(0);
        let previous=sim.actors[0].position;
        for(const next of walk){expect(clearSegment(previous,next,arena)).toBe(true);previous=next;}
        sim.start();for(let tick=0;tick<64;tick++)sim.step();
        expect(sim.time).toBeCloseTo(64*STEP,6);
        expect(sim.replay.export().frames.length).toBeGreaterThan(1);
      }
    }finally{collision.dispose();}
  },120000);
});
