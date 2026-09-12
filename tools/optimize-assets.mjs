import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
const weapons = Object.keys(JSON.parse(fs.readFileSync('src/range/game-data.json', 'utf8')).weapons);
const ids = [...weapons, ...weapons.map(id => `view-${id}`), 'target', 'range-kit'];
fs.mkdirSync('research/blender-exports', { recursive: true });
for (const id of ids) {
  const output = `public/revamp/models/${id}.glb`;
  if (!fs.existsSync(output)) continue;
  const input = `research/blender-exports/${id}.glb`;
  fs.copyFileSync(output, input);
  execFileSync(process.execPath, ['node_modules/@gltf-transform/cli/bin/cli.js', 'optimize', input, output,
    '--compress', 'false', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify-error', '0.0002', '--instance', 'false'], { stdio: 'inherit' });
}
fs.mkdirSync('public/revamp/textures', { recursive: true });
for (const [name, source] of [['wall', 'hr_concrete_wall_001_color'], ['wall-normal', 'hr_concrete_wall_001_normal'], ['floor', 'hr_concrete_floor_001_color'], ['floor-normal', 'hr_concrete_floor_001_normals_normal']]) {
  const input = path.resolve('research', `${source}.png`);
  if (fs.existsSync(input)) await sharp(input).resize(1024, 1024, { fit: 'inside' }).webp({ quality: 85 }).toFile(`public/revamp/textures/${name}.webp`);
}
