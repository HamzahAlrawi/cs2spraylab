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
it.skipIf(!existsSync(`${base}collision.bin`))('finds audible nearby hidden cues across full-map native route starts',async()=>{
  const bytes=readFileSync(`${base}collision.bin`),manifest=JSON.parse(readFileSync(`${base}collision.json`,'utf8')) as NativeCollisionManifest;
  const collision=await NativeMapCollision.create(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  try {
    const map={scene:new Group(),collision,dispose(){}} as PrefireMap;
    const {arena,sources}=await buildAwarenessArena(map,dust2Catalog,new AbortController().signal);
    const world:AwarenessWorld={mapId:dust2Catalog.id,name:'Dust 2',scene:map.scene,arena,sources,updateView(){},radarOverview:()=>undefined,loadingReport:()=>undefined,dispose(){}};
    const session=new AwarenessSession(world,{...awarenessDefaults,cues:'utility',autoNext:false}),sim=session.create(defaults,1);
    const audio={context:{state:'running'},canPlayEvent:()=>true,playEvent:()=>true,cancelAction(){},stopVoices(){}} as unknown as RangeAudio;
    const camera=new PerspectiveCamera(),missing:string[]=[];
    for(const route of dust2Catalog.routes)for(const cues of ['steps','jump','shots','reload','utility'] as const){
      const actor=sim.actors[0],p=sourcePoint(route.spawn);actor.feet=p.y;actor.position={...p,y:p.y+actor.eyeHeight};
      session.configure({...awarenessDefaults,cues,autoNext:false});sim.time=1;
      session.present({sim,audio,camera,events:[],active:true,volume:.5});
      sim.time=1.8;session.present({sim,audio,camera,events:[],active:true,volume:.5});
      const trial=(session as any).trial;
      if(!trial)missing.push(`${route.id}/${cues}`);
      if(cues==='utility'&&!session.statusReport().heard)missing.push(`${route.id}/silent-utility`);
      if(trial){
        expect(Math.hypot(trial.feet.x-p.x,trial.feet.y-p.y,trial.feet.z-p.z)).toBeLessThanOrEqual(28);
        const height=(trial.crouched?54:72)*.0254;
        expect(collision.fits(trial.feet,trial.feet.y,height)).toBe(true);
        const support=collision.vertical(trial.feet,trial.feet.y+.015,trial.feet.y-.05,height);
        expect(support.grounded).toBe(true);expect(Math.abs(support.feet-trial.feet.y)).toBeLessThan(.05);
        expect(sources.some(s=>Math.hypot(s.feet.x-trial.feet.x,s.feet.z-trial.feet.z)<=2.01)).toBe(true);
      }
    }
    expect(missing).toEqual([]);
  }finally{collision.dispose();}
},120000);
