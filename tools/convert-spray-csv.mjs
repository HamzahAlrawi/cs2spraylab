#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.log(`Usage:
  node tools/convert-spray-csv.mjs measurements/ak47.csv --scale 1

CSV format:
  bullet,x,y
  1,512,380
  2,510,350

x/y are raw wall-impact pixel coordinates from the screenshot/video frame. The tool:
  1. normalizes bullet 1 to (0,0)
  2. converts raw impact offsets into mouse compensation by inverting x/y
  3. prints anchors that can be pasted into src/data/weapons.ts
`);
}

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--'));
const scaleArg = args.find((arg) => arg.startsWith('--scale='));
const scaleIndex = args.indexOf('--scale');
const scale = Number(scaleArg?.split('=')[1] ?? (scaleIndex >= 0 ? args[scaleIndex + 1] : 1));

if (!file || Number.isNaN(scale)) {
  usage();
  process.exit(1);
}

const source = fs.readFileSync(file, 'utf8').trim();
const rows = source.split(/\r?\n/).filter(Boolean);
const header = rows[0].split(',').map((item) => item.trim().toLowerCase());
const bulletIdx = header.indexOf('bullet');
const xIdx = header.indexOf('x');
const yIdx = header.indexOf('y');
if (bulletIdx < 0 || xIdx < 0 || yIdx < 0) {
  throw new Error('CSV must have header: bullet,x,y');
}

const points = rows.slice(1).map((row) => {
  const parts = row.split(',').map((item) => item.trim());
  return {
    bullet: Number(parts[bulletIdx]),
    x: Number(parts[xIdx]),
    y: Number(parts[yIdx])
  };
}).filter((point) => Number.isFinite(point.bullet) && Number.isFinite(point.x) && Number.isFinite(point.y))
  .sort((a, b) => a.bullet - b.bullet);

if (!points.length || points[0].bullet !== 1) {
  throw new Error('CSV must include bullet 1 as the first measured bullet.');
}

const origin = points[0];
const anchors = points.map((point) => {
  const rawImpactX = (point.x - origin.x) * scale;
  const rawImpactY = (point.y - origin.y) * scale;
  return {
    bullet: point.bullet,
    // Compensation is the inverse of raw bullet impact drift.
    x: Math.round(-rawImpactX * 100) / 100,
    y: Math.round(-rawImpactY * 100) / 100
  };
});

console.log(`// ${path.basename(file)} -> paste into src/data/weapons.ts anchors`);
console.log('anchors: [');
for (const anchor of anchors) {
  console.log(`  { bullet: ${anchor.bullet}, x: ${anchor.x}, y: ${anchor.y} },`);
}
console.log(']');
