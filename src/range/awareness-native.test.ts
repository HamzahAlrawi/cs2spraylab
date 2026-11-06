import {existsSync,readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {Group,PerspectiveCamera} from 'three';
import {NativeMapCollision,type NativeCollisionManifest} from './prefire/native-collision';
import type {PrefireMap} from './prefire/map';
import {dust2Catalog} from './prefire/routes';
import {sourcePoint} from './prefire/route-helpers';
import {buildAwarenessArena,type AwarenessWorld} from './awareness-map';
import {AwarenessSession} from './awareness-session';
import {awarenessDefaults} from './awareness';
import {defaults} from './config';
import type {RangeAudio} from './audio';

const base='public/revamp/maps/dust2/';
it.skipIf(!existsSync(`${base}collision.bin`))('finds playable cues across native route starts and avoids spatial repetition over real trials',async()=>{
  const bytes=readFileSync(`${base}collision.bin`),manifest=JSON.parse(readFileSync(`${base}collision.json`,'utf8')) as NativeCollisionManifest;
  const collision=await NativeMapCollision.create(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  try {
    const map={scene:new Group(),collision,dispose(){}} as PrefireMap;
    const {arena,sources}=await buildAwarenessArena(map,dust2Catalog,new AbortController().signal);
    const world:AwarenessWorld={mapId:dust2Catalog.id,name:'Dust 2',scene:map.scene,arena,sources,updateView(){},radarOverview:()=>undefined,loadingReport:()=>undefined,dispose(){}};
    const session=new AwarenessSession(world,{...awarenessDefaults,cues:'utility',autoNext:false}),sim=session.create(defaults,1);
    const audio={context:{state:'running'},canPlayEvent:()=>true,playEvent:()=>true,cancelAction(){},stopVoices(){}} as unknown as RangeAudio;
    const camera=new PerspectiveCamera(),missing:string[]=[];
    const present=()=>{
      let maxSlice=0;
      for(let frame=0;frame<128;frame++){
        const before=performance.now();session.present({sim,audio,camera,events:[],active:true,volume:.5});
        maxSlice=Math.max(maxSlice,performance.now()-before);if(!(session as any).search)break;
      }
      return maxSlice;
    };
    for(const route of dust2Catalog.routes)for(const cues of ['steps','jump','shots','reload','utility'] as const){
      const actor=sim.actors[0],p=sourcePoint(route.spawn);actor.feet=p.y;actor.position={...p,y:p.y+actor.eyeHeight};
      session.configure({...awarenessDefaults,cues,autoNext:false});sim.time=1;
      present();
      sim.time=1.8;present();
      const trial=(session as any).trial;
      if(!trial)missing.push(`${route.id}/${cues}`);
      if(cues==='utility'&&!session.statusReport().heard)missing.push(`${route.id}/silent-utility`);
      if(trial){
        expect(Math.hypot(trial.feet.x-p.x,trial.feet.y-p.y,trial.feet.z-p.z)).toBeLessThanOrEqual(28);
        const height=(trial.crouched?54:72)*.0254;
        expect(collision.fits(trial.feet,trial.feet.y,height)).toBe(true);
        const support=collision.vertical(trial.feet,trial.feet.y+.015,trial.feet.y-.05,height);
        expect(support.grounded).toBe(true);expect(Math.abs(support.feet-trial.feet.y)).toBeLessThan(.05);
        expect(sources.some(s=>Math.hypot(s.feet.x-trial.feet.x,s.feet.z-trial.feet.z)<=(s.spread??1.8)*2.5+.01)).toBe(true);
      }
    }
    expect(missing).toEqual([]);
    for(const [region,id] of ['long-doors','mid-doors','b-tunnels'].entries()){
      const positions:{x:number;y:number;z:number}[]=[],selectionMs:number[]=[];
      const actor=sim.actors[0],start=sourcePoint(dust2Catalog.routes.find(route=>route.id===id)!.spawn);
      actor.feet=start.y;actor.position={...start,y:start.y+actor.eyeHeight};
      session.configure({...awarenessDefaults,cues:'utility',autoNext:false});
      for(let rep=0;rep<100;rep++){
        sim.time=10+region*400+rep*3;session.next(sim.time);sim.time+=1;
        selectionMs.push(present());
        sim.time+=.9;present();
        sim.time+=.2;present();
        const trial=(session as any).trial;if(trial?.heardAt!==undefined&&sim.time>=trial.heardAt)positions.push({...trial.feet});
      }
      const cells=new Set(positions.map(p=>`${Math.floor(p.x)}:${Math.floor(p.y)}:${Math.floor(p.z)}`)).size;
      const close=positions.slice(1).filter((p,i)=>Math.hypot(p.x-positions[i].x,p.y-positions[i].y,p.z-positions[i].z)<1.5).length;
      selectionMs.sort((a,b)=>a-b);
      console.log(JSON.stringify({region:id,awarenessFinalSources:positions.length,meterCells:cells,adjacentNearRepeats:close,
        maxSliceMedianMs:+selectionMs[50].toFixed(2),maxSliceP95Ms:+selectionMs[95].toFixed(2)}));
      expect(positions).toHaveLength(100);expect(cells).toBeGreaterThan(region===0?70:45);expect(close).toBeLessThan(5);
    }
  }finally{collision.dispose();}
},120000);
