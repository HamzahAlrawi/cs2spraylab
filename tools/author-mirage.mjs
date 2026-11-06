import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';

const dataset=JSON.parse(fs.readFileSync('src/range/prefire/data/openprefire-mirage.json'));
const base='public/revamp/maps/mirage/',revision='2026-11-06-mirage-beta-v1';
// Deliberate landmark/approach adaptations. Upstream path Z often denotes an
// arrow above the floor; only these authored player paths are floor-resolved.
// Sourced enemy XYZ is never altered or used as a measured probability.
const courses=[
  {id:'a-ramp',name:'Ramp to A',region:'A site',profile:'a_ramp',start:[1189,-880,-255],path:dataset.profiles.a_ramp.path.slice(0,3)},
  {id:'a-palace',name:'Palace balcony',region:'A site',profile:'a_palace',start:[954,-1422,-168],path:[[954,-1600,-120],[954,-1800,-72],[900,-2250,-40],[80,-2250,-40],[80,-2130,-40]]},
  {id:'b-apartments',name:'Apartments to B',region:'B site',profile:'b_apts',start:[-800,560,-88],path:[[-1150,560,-88],[-1400,700,-56],[-1520,785,-56]]},
  {id:'mid-short',name:'Top mid to Short',region:'Mid & Short',profile:'mid_to_b',start:[1216,-16,-164],path:dataset.profiles.mid_to_b.path.slice(0,6)},
  {id:'underpass-connector',name:'Underpass to Connector',region:'Mid & Short',profile:'under_to_jungle',start:[-1003,412,-368],path:dataset.profiles.under_to_jungle.path.slice(5,11)},
  {id:'market-b',name:'Market retake',region:'B site',profile:'b_retake',start:[-2331,-592,-168],path:[[-2331,100,-168],[-2331,500,-168]],side:'t'},
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const callout=([x,y,z])=>z<-300?'Underpass':y>600&&z>-130?'Apartments / Van':x<-1600&&y>0?'B site':
  x<-1700&&y>-900?'Market':x<-700&&y>0?'Short / Ladder':y>-600&&x>300?'Top mid':y>-900?'Mid / Window':
  x>600&&z>-130?'Palace':x>400&&y>-1800?'Ramp / Tetris':x<-1000&&y<-1800?'CT / Ticket':
  x<-700?'Jungle':y>-1700&&x<0?'Stairs / Connector':'A site';
const vite=await createServer({mode:'test',cacheDir:'node_modules/.vite-mirage-author',server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
let collision;
try{
  const {NativeMapCollision}=await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {placePrefireTarget}=await vite.ssrLoadModule('/src/range/prefire/placement.ts');
  const audit=await vite.ssrLoadModule('/src/range/prefire/spawn-audit.ts');
  const {actorHeadPoint}=await vite.ssrLoadModule('/src/range/duel/geometry.ts');
  const {sourcePoint}=await vite.ssrLoadModule('/src/range/prefire/route-helpers.ts');
  const {prepareNativeNavigation,nativeRouteTo}=await vite.ssrLoadModule('/src/range/duel/native-navigation.ts');
  const manifest=JSON.parse(fs.readFileSync(base+'collision.json')),bytes=fs.readFileSync(base+'collision.bin');
  if(hash(bytes)!==manifest.collisionSha256)throw Error('Mirage collision checksum mismatch.');
  collision=await NativeMapCollision.create(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const source=w=>[w.x/.0254,-w.z/.0254,w.y/.0254];
  const floor=point=>{
    const p={x:point[0]*.0254,y:point[2]*.0254,z:-point[1]*.0254},support=collision.vertical(p,p.y+8*.0254,p.y-24*.0254,72*.0254);
    if(!support.grounded||!collision.fits(p,support.feet,72*.0254))throw Error(`Authored waypoint has no same-level support: ${point}`);
    return [point[0],point[1],support.feet/.0254];
  };
  const routes=[],report={mapId:'de_mirage',revision,build:manifest.build,collisionSha256:manifest.collisionSha256,routes:[],rejectedHolds:[]};
  const candidates=Object.entries(dataset.profiles).flatMap(([profile,p])=>p.angles.map((a,i)=>({
    id:`de_mirage:openprefire/${profile}/${i+1}`,name:`${callout(a.position)} / ${profile.replaceAll('_',' ')} ${i+1}`,position:a.position,rotation:a.rotation,crouched:a.crouched,
    moving:!a.crouched,source:{dataset:'openprefire-mirage',profile,index:i+1}})));
  const valid=candidates.filter(a=>{try{placePrefireTarget(collision,a.position,a.crouched);return true;}catch(e){report.rejectedHolds.push({id:a.id,reason:e.message});return false;}});
  const seeds=valid.map(a=>placePrefireTarget(collision,a.position,a.crouched));
  for(const c of courses)for(const p of [c.start,...c.path])try{seeds.push(sourcePoint(floor(p)));}catch{}
  const arena={...collision.bounds,native:collision,solids:[]};
  prepareNativeNavigation(arena,seeds);
  for(const course of courses){
    try{
      const spawn=floor(course.start),path=[];let previous=sourcePoint(spawn);
      for(const target of course.path.map(floor)){
        const route=nativeRouteTo(previous,sourcePoint(target),arena);
        if(!route.length)throw Error(`No native walking path to landmark ${target}`);
        path.push(...route.map(source));previous=sourcePoint(target);
      }
      const points=[spawn,...path];
      const walked=audit.walkPrefireAuditPath(collision,points);audit.walkPrefireAuditPath(collision,points,true);audit.auditPrefireMotorPath(collision,points);
      const eyeSamples=audit.prefireSpawnEyes(placePrefireTarget(collision,spawn)),entryEyes=[];
      let distance=0;for(let i=1;i<walked.length;i++){distance+=Math.hypot(walked[i].x-walked[i-1].x,walked[i].z-walked[i-1].z);
        if(distance>32*.0254)break;entryEyes.push(...audit.prefireSpawnEyes(walked[i]));}
      const sameFamily=course.region==='A site'?['a_ramp','a_palace']:course.region==='B site'?['b_apts','b_retake','mid_to_b']:['mid_to_b','under_to_jungle'];
      const eligible=valid.filter(a=>sameFamily.includes(a.source.profile)).filter(a=>{
        const feet=placePrefireTarget(collision,a.position,a.crouched),head=actorHeadPoint(feet,a.crouched?1:0,(a.rotation[1]-90)*Math.PI/180);
        if(audit.prefireBodyExposed(collision,eyeSamples,[audit.prefireUpperBodySamples(feet,a.crouched)]))return false;
        if(audit.prefireBodyExposed(collision,entryEyes,[audit.prefireUpperBodyExtrema(feet,a.crouched)]))return false;
        return walked.some(p=>!audit.nativeSightBlocked(collision,{...p,y:p.y+64*.0254},head));
      });
      // Prefer this approach's coordinate profile while keeping physical alternatives.
      eligible.sort((a,b)=>Number(b.source.profile===course.profile)-Number(a.source.profile===course.profile));
      const selected=[];for(const a of eligible)if(selected.every(b=>Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1])>64))selected.push(a);
      if(selected.length<5)throw Error(`Only ${selected.length} non-overlapping concealed/hittable holds.`);
      routes.push({id:course.id,name:course.name,region:course.region,enemySide:course.side??'ct',phase:course.side?'postplant':'preplant',
        startLabel:course.name.split(' to ')[0],spawn,look:path[0],path,angles:selected.slice(0,5),alternatives:eligible.filter(a=>!selected.slice(0,5).includes(a))});
      report.routes.push({id:course.id,status:'passed',holds:eligible.length,walkSamples:walked.length});
    }catch(e){report.routes.push({id:course.id,status:'failed',reason:e.message});}
  }
  fs.mkdirSync('research/mirage',{recursive:true});
  fs.writeFileSync('research/mirage/authoring-report.json',JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync('src/range/prefire/data/mirage-authored-routes.json',JSON.stringify({revision,routes},null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{collision?.dispose();await vite.close();}
