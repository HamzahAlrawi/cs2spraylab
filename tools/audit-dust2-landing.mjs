import fs from 'node:fs';
import {createServer} from 'vite';

const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {advanceActor, idleInput, STEP, UNIT} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
  const {moveOnTerrain} = await vite.ssrLoadModule('/src/range/actor-collision.ts');
  const manifest = JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json', 'utf8'));
  const bytes = fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  collision = await NativeMapCollision.create(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const world = {solids: [], floor: null, native: collision};
  const cases = []; let starts = 0, skipped = 0;
  for (let x = -788; x <= -148; x += 64) for (let y = 400; y <= 1580; y += 64) {
    if (process.argv.includes('--trace') && (x !== -340 || y !== 1296)) continue;
    let p = {x:x*UNIT,y:0,z:-y*UNIT};
    const floor = collision.vertical(p,128*UNIT,-160*UNIT,72*UNIT);
    p.y = floor.feet;
    if (!floor.grounded || !collision.fits(p,p.y,72*UNIT)) {skipped++; continue;}
    starts++;
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      if (process.argv.includes('--trace') && yaw !== 0) continue;
      let actor = {position: {...p,y:p.y+64*UNIT},velocity:{x:0,z:0},yaw,feet:p.y,
        verticalVelocity:0,eyeHeight:64*UNIT,jumpHeld:false,grounded:true};
      const landings = [], unstable = [];
      for (let tick = 0; tick < 512; tick++) {
        const before = actor;
        actor = advanceActor(actor,{...idleInput(),forward:1},215*UNIT,STEP,undefined,undefined,undefined,world);
        if (process.argv.includes('--trace') && tick >= 52 && tick < 72) {
          const support = collision.vertical(before.position,before.feet,before.feet-1e-7,72*UNIT);
          const moved = moveOnTerrain({...before.position,y:before.feet},{...before.position,y:before.feet,z:before.position.z-215*UNIT*STEP},72*UNIT,world,support.grounded);
          console.log(JSON.stringify({tick,before:{feet:before.feet,grounded:before.grounded,vy:before.verticalVelocity},
            after:{feet:actor.feet,grounded:actor.grounded,vy:actor.verticalVelocity},support,moved}));
        }
        if (!before.grounded && actor.grounded) landings.push({tick,position:[actor.position.x/UNIT,-actor.position.z/UNIT,actor.feet/UNIT],
          impact:before.verticalVelocity/UNIT,delta:(actor.feet-before.feet)/UNIT});
        if (actor.grounded !== before.grounded && unstable.length < 24) unstable.push({tick,grounded:actor.grounded,
          position:[actor.position.x/UNIT,-actor.position.z/UNIT,actor.feet/UNIT],velocityY:actor.verticalVelocity/UNIT});
      }
      if (landings.length > 2) cases.push({start:[x,y,p.y/UNIT],yaw,landings,unstable});
    }
  }
  cases.sort((a,b)=>b.landings.length-a.landings.length);
  const report={build:manifest.build,geometrySha256:manifest.collisionSha256,starts,skipped,cases};
  fs.mkdirSync('research/dust2',{recursive:true});
  fs.writeFileSync('research/dust2/landing-contact-audit.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({starts,skipped,cases:cases.length,worst:cases.slice(0,3).map(c=>({...c,landings:c.landings.slice(0,3),count:c.landings.length,unstable:c.unstable.slice(0,4)}))},null,2));
  if (process.argv.includes('--assert') && (!starts || cases.length)) process.exitCode=1;
} finally {collision?.dispose();await vite.close();}
