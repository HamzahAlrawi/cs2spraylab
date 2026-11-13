// Offline coordinate admission. Never run this search in the browser/render loop.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';

const root='src/range/prefire/data/',file=root+'mirage-authored-routes.json';
const current=JSON.parse(fs.readFileSync(file)),practice=JSON.parse(fs.readFileSync(root+'openprefire-mirage.json')),
  retakes=JSON.parse(fs.readFileSync(root+'retakes-mirage.json')),
  community=JSON.parse(fs.readFileSync(root+'community-retakes-mirage.json'));
const names={2:'Default / front box',3:'Triple / Ticket-side box',4:'Default / plant-side box',
  5:'Firebox / rear site',6:'Shadows / under balcony',7:'Sandwich / site-side corner',8:'Stairs / top step',9:'Palace balcony',
  10:'CT rotation / Market side',11:'CT rotation / Ticket approach',12:'Window / back room',13:'Short / Ladder-room approach',
  14:'Top mid / boxes side',15:'Connector / Mid corner',16:'Connector / lower entrance',17:'Jungle / connector-side corner',
  18:'CT spawn / Market connector',19:'CT spawn / Ticket back',20:'B default / rear pillar',21:'B default / front pillar',
  22:'B site / Market-side cover',23:'Bench / back site',24:'Van / raised cover',25:'Get Right / Apartments-side pillar',
  26:'Short / B-entry corner',27:'B Apartments / entry',28:'Short / Mid-side corner',29:'Jungle / Window-side wall',33:'Underpass / lower steps'};
