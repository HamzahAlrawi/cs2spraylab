import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';
import {nativeMapIdentity} from './native-map-identity.mjs';
import {brushEntities,entityPhysicsTriangles,grenadeBlocks} from './grenade-map-geometry.mjs';
import RAPIER from '@dimforge/rapier3d-compat';

const map=nativeMapIdentity(process.argv[2]??'de_dust2'),game=process.env.CS2_PATH??'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli=path.resolve(process.env.CS2_MAP_CLI??'.local-tools/vrf-dev/Source2Viewer-CLI.exe');
const vpk=`${game}/game/csgo/maps/${map.mapId}.vpk`,work=path.join(map.work,'grenade-physics');
fs.mkdirSync(work,{recursive:true});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const run=args=>execFileSync(cli,args,{encoding:'utf8',maxBuffer:128*1024*1024,windowsHide:true});
const world=JSON.parse(fs.readFileSync(path.join(map.out,'collision.json'),'utf8')),worldBytes=fs.readFileSync(path.join(map.out,'collision.bin'));
const mapSha256=hash(fs.readFileSync(vpk));
if(world.mapSha256!==mapSha256)throw Error('Native map VPK changed: rebuild/review world collision before adding brush physics.');
const build=fs.readFileSync(`${game}/game/csgo/steam.inf`,'utf8').match(/ClientVersion=(\d+)/)[1];
const lump=`maps/${map.mapId}/entities/default_ents.vents_c`,lumpRaw=path.join(work,'entities.vents_c'),lumpText=path.join(work,'entities.vents');
run(['-i',vpk,'-f',lump,'-o',lumpRaw]);run(['-i',lumpRaw,'-d','-o',lumpText]);
const entities=brushEntities(fs.readFileSync(lumpText,'utf8')),parts=[],groups=[],sources=[];let offset=0;
const append=(vertices,indices,source)=>{
  if(!indices.length)return;
  groups.push({offset,vertexCount:vertices.length/3,indexCount:indices.length});
  const v=Buffer.from(vertices.buffer,vertices.byteOffset,vertices.byteLength),i=Buffer.from(indices.buffer,indices.byteOffset,indices.byteLength);
  parts.push(v,i);offset+=v.length+i.length;sources.push(source);
};
const appendWorld=(manifest,binary,source)=>{
  for(const g of manifest.groups.filter(grenadeBlocks))append(new Float32Array(binary.buffer,binary.byteOffset+g.offset,g.vertexCount*3),
    new Uint32Array(binary.buffer,binary.byteOffset+g.offset+g.vertexCount*12,g.indexCount),{...source,group:g.id});
};
appendWorld(world,worldBytes,{kind:'world',sha256:world.sourceSha256});
// Older Dust 2 world exports kept grenade-only PHYS groups in a separate archive.
if(!world.groups.some(g=>g.tags?.includes('csgo_grenadeclip'))&&fs.existsSync(path.join(map.out,'grenade-clips.json'))){
  const clips=JSON.parse(fs.readFileSync(path.join(map.out,'grenade-clips.json'),'utf8'));
  if(clips.mapSha256!==mapSha256||clips.sourceSha256!==world.sourceSha256)throw Error('Stale grenade clip source');
  appendWorld(clips,fs.readFileSync(path.join(map.out,'grenade-clips.bin')),{kind:'grenadeclip',sha256:clips.sourceSha256});
}
for(const [index,entity]of entities.entries()){
  if(!entity.model.startsWith(`maps/${map.mapId}/entities/`)||entity.model.includes('..'))throw Error('Unsafe native brush resource');
  const file=path.join(work,`brush-${index}.vmdl_c`);run(['-i',vpk,'-f',`${entity.model}_c`,'-o',file]);
  const dump=run(['-i',file,'-b','PHYS']);
  if(!dump.includes('<!-- kv3'))throw Error(`Missing native brush PHYS: ${entity.model}`);
  const text=dump.slice(dump.indexOf('<!-- kv3')).replace(/#\[([\s\S]*?)\]/g,(_,hex)=>JSON.stringify(Buffer.from(hex.replace(/\s/g,''),'hex').toString('base64')));
  const {vertices,indices}=entityPhysicsTriangles(parseKv3(text),entity);
  append(vertices,indices,{kind:entity.classname,resource:`${entity.model}_c`,sha256:hash(fs.readFileSync(file)),
    origin:entity.origin,angles:entity.angles,scales:entity.scales,hammerId:entity.hammeruniqueid});
}
const binary=Buffer.concat(parts),manifest={version:1,mapId:map.mapId,build,mapSha256,worldCollisionSha256:world.collisionSha256,
  binarySha256:hash(binary),unit:.0254,groups,sources,entityLump:{resource:lump,sha256:hash(fs.readFileSync(lumpRaw))},
  extractorSha256:hash(fs.readFileSync(cli)),policy:'Native world + enabled static brush PHYS, complete map grenade queries only. Dynamic/breakable state is not simulated.'};
await RAPIER.init();
const query=new RAPIER.World({x:0,y:0,z:0});
try{
  for(const g of groups)query.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(binary.buffer,binary.byteOffset+g.offset,g.vertexCount*3),
    new Uint32Array(binary.buffer,binary.byteOffset+g.offset+g.vertexCount*12,g.indexCount)));
  query.step();const snapshot=query.takeSnapshot();
  manifest.engine=RAPIER.version();manifest.snapshotSha256=hash(snapshot);
  fs.writeFileSync(path.join(map.out,'grenade-query.bin'),snapshot);
}finally{query.free();}
fs.writeFileSync(path.join(map.out,'grenade-collision.bin'),binary);
fs.writeFileSync(path.join(map.out,'grenade-collision.json'),JSON.stringify(manifest));
console.log(JSON.stringify({map:map.mapId,build,brushes:entities.length,triangles:groups.reduce((sum,g)=>sum+g.indexCount/3,0),bytes:binary.length,sources}));
