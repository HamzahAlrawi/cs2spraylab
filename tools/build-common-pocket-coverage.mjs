import fs from 'node:fs';
import {createServer} from 'vite';
const plan=JSON.parse(fs.readFileSync('docs/common-angle-pockets.json'));
const vite=await createServer({mode:'test',cacheDir:'node_modules/.vite-pocket-review',server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom',logLevel:'error'});
try{
  const {prefireCandidates}=await vite.ssrLoadModule('/src/range/prefire/occupancy.ts');
  const {nativeMaps}=await vite.ssrLoadModule('/src/range/prefire/maps/index.ts');
  const catalogs=[];
  for(const id of Object.keys(plan.maps))catalogs.push(await nativeMaps.loadCatalogForAuthoring(id));
  const gaps=[],output={schemaVersion:1,method:'Authored named-pocket training coverage, not occupancy or encounter rates.',maps:{},gaps};
  for(const catalog of catalogs){
    const routes={};
    for(const pocket of plan.maps[catalog.id]){
      const [x0,y0,z0,x1,y1,z1]=pocket.bounds;
      for(const id of pocket.routes){
        const route=catalog.routes.find(r=>r.id===id);if(!route)throw Error(`Unknown ${catalog.id}/${id}`);
        const angles=prefireCandidates(route).filter(a=>{const [x,y,z]=a.position;return (!pocket.angleIds||pocket.angleIds.includes(a.id))&&x>=x0&&x<=x1&&y>=y0&&y<=y1&&z>=z0&&z<=z1;});
        if(!angles.length){gaps.push({map:catalog.id,route:id,pocket:pocket.id,name:pocket.name});continue;}
        (routes[id]??=[]).push({id:pocket.id,name:pocket.name,angleIds:angles.map(a=>a.id)});
      }
    }
    output.maps[catalog.id]=routes;
  }
  fs.writeFileSync('research/common-pocket-coverage-gaps.json',JSON.stringify(gaps,null,2)+'\n');
  if(process.argv.includes('--apply'))fs.writeFileSync('src/range/prefire/data/common-pocket-coverage.json',JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({groups:Object.fromEntries(Object.entries(output.maps).map(([id,routes])=>[id,Object.values(routes).reduce((n,g)=>n+g.length,0)])),gaps},null,2));
}finally{await vite.close();}
