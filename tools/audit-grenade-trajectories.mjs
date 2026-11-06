// Offline launch-state replay only: no game process, hooks, automation or network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createServer} from 'vite';
import {nativeMapIdentity} from './native-map-identity.mjs';

const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
if(!arg('map'))throw Error('Specify --map=<registered native map ID>.');
const map=nativeMapIdentity(arg('map')),files=arg('input')?.split(',');
if(!files?.length)throw Error('Use --map=de_mirage --input=<local captured JSON/JSONL> [--out=research/report.json] [--max-error=8]');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const triple=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const world=v=>({x:v[0]*.0254,y:v[2]*.0254,z:-v[1]*.0254});
const source=v=>[v.x/.0254,-v.z/.0254,v.y/.0254];
const captures=[],inputs=[];
for(const file of files){
  const bytes=fs.readFileSync(file),text=bytes.toString('utf8');
  const document=file.endsWith('.jsonl')?text.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)):JSON.parse(text);
  if(document.map&&document.map!==map.mapId)throw Error(`Foreign map capture: ${file}`);
  inputs.push({file,sha256:hash(bytes),build:document.serverBuild??document.build??'unknown'});
  const rows=Array.isArray(document)?document:document.cases??document.results;
  if(!Array.isArray(rows))throw Error(`Expected cases/results or JSONL records: ${file}`);
  for(const [index,row]of rows.entries()){
    if(row.Detonated===false||row.detonated===false)continue;
    const start=row.position??row.Pos??row.start,velocity=row.velocity??row.Vel,rest=row.expectedRest??row.RealRest??row.rest;
    if(!triple(start)||!triple(velocity)||!triple(rest))throw Error(`Invalid Source-unit vectors in ${file} row ${index}`);
    captures.push({id:row.id??`${path.basename(file)}:${row.Index??index}`,start,velocity,rest});
  }
}
if(!captures.length||captures.length>10000)throw Error('Supply 1..10000 recorded launch states.');
const vite=await createServer({cacheDir:'node_modules/.vite-grenade-trajectories',server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
let query;
try{
  const {acquireNativeGrenadeQuery}=await vite.ssrLoadModule('/src/range/prefire/native-grenade-query.ts');
  const {UtilitySimulation,UTILITY_KERNEL_VERSION}=await vite.ssrLoadModule('/src/range/duel/utilities.ts');
  const manifest=JSON.parse(fs.readFileSync(path.join(map.out,'grenade-collision.json'),'utf8'));
  const bytes=fs.readFileSync(path.join(map.out,'grenade-query.bin'));
  query=await acquireNativeGrenadeQuery(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),manifest.worldCollisionSha256);
  // Stop at first physical rest; smoke-volume appearance is outside this audit.
  const arena={minX:-Infinity,maxX:Infinity,minZ:-Infinity,maxZ:Infinity,solids:[],native:{ray:()=>undefined,sweepGrenade:(...args)=>query.sweep(...args)}};
  const results=[];
  for(const capture of captures){
    const sim=new UtilitySimulation(),contacts=[];
    sim.throw({actorId:0,side:'player',kind:'smoke',origin:world(capture.start),direction:{x:1,y:0,z:0},strength:1,time:0});
    Object.assign(sim.projectiles[0],{velocity:world(capture.velocity)});
    let rest,last;
    for(let tick=1;tick<=20*128&&!rest;tick++){
      const events=sim.advance(1/128,tick/128,arena,[]);
      contacts.push(...events.filter(event=>event.type==='bounce').map(event=>({time:event.time,position:source(event.position),normal:[event.normal.x,-event.normal.z,event.normal.y]})));
      rest=events.find(event=>event.type==='detonate')??(sim.projectiles[0]?.resting?sim.projectiles[0]:undefined);
      if(sim.projectiles[0])last={position:source(sim.projectiles[0].position),velocity:source(sim.projectiles[0].velocity),time:tick/128};
      if(!sim.projectiles.length&&!rest)break;
    }
    const actual=rest?source(rest.position):undefined;
    results.push({...capture,actual,error:actual?Math.hypot(...actual.map((v,i)=>v-capture.rest[i])):null,contacts,...(!actual?{last}:{} )});
  }
  const errors=results.flatMap(result=>result.error===null?[]:[result.error]).sort((a,b)=>a-b);
  const summary={map:map.mapId,kernel:UTILITY_KERNEL_VERSION,nativeArchiveBuild:manifest.build,inputs,
    collisionSha256:manifest.worldCollisionSha256,grenadeSnapshotSha256:manifest.snapshotSha256,
    cases:results.length,unsettled:results.length-errors.length,diagnosticSeconds:20,median:errors[Math.floor(errors.length*.5)],p90:errors[Math.floor(errors.length*.9)],maximum:errors.at(-1),
    within1:errors.filter(v=>v<=1).length,within8:errors.filter(v=>v<=8).length,
    scope:'Recorded release position/velocity to first rest only. Input clocks, movement, smoke bloom and mismatched native builds are not certified.'};
  if(arg('out'))fs.writeFileSync(arg('out'),JSON.stringify({summary,results},null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));
  if(arg('max-error')!==undefined){
    const limit=Number(arg('max-error'));
    if(!Number.isFinite(limit)||limit<0)throw Error('Invalid --max-error');
    if(summary.unsettled||errors.some(value=>value>limit))process.exitCode=1;
  }
}finally{query?.release();await vite.close();}
