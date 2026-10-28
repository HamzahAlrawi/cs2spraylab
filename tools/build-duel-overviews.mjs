import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {createServer} from 'vite';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const size = 160, unit = .0254;
const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false, watch: null}, appType: 'custom', logLevel: 'error'});
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {chunks} = JSON.parse(fs.readFileSync('src/range/duel/real-map-catalog.json', 'utf8'));
  for (const chunk of chunks) {
    const directory = `public/revamp/maps/dust2/duel/${chunk.id}/`;
    const bytes = fs.readFileSync(directory + 'collision.bin');
    const collision = await NativeMapCollision.create(JSON.parse(fs.readFileSync(directory + 'collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    try {
      const nav = JSON.parse(fs.readFileSync(directory + 'navigation.json', 'utf8'));
      const levels = [...new Set(nav.nodes.map(node => Math.round(node.point.y)))].sort((a, b) => a - b);
      const bounds = {minX: chunk.sourceMin[0]*unit, maxX: chunk.sourceMax[0]*unit,
        minZ: -chunk.sourceMax[1]*unit, maxZ: -chunk.sourceMin[1]*unit};
      const pixels = Buffer.alloc(size * size * levels.length * 4);
      for (let layer = 0; layer < levels.length; layer++) {
        const feet = levels[layer], cells = new Uint8Array(size * size);
        for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
          const point = {x: bounds.minX+(x+.5)/size*(bounds.maxX-bounds.minX), y: feet,
            z: bounds.minZ+(z+.5)/size*(bounds.maxZ-bounds.minZ)};
          const support = collision.vertical(point, feet+.65, feet-3, 72*unit);
          if (support.grounded && collision.fits(point, support.feet, 72*unit)) cells[z*size+x] = 1;
        }
        for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
          const at = z*size+x, edge = !cells[at] && [[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dz]) =>
            x+dx>=0 && x+dx<size && z+dz>=0 && z+dz<size && cells[(z+dz)*size+x+dx]);
          const color = cells[at] ? [83,109,99,255] : edge ? [175,199,188,255] : [21,36,33,255];
          for (let c = 0; c < 4; c++) pixels[(layer*size*size+at)*4+c] = color[c];
        }
      }
      const image = await sharp(pixels, {raw: {width: size, height: size*levels.length, channels: 4}}).png().toBuffer();
      const overview = Buffer.from(JSON.stringify({version: 1, collisionSha256: collision.collisionSha256,
        image: 'radar.png', imageSha256: hash(image), bounds, layers: levels.map((feet, index) =>
          ({feet, x: 0, y: index*size, width: size, height: size}))}));
      fs.writeFileSync(directory+'radar.png', image);fs.writeFileSync(directory+'radar.json', overview);
      const metadata = JSON.parse(fs.readFileSync(directory+'chunk.json', 'utf8'));
      metadata.radar = {file: 'radar.json', sha256: hash(overview)};
      const fixed = fs.readdirSync(directory).filter(name=>name!=='chunk.json').reduce((sum,name)=>sum+fs.statSync(directory+name).size,0);
      metadata.outputBytes = fixed;
      for (let previous = -1; previous !== metadata.outputBytes;) {previous = metadata.outputBytes;metadata.outputBytes = fixed+Buffer.byteLength(JSON.stringify(metadata));}
      fs.writeFileSync(directory+'chunk.json', JSON.stringify(metadata));
      console.log(JSON.stringify({id: chunk.id, levels: levels.length, pngBytes: image.length}));
    } finally {collision.dispose();}
  }
} finally {await vite.close();}
