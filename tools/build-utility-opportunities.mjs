import fs from 'node:fs';
import {createServer} from 'vite';
import rounds from '../src/range/duel/real-map-round-data.json' with {type:'json'};
import catalog from '../src/range/duel/real-map-catalog.json' with {type:'json'};

const vite = await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {UtilitySimulation,UTILITY_KERNEL_VERSION} = await vite.ssrLoadModule('/src/range/duel/utilities.ts');
  const {solveUtilityThrow} = await vite.ssrLoadModule('/src/range/duel/utility-ballistics.ts');
  const entries = [], reports = [];
  for (const chunk of catalog.chunks) {
    const base = `public/revamp/maps/dust2/duel/${chunk.id}/`, buffer = fs.readFileSync(base+'collision.bin');
    const collision = await NativeMapCollision.create(JSON.parse(fs.readFileSync(base+'collision.json')),
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset+buffer.byteLength));
    const arena = {...collision.bounds, native:collision, solids:[]};
    let attempts = 0, count = 0;
    try {
      for (const course of rounds.chunks[chunk.id].courses) {
        for (const hold of course.holds) {
          if (count >= 16) break;
          const feet = hold.lane.anchor, eye = {...feet,y:feet.y+1.6256};
          const watch = hold.lane.watch;
          if (!watch || Math.hypot(watch.x-feet.x,watch.z-feet.z) < 5) continue;
          for (const kind of ['flash','he','smoke','molotov']) {
            if (entries.some(e=>e.collisionSha256===collision.collisionSha256&&e.kind===kind&&Math.hypot(e.feet.x-feet.x,e.feet.z-feet.z)<1)) continue;
            const target = {...watch,y:watch.y-(kind==='flash'?.4:1.55)};
            for (const high of [false,true]) {
              attempts++;
              const shot = solveUtilityThrow(eye,target,arena,high); if (!shot) continue;
              const simulation = new UtilitySimulation(1);
              simulation.throw({actorId:1,side:'enemy',kind,origin:shot.origin,direction:shot.direction,strength:1,time:0});
              let detonation;
              for (let tick=1;tick<=768&&!detonation;tick++) {
                const events=simulation.advance(1/128,tick/128,arena,[]);
                detonation=events.find(event=>event.type==='detonate');
              }
              if (!detonation || Math.hypot(detonation.position.x-target.x,detonation.position.z-target.z)>2 ||
                Math.abs(detonation.position.y-target.y)>(kind==='flash'?3:1.5) || kind==='molotov'&&!simulation.effects.some(e=>e.type==='fire')) continue;
              entries.push({id:`${chunk.id}:${count++}:${kind}`,map:'dust2',chunk:chunk.id,course:course.id,
                name:`${hold.angle.name}: ${kind} toward ${course.name}`,kind,feet,eye,target,
                yaw:shot.yaw,pitch:shot.pitch,landing:detonation.position,flightSeconds:detonation.time,
                collisionSha256:collision.collisionSha256,tolerance:.35});
              break;
            }
          }
        }
      }
      reports.push({chunk:chunk.id,count,attempts});
    } finally {collision.dispose();}
  }
  fs.writeFileSync('src/range/duel/utility-opportunities.json',JSON.stringify({version:2,kernelVersion:UTILITY_KERNEL_VERSION,
    source:'Independently authored from native Dust 2 training approaches; trajectories tested with installed chunk collision and trainer launch kernel. Not copied upstream lineup data or native-engine certification.',entries},null,2)+'\n');
  console.log(JSON.stringify(reports));
  if (entries.length < 8) throw new Error('Insufficient validated utility setups');
} finally {await vite.close();}
