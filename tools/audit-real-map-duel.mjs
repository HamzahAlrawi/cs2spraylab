import fs from 'node:fs';
import {createServer} from 'vite';
import {nativeMapFiles} from './native-map-identity.mjs';
const vite=await createServer({mode:'test',cacheDir:'node_modules/.vite-real-duel-audit',server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
try {
  const {NativeMapCollision}=await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {acquireNativeGrenadeQuery}=await vite.ssrLoadModule('/src/range/prefire/native-grenade-query.ts');
  const {createRealMapArena,realMapChunks}=await vite.ssrLoadModule('/src/range/duel/real-map.ts');
  const {sanitizeDuelConfig}=await vite.ssrLoadModule('/src/range/duel/config.ts');
  const {nativeMaps,defaultNativeMapId}=await vite.ssrLoadModule('/src/range/prefire/maps/index.ts');
  const mapId=process.argv[2]??defaultNativeMapId,definition=nativeMaps.forAuthoring(mapId),files=nativeMapFiles(definition.assetId);
  const sourceCatalog=await nativeMaps.loadCatalogForAuthoring(mapId);
  const roundData=JSON.parse(fs.readFileSync(files.rounds,'utf8'));
  const {exportNativeNavigation,installNativeNavigation,nativeClearSegment,nativeRouteTo}=await vite.ssrLoadModule('/src/range/duel/native-navigation.ts');
  const {DuelSimulation}=await vite.ssrLoadModule('/src/range/duel/simulation.ts');
  const {Group}=await import('three');
  const reports=[];
  for(const chunk of definition.chunks.filter(chunk=>!process.env.CHUNKS || process.env.CHUNKS.split(',').includes(chunk.id))) {
    const base=`${files.out}/duel/${chunk.id}/`,bytes=fs.readFileSync(base+'collision.bin');
    const collision=await NativeMapCollision.create(JSON.parse(fs.readFileSync(base+'collision.json')),
      bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    try {
      if(fs.existsSync(`${files.out}/grenade-collision.json`)){
        const archive=JSON.parse(fs.readFileSync(`${files.out}/grenade-collision.json`)),snapshot=fs.readFileSync(`${files.out}/grenade-query.bin`);
        collision.installGrenadeQuery(await acquireNativeGrenadeQuery(archive,
          snapshot.buffer.slice(snapshot.byteOffset,snapshot.byteOffset+snapshot.byteLength),collision.sourceCollisionSha256));
      }
      const config=sanitizeDuelConfig({mapId,botCount:5,skill:8,health:500,playerHealth:500});
      const bounds={minX:chunk.sourceMin[0]*.0254,maxX:chunk.sourceMax[0]*.0254,minZ:-chunk.sourceMax[1]*.0254,maxZ:-chunk.sourceMin[1]*.0254};
      if(fs.existsSync(base+'navigation.json'))installNativeNavigation({...bounds,native:collision},JSON.parse(fs.readFileSync(base+'navigation.json')));
      const arena=createRealMapArena({collision,scene:new Group()},chunk,config,1,roundData.chunks[chunk.id],sourceCatalog),data=exportNativeNavigation(arena);
      const start={...arena.spawns.player.feet,y:arena.spawns.player.feet.y+1.6256},goal=arena.tactical.searchPoints[0];
      const closest=p=>data.nodes.map((node,id)=>({id,p:node.point,links:node.links.length,d:Math.hypot(node.point.x-p.x,node.point.y-p.y,node.point.z-p.z)}))
        .sort((a,b)=>a.d-b.d).slice(0,12).map(row=>({...row,clear:nativeClearSegment(p,row.p,arena)}));
      const components=[],seen=new Set();
      for(let id=0;id<data.nodes.length;id++){if(seen.has(id))continue;const queue=[id];seen.add(id);
        for(let at=0;at<queue.length;at++)for(const next of data.nodes[queue[at]].links)if(!seen.has(next)){seen.add(next);queue.push(next);}
        components.push(queue.length);}
      const sim=new DuelSimulation(config,1,arena),player=sim.actors[0],watch=arena.lanes[0].watch;
      player.position={...watch};player.feet=watch.y-1.6256;player.health=1e6;
      const initial=sim.actors.slice(1).map(actor=>({...actor.position}));
      sim.start();let fires=0,firstShot=null;
      const began=performance.now();
      for(let tick=0;tick<128*Number(process.env.DUEL_SECONDS??3);tick++) {
        sim.step();
        for(const event of sim.drainEvents())if(event.kind==='fire' && event.actorId>0){fires++;firstShot??=sim.time;}
      }
      reports.push({id:chunk.id,nodes:data.nodes.length,components:components.sort((a,b)=>b-a),start,goal,
        startNear:closest(start),goalNear:closest(goal),route:nativeRouteTo(start,goal,arena).length,
        laneConnections:arena.lanes.map(lane=>nativeRouteTo(lane.anchor,start,arena).length),
        engagement:{fires,firstShot,damage:1e6-player.health,simulationCpuMs:performance.now()-began,
          displacement:sim.actors.slice(1).map((actor,i)=>Math.hypot(actor.position.x-initial[i].x,actor.position.z-initial[i].z))}});
    }finally{collision.dispose();}
  }
  process.stdout.write(JSON.stringify(reports,null,2)+'\n');
}finally{await vite.close();}
