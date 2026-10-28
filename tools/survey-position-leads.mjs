// Review only: paired kill coordinates do not become spawn points or weights here.
import fs from 'node:fs';
import {createServer} from 'vite';
const report=JSON.parse(fs.readFileSync('research/position-sources/coverage-report.json','utf8'));
const vite=await createServer({server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom',logLevel:'error'});
let collision;
try {
  const {NativeMapCollision}=await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {placePrefireTarget}=await vite.ssrLoadModule('/src/range/prefire/placement.ts');
  const {prefireApproachRoutes}=await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  const {createPrefireBotPlan,prefireRouteViews}=await vite.ssrLoadModule('/src/range/prefire/bot-behavior.ts');
  const manifest=JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json','utf8')),bytes=fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  collision=await NativeMapCollision.create(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const views=prefireApproachRoutes.map(route=>({id:route.id,views:prefireRouteViews([route.spawn,...route.path],collision)}));
  const leads=[];
  for(const lead of report.uncoveredLeads.slice(0,24)) {
    const angle={name:'Source combat-position review',id:lead.sample.killId+':'+lead.sample.role,position:lead.sample.position,moving:true};
    let feet;try{feet=placePrefireTarget(collision,angle.position,false);}catch{continue;}
    const peeks=[];
    for(const route of views){const plan=createPrefireBotPlan(collision,angle,true,route.views);
      if(plan.watchPoint&&plan.exposure&&Math.hypot(plan.exposure.x-feet.x,plan.exposure.z-feet.z)>.35)
        peeks.push({route:route.id,kind:plan.kind,watch:plan.watchPoint,exposure:plan.exposure});
    }
    if(peeks.length)leads.push({...lead,peeks});
  }
  fs.writeFileSync('research/position-sources/native-survey.json',JSON.stringify({collisionSha256:manifest.collisionSha256,source:report.source,leads},null,2));
  console.log(JSON.stringify(leads.map(lead=>({sample:lead.sample,matches:lead.matches,peeks:lead.peeks.map(peek=>peek.route)})),null,2));
}finally{collision?.dispose();await vite.close();}
