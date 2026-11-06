import fs from 'node:fs';
import {createServer} from 'vite';
import {nativeMapIdentity} from './native-map-identity.mjs';
const {assetId,out}=nativeMapIdentity(process.argv[2]);
const data=JSON.parse(fs.readFileSync(`src/range/prefire/data/openprefire-${assetId}.json`));
const vite=await createServer({mode:'test',cacheDir:'node_modules/.vite-map-probe',server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
let collision;
try{
  const {NativeMapCollision}=await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {placePrefireTarget}=await vite.ssrLoadModule('/src/range/prefire/placement.ts');
  const {walkPrefireAuditPath,auditPrefireMotorPath}=await vite.ssrLoadModule('/src/range/prefire/spawn-audit.ts');
  const bytes=fs.readFileSync(`${out}/collision.bin`);
  collision=await NativeMapCollision.create(JSON.parse(fs.readFileSync(`${out}/collision.json`)),bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const query=process.argv.find(a=>a.startsWith('--points='));
  if(query){
    for(const [x,y] of JSON.parse(query.slice(9))){const p={x:x*.0254,z:-y*.0254,y:0};
      console.log(JSON.stringify({point:[x,y],levels:[100,0,-40,-56,-80,-88,-136,-168,-264,-368].map(z=>{
        const hit=collision.vertical(p,(z+4)*.0254,(z-32)*.0254,72*.0254);return {requested:z,grounded:hit.grounded,feet:hit.feet/.0254};})}));}
  }else{
  const result={};
  for(const [id,p]of Object.entries(data.profiles)){
    const test=(point,crouched)=>{try{return placePrefireTarget(collision,point,crouched);}catch{return false;}};
    const floor=point=>{const w={x:point[0]*.0254,y:point[2]*.0254,z:-point[1]*.0254};return collision.vertical(w,w.y+.3,w.y-1.5,72*.0254).feet/.0254;};
    const invalid=p.angles.flatMap((a,i)=>test(a.position,a.crouched)?[]:[i+1]);
    let walk,motor;try{walkPrefireAuditPath(collision,[p.spawn,...p.path]);walk='passed';}catch(e){walk=e.message;}
    try{auditPrefireMotorPath(collision,[p.spawn,...p.path]);motor='passed';}catch(e){motor=e.message;}
    result[id]={spawn:test(p.spawn),spawnFloor:floor(p.spawn),path:p.path.map(point=>({point,fits:!!test(point),floor:floor(point)})),invalid,walk,motor};
  }
  console.log(JSON.stringify(result,null,2));
  }
}finally{collision?.dispose();await vite.close();}
