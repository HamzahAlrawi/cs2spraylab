import fs from 'node:fs';
import {createServer} from 'vite';

const region = process.argv.find(arg => arg.startsWith('--region='))?.slice(9) ?? 'ninja';
const regions = {
  ninja: {x: [220,260,300,340,380,420,460,500,540], y: [2700,2740,2780,2820,2860], z: 95},
  pit: {x: [1320,1400,1480,1560,1640], y: [300,420,540,660], z: -110},
  car: {x: [1660,1700,1740,1780], y: [1720,1800,1880,1960,2040,2120], z: 1},
  cat: {x: [-160,-80,0,80,160,240,320,400], y: [1340,1420,1500,1580,1660], z: 1},
  'cat-approach': {x: [-260,-220,-180,-140,-100,-60,-20,20,60,100,140], y: [400,600,800,1000,1200,1400], z: 8},
  ramp: {x: [1280,1360,1440], y: [2400,2480,2560], z: 50},
  site: {x: [780,900,1020,1140,1220], y: [2520,2600,2680], z: 95},
};
if (!regions[region]) throw new Error('Unknown probe region');
const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {sourcePoint} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  const bytes = fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  collision = await NativeMapCollision.create(JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const rows = [], r = regions[region];
  for (const x of r.x) for (const y of r.y) {
    const p = sourcePoint([x,y,r.z]);
    const floor = collision.vertical(p, p.y + 80 * .0254, p.y - 180 * .0254, 54 * .0254);
    if (floor.grounded) rows.push({position:[x,y,Math.round(floor.feet / .0254 * 1000) / 1000],
      standing:collision.fits(p,floor.feet,72*.0254),crouched:collision.fits(p,floor.feet,54*.0254)});
  }
  console.log(JSON.stringify({region,rows},null,2));
} finally {collision?.dispose(); await vite.close();}
