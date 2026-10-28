import fs from 'node:fs';
import sharp from 'sharp';
import {createServer} from 'vite';
const vite = await createServer({server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision;
try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {prefireRoutes, sourcePoint} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  const bytes = fs.readFileSync('public/revamp/maps/dust2/collision.bin');
  collision = await NativeMapCollision.create(JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const width = 1024, height = 850, minX = -2300, maxX = 1800, minY = -100, maxY = 3300;
  const raw = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const p = sourcePoint([minX + col / width * (maxX - minX), maxY - row / height * (maxY - minY), 0]);
    const support = collision.vertical(p, 3.7, -4, 72 * .0254), floor = support.feet;
    const fits = support.grounded && collision.fits(p, floor, 72 * .0254);
    const rgb = fits ? [100 + Math.max(0, floor) * 30, 130, 120 - floor * 10] : [35, 36, 39];
    rgb.forEach((v, i) => raw[(row * width + col) * 3 + i] = Math.max(0, Math.min(255, v)));
  }
  const xy = ([x, y]) => [(x - minX) / (maxX - minX) * width, (maxY - y) / (maxY - minY) * height];
  let svg = `<svg width="${width}" height="${height}">`;
  for (let x = -2000; x <= 1500; x += 500) {const [sx] = xy([x, 0]); svg += `<path d="M${sx} 0v${height}" stroke="#ffffff35"/><text x="${sx}" y="20" fill="white" font-size="15">${x}</text>`;}
  for (let y = 0; y <= 3000; y += 500) {const [, sy] = xy([0, y]); svg += `<path d="M0 ${sy}h${width}" stroke="#ffffff35"/><text x="10" y="${sy}" fill="white" font-size="15">${y}</text>`;}
  for (const route of prefireRoutes) {
    const points = [route.spawn, ...route.path].map(xy);
    svg += `<polyline points="${points.map(p => p.join(',')).join(' ')}" fill="none" stroke="#48f8ed" stroke-width="2"/>`;
    for (const angle of route.angles) {const [x, y] = xy(angle.position); svg += `<circle cx="${x}" cy="${y}" r="4" fill="#ff6677"/>`;}
  }
  svg += '</svg>';
  fs.mkdirSync('research/dust2', {recursive: true});
  await sharp(raw, {raw: {width, height, channels: 3}}).composite([{input: Buffer.from(svg)}]).png().toFile('research/dust2/walkability.png');
} finally {collision?.dispose(); await vite.close();}