const profiles={
  'a-ramp':['a_ramp','a_palace','ct_push_palace','under_to_jungle'],
  'a-palace':['a_palace','a_ramp','ct_push_palace','under_to_jungle'],
  'mid-short':['mid_to_b','under_to_jungle','a_ramp'],
  'underpass-connector':['under_to_jungle','mid_to_b','a_ramp'],
  'b-apartments':['b_apts','b_retake','mid_to_b'], 'market-b':['b_retake','b_apts','mid_to_b'],
  'short-b':['mid_to_b','b_apts','b_retake'], 'jungle-a':['a_ramp','a_palace','under_to_jungle'],
};
const retakeIds={
  'a-ramp':[2,3,4,5,6,7,8,9,11,17,19,29], 'a-palace':[2,3,4,5,6,7,8,11,17,19,29],
  'mid-short':[8,12,13,14,15,16,17,26,28,29,33], 'underpass-connector':[8,12,13,14,15,16,17,26,28,29],
  'b-apartments':[20,21,22,23,24,25,26,28], 'market-b':[20,21,22,23,24,25,26,27,28],
  'short-b':[20,21,22,23,24,25,26,27,28], 'jungle-a':[2,3,4,5,6,7,8,9,11,17,19,29],
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const vite=await createServer({mode:'test',cacheDir:'node_modules/.vite-mirage-coverage',server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom',logLevel:'error'});
let collision;
try{
  const {NativeMapCollision}=await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {placePrefireTarget}=await vite.ssrLoadModule('/src/range/prefire/placement.ts');
  const {sourcePoint}=await vite.ssrLoadModule('/src/range/prefire/route-helpers.ts');
  const audit=await vite.ssrLoadModule('/src/range/prefire/spawn-audit.ts');
  const base='public/revamp/maps/mirage/',manifest=JSON.parse(fs.readFileSync(base+'collision.json')),bytes=fs.readFileSync(base+'collision.bin');
  if(hash(bytes)!==manifest.collisionSha256)throw Error('Native Mirage collision changed.');
  collision=await NativeMapCollision.create(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  if(process.argv.includes('--add-approaches')){
    const {prepareNativeNavigation,nativeRouteTo}=await vite.ssrLoadModule('/src/range/duel/native-navigation.ts');
    const specs=[
      {id:'short-b',name:'Short to B',region:'B site',enemySide:'ct',phase:'preplant',startLabel:'Catwalk / Short corner',
        spawn:[-750,-402,-168],targets:[[-810,187,-173],[-2384,296,-168]]},
      {id:'jungle-a',name:'Jungle to A retake',region:'A site',enemySide:'t',phase:'postplant',startLabel:'Jungle / Window back room',
        spawn:[-1187.47,-1273.15,-167.97],targets:[[-783.96875,-1668.609741,-175.029556],[-495.810791,-2093.833496,-180.96875],[-253.97,-2134.08,-172.95]]},
    ].filter(spec=>!current.routes.some(route=>route.id===spec.id));
    const floor=point=>{
      const p=sourcePoint(point),s=collision.vertical(p,p.y+24*.0254,p.y-32*.0254,72*.0254);
      if(!s.grounded||!collision.fits(p,s.feet,72*.0254))throw Error(`Unsupported authored approach landmark: ${point}`);
      return [point[0],point[1],s.feet/.0254];
    };
    const arena={...collision.bounds,solids:[],native:collision};
    prepareNativeNavigation(arena,[...current.routes.flatMap(r=>[r.spawn,...r.path]).map(sourcePoint),
      ...specs.flatMap(s=>[s.spawn,...s.targets]).map(p=>sourcePoint(floor(p)))]);
    for(const spec of specs){
      const spawn=floor(spec.spawn),path=[];let from=sourcePoint(spawn);
      for(const goal of spec.targets){
        const to=sourcePoint(floor(goal)),steps=nativeRouteTo(from,to,arena);
        if(!steps.length)throw Error(`No connected native path for ${spec.id}: ${goal}`);
        path.push(...steps.map(p=>[p.x/.0254,-p.z/.0254,p.y/.0254]));from=to;
      }
      current.routes.push({...spec,targets:undefined,spawn,path,look:path[0],angles:[],alternatives:[]});
    }
  }
  const report={mapId:'de_mirage',collisionSha256:manifest.collisionSha256,sourceCommit:practice.commit,retakeCommit:retakes.commit,routes:[]};
  const filter=process.argv.find(arg=>arg.startsWith('--routes='))?.slice(9).split(',');
  for(const route of current.routes.filter(r=>!process.argv.includes('--metadata-only')&&(!filter||filter.includes(r.id)))){
    const existing=[...route.angles,...route.alternatives],proposals=[];
    for(const profile of profiles[route.id])for(const [i,s] of practice.profiles[profile].angles.entries()){
      proposals.push({id:`de_mirage:openprefire/${profile}/${i+1}`,name:`${route.region} / ${profile.replaceAll('_',' ')} ${i+1}`,
        position:s.position,rotation:s.rotation,crouched:s.crouched,moving:!s.crouched,source:{dataset:'openprefire-mirage',profile,index:i+1}});
    }
    for(const index of retakeIds[route.id]){
      const s=retakes.angles[index-1];
      proposals.push({id:`de_mirage:retakes/${index}`,name:names[index],position:s.position,rotation:s.rotation,
        crouched:s.crouched,moving:false,source:{dataset:'retakes-mirage',profile:'mirage',index}});
    }
    const communityNames={1:'Default / Ramp-facing site hold',2:'Market / B window corner',3:'Market / rear room',4:'Market / CT-side door',
      5:'CT rotation / Jungle ramp',6:'Jungle / CT-side slope',7:'Top Mid / side alley',8:'CT spawn / Ticket approach',
      9:'CT spawn / Market rotation',10:'Top Mid / Chair-side approach',11:'Jungle / Window rotation',12:'Apartments / House entrance',
      13:'CT spawn / Jungle turn',14:'Underpass / rear landing',15:'Underpass / Apartments steps',16:'Mid / right-side wall',
      17:'Underpass / stairs corner',18:'Mid / Top Mid wall',19:'Palace / balcony outer ledge',20:'Chair / Mid corner',
      21:'A site / Firebox-side default',22:'Connector / A-side exit',23:'B site / Bench-side hold',24:'Van / rear ledge',
      25:'A default / plant face',26:'A site / central box',27:'B default / Market-facing edge',28:'B default / Short-facing edge',
      29:'B site / centre pillar',30:'Tetris / Ramp-side edge',31:'Shadows / under Palace',32:'Ramp / close site-side corner',
      33:'Bench / back-wall corner',34:'GeT_RiGhT / Van-side pillar',35:'Palace / balcony front lip',36:'A site / close plant cover',
      37:'Short / B archway',38:'Short / Ladder-side corner'};
    const scope=p=>route.region==='A site'?p[1]<-1100&&p[0]>-1450:
      route.region==='B site'?p[0]<-1300&&p[1]>-600:p[0]>-1600&&p[1]>-1300&&p[1]<600;
    for(const s of community.angles.filter(s=>scope(s.position))){
      proposals.push({id:`de_mirage:community-retakes/${s.index}`,name:communityNames[s.index],position:s.position,rotation:s.rotation,
        crouched:s.crouched,moving:false,source:{dataset:'community-retakes-mirage',profile:'mirage-community',index:s.index}});
    }
    const spawn=placePrefireTarget(collision,route.spawn),eyes=[...audit.prefireSpawnEyes(spawn),
      ...[-64,0,64].flatMap(x=>[-64,0,64].flatMap(z=>[46,52,58,64].map(h=>({x:spawn.x+x*.0254,y:spawn.y+h*.0254,z:spawn.z+z*.0254}))))];
    const walks=[false,true].map(crouch=>audit.walkPrefireAuditPath(collision,[route.spawn,...route.path],crouch));
    audit.auditPrefireMotorPath(collision,[route.spawn,...route.path]);
    const added=[],rejected=[];
    for(const angle of proposals){
      if(existing.some(a=>a.id===angle.id))continue;
      // Additional records in the same stance/pocket do not buy extra tickets.
      if([...existing,...added].some(a=>!!a.crouched===!!angle.crouched&&
        Math.hypot(a.position[0]-angle.position[0],a.position[1]-angle.position[1])<48&&Math.abs(a.position[2]-angle.position[2])<24))continue;
      try{
        const feet=placePrefireTarget(collision,angle.position,angle.crouched),body=audit.prefireUpperBodySamples(feet,angle.crouched);
        if(audit.prefireBodyExposed(collision,eyes,[body]))throw Error('Exposed at protected start / 64u margin');
        let standingHead=false;
        for(const [stance,walk] of walks.entries()){
          let distance=0;
          for(const [i,p] of walk.entries()){
            if(i)distance+=Math.hypot(p.x-walk[i-1].x,p.z-walk[i-1].z);
            if(distance<=32*.0254&&audit.prefireBodyExposed(collision,audit.prefireSpawnEyes(p),[audit.prefireUpperBodyExtrema(feet,angle.crouched)]))
              throw Error('Exposed before first 32u of entry');
            if(!stance&&!audit.nativeSightBlocked(collision,{...p,y:p.y+64*.0254},{...feet,y:feet.y+(angle.crouched?46:64)*.0254}))standingHead=true;
            if(!standingHead&&Math.abs(p.y-feet.y)<54*.0254&&Math.hypot(p.x-feet.x,p.z-feet.z)<40*.0254)
              throw Error('Holder blocks route before head visibility');
          }
        }
        if(!standingHead)throw Error('Head not hittable from supported standing path');
        added.push(angle);
      }catch(error){rejected.push({id:angle.id,reason:error.message});}
    }
    if(!route.angles.length){
      const canonical=[];
      for(const angle of added)if(canonical.every(a=>Math.hypot(a.position[0]-angle.position[0],a.position[1]-angle.position[1])>64))canonical.push(angle);
      if(canonical.length<5)throw Error(`Insufficient nonoverlapping holds for new approach ${route.id}`);
      route.angles=canonical.slice(0,5);route.alternatives=added.filter(a=>!route.angles.includes(a));
    }else route.alternatives.push(...added);
    report.routes.push({id:route.id,before:existing.length,added:added.map(a=>({id:a.id,name:a.name,position:a.position})),rejected});
    console.log(JSON.stringify({route:route.id,before:existing.length,added:added.length,rejected:rejected.length}));
  }
  const labels={
    'under_to_jungle/20':'Ticket Booth / raised hold','under_to_jungle/21':'Ticket / site-side corner',
    'under_to_jungle/24':'Triple / front corner','under_to_jungle/25':'Stairs / Jungle raised box',
    'under_to_jungle/26':'Default / rear box','under_to_jungle/28':'Palace / balcony edge',
    'ct_push_palace/1':'Palace / balcony back edge','ct_push_palace/7':'Palace / balcony-side pillar',
    'a_ramp/5':'Stairs / Jungle raised box','a_ramp/8':'Jungle / A-site entrance',
    'a_ramp/9':'Ticket / site back wall','a_ramp/18':'Firebox / Ninja-side corner',
    'a_ramp/12':'Ninja / site box gap','a_ramp/15':'Shadows / under Palace exit',
    'a_ramp/16':'Shadows / Palace-side pillar','a_ramp/21':'Shadows / front edge',
    'a_ramp/28':'Ticket / CT-side close',
    'a_ramp/19':'Jungle / back-room corner','a_ramp/22':'Jungle / close wall','a_ramp/24':'Short / Ladder-room corner',
  };
  const all=[...new Map(current.routes.flatMap(r=>[...r.angles,...r.alternatives]).map(a=>[a.id,a])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const groups=[];
  for(const angle of all){
    let group=groups.find(g=>Math.hypot(g[0].position[0]-angle.position[0],g[0].position[1]-angle.position[1])<32&&Math.abs(g[0].position[2]-angle.position[2])<24);
    if(!group){group=[];groups.push(group);}group.push(angle);
  }
  const families=new Map(groups.filter(g=>g.length>1).flatMap(g=>g.map(a=>[a.id,`de_mirage:overlap/${g[0].id}`])));
  const focus={
    'a-ramp':{name:'A site / boxes, Stairs & Sandwich',ids:['retakes/2','retakes/3','retakes/7','retakes/8','openprefire/under_to_jungle/20']},
    'a-palace':{name:'A site / boxes & Jungle from Palace',ids:['retakes/3','retakes/4','retakes/8','retakes/29','openprefire/ct_push_palace/1']},
    'mid-short':{name:'Mid / Connector & Short',ids:['retakes/13','retakes/14','retakes/15','retakes/16','openprefire/a_ramp/24']},
    'underpass-connector':{name:'Connector / crossfire & Window',ids:['retakes/12','retakes/14','retakes/15','retakes/16','retakes/17']},
  };
  for(const route of current.routes){
    const enrich=a=>({...a,name:labels[`${a.source.profile}/${a.source.index}`]??a.name,
      ...(families.has(a.id)?{exclusionGroup:families.get(a.id)}:{})});
    route.angles=route.angles.map(enrich);route.alternatives=route.alternatives.map(enrich);
    const spec=focus[route.id];
    if(spec){
      const angles=spec.ids.map(id=>[...route.angles,...route.alternatives].find(a=>a.id===`de_mirage:${id}`));
      if(angles.some(a=>!a))throw Error(`Focused lineup includes an unadmitted hold: ${route.id}`);
      route.lineups=[{id:`${route.id}-common-angles`,name:spec.name,angles}];
    }
    if(route.id==='a-ramp'){
      const ids=['openprefire/a_ramp/16','openprefire/a_ramp/12','openprefire/a_ramp/18','openprefire/under_to_jungle/20','retakes/8'];
      const angles=ids.map(id=>[...route.angles,...route.alternatives].find(a=>a.id===`de_mirage:${id}`));
      if(angles.some(a=>!a))throw Error('Deep A clear needs admitted Shadows, Ninja, Firebox, Ticket and Stairs holds');
      route.lineups=[...route.lineups??[],{id:'a-ramp-deep-site',name:'A / Shadows, Ninja & Firebox',angles}];
    }
  }
  fs.mkdirSync('research/mirage',{recursive:true});
  fs.writeFileSync(`research/mirage/coverage-${process.argv.includes('--metadata-only')?'metadata':filter?'approaches':'expansion'}-2026-11-13.json`,JSON.stringify(report,null,2)+'\n');
  if(process.argv.includes('--apply')){
    current.revision='2026-11-13-mirage-pockets-v3';
    fs.writeFileSync(file,JSON.stringify(current,null,2)+'\n');
  }
}finally{collision?.dispose();await vite.close();}
