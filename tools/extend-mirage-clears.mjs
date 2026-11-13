import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
const file='src/range/prefire/data/mirage-authored-routes.json',data=JSON.parse(fs.readFileSync(file));
const specs={
  'a-ramp':[[95.258591,-2070.39917,-168.96875],[-265.248535,-2186.310059,-173.707657],[-495.810791,-2093.833496,-180.96875],[-808.24762,-2307.05249,-178.677567]],
  'market-b':[[-2508.191406,400.336761,-168.96875],[-2634.04248,499.1091,-159.968719]],
};
const vite=await createServer({mode:'test',cacheDir:'node_modules/.vite-extend-clear',server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom',logLevel:'error'});
let collision;
try{
  const {NativeMapCollision}=await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {sourcePoint}=await vite.ssrLoadModule('/src/range/prefire/route-helpers.ts');
  const audit=await vite.ssrLoadModule('/src/range/prefire/spawn-audit.ts');
  const {prepareNativeNavigation,nativeRouteTo}=await vite.ssrLoadModule('/src/range/duel/native-navigation.ts');
  const base='public/revamp/maps/mirage/',bytes=fs.readFileSync(base+'collision.bin'),manifest=JSON.parse(fs.readFileSync(base+'collision.json'));
  if(createHash('sha256').update(bytes).digest('hex')!==manifest.collisionSha256)throw Error('Collision mismatch');
  collision=await NativeMapCollision.create(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const floor=p=>{const w=sourcePoint(p),s=collision.vertical(w,w.y+16*.0254,w.y-24*.0254,72*.0254);
    if(!s.grounded||!collision.fits(w,s.feet,72*.0254))throw Error(`Unsupported landmark ${p}`);return [p[0],p[1],s.feet/.0254];};
  const goals=Object.fromEntries(Object.entries(specs).map(([id,points])=>[id,points.map(floor)]));
  const arena={...collision.bounds,solids:[],native:collision};
  const underpassStart=floor([-351.364014,416.931061,-80]);
  prepareNativeNavigation(arena,[...data.routes.flatMap(r=>[r.spawn,...r.path]),...Object.values(goals).flat(),underpassStart].map(sourcePoint));
  const underpass=data.routes.find(r=>r.id==='underpass-connector');
  if(underpass.entryRevision!=='house-stairs-v1'){
    const prefix=nativeRouteTo(sourcePoint(underpassStart),sourcePoint(underpass.spawn),arena);
    if(!prefix.length)throw Error('No supported walking entry from House into Underpass');
    const path=[...prefix.map(p=>[p.x/.0254,-p.z/.0254,p.y/.0254]),...underpass.path];
    audit.walkPrefireAuditPath(collision,[underpassStart,...path]);audit.walkPrefireAuditPath(collision,[underpassStart,...path],true);
    audit.auditPrefireMotorPath(collision,[underpassStart,...path]);
    underpass.spawn=underpassStart;underpass.path=path;underpass.look=path[0];underpass.startLabel='House / Underpass stairs';
    underpass.entryRevision='house-stairs-v1';console.log('underpass-connector',prefix.length,'supported entry waypoints');
  }
  for(const [id,points] of Object.entries(goals)){
    const route=data.routes.find(r=>r.id===id);
    if(route.clearExtension==='common-pockets-v1')continue;
    const path=[...route.path];let from=sourcePoint(path.at(-1));
    for(const target of points){const to=sourcePoint(target),steps=nativeRouteTo(from,to,arena);
      if(!steps.length)throw Error(`No path for ${id}/${target}`);
      path.push(...steps.map(p=>[p.x/.0254,-p.z/.0254,p.y/.0254]));from=to;}
    audit.walkPrefireAuditPath(collision,[route.spawn,...path]);audit.walkPrefireAuditPath(collision,[route.spawn,...path],true);
    audit.auditPrefireMotorPath(collision,[route.spawn,...path]);
    route.path=path;route.clearExtension='common-pockets-v1';console.log(id,path.length,'native-supported waypoints');
  }
  if(process.argv.includes('--apply'))fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
}finally{collision?.dispose();await vite.close();}
