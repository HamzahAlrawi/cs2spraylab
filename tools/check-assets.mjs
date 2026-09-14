import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
const ids = [...Object.keys(JSON.parse(fs.readFileSync('src/range/game-data.json', 'utf8')).weapons),'usp','knife'];
const assets = [...ids, ...ids.map(id => `view-${id}`), 'target', 'range-kit'];
let total = 0;
const hashes = new Set();
for (const id of assets) {
  const file = `public/revamp/models/${id}.glb`;
  if (!fs.existsSync(file)) throw new Error(`${file} missing. Run the local asset pipeline first.`);
  const b = fs.readFileSync(file); total += b.length;
  if (b.toString('utf8', 0, 4) !== 'glTF' || b.readUInt32LE(4) !== 2) throw new Error(`Invalid glTF: ${id}`);
  const j = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
  if (!j.meshes?.length || j.nodes.some(n => /Cube/i.test(n.name || ''))) throw new Error(`Unexpected export geometry: ${id}`);
  if (j.images?.some(image => image.uri)) throw new Error(`External texture in ${id}`);
  if (id.startsWith('view-') && !j.meshes.some(n => /firstperson_(default_gloves_arms|sleeves)/i.test(n.name || ''))) throw new Error(`Missing native first-person hands: ${id}`);
  if (id.startsWith('view-') || id === 'target') {
    const assembly = j.nodes.find(n => n.extras?.assembly_version === 2)?.extras;
    if (!assembly || !assembly.weapon_bind_origin?.some(v => Math.abs(v) > .001)) throw new Error(`Missing weapon bind-origin correction: ${id}`);
    const grips = id==='view-knife' ? assembly.grip_surface_distance?.slice(1) : assembly.grip_surface_distance;
    if (assembly.grip_surface_distance?.length !== 2 || grips.some(v => !Number.isFinite(v) || v > .045)) throw new Error(`Detached weapon grip: ${id}`);
  }
  if (id === 'target' && (!j.skins?.length || !['idle_rifle', 'run_e_rifle', 'run_w_rifle'].every(name => j.animations?.some(a => a.name.includes(name))))) throw new Error('Target rig/locomotion animations missing');
  hashes.add(crypto.createHash('sha256').update(b).digest('hex'));
  if (ids.includes(id)) {
    const sound = fs.readFileSync(`public/revamp/audio/${id}.wav`);
    if (sound.toString('utf8', 0, 4) !== 'RIFF' || sound.toString('utf8', 8, 12) !== 'WAVE') throw new Error(`Invalid WAV: ${id}`);
    total += sound.length;
    if (!fs.existsSync(`public/revamp/models/${id}.png`)) throw new Error(`Missing thumbnail: ${id}`);
  }
  console.log(`${id}: ${(b.length / 1e6).toFixed(2)} MB, ${j.meshes.length} meshes, ${j.images?.length || 0} embedded textures`);
}
if (hashes.size !== assets.length) throw new Error('Duplicate asset exports');
for (const id of [...ids, 'target']) {
  const png = sharp(`public/revamp/models/${id}.png`);
  const meta = await png.metadata(), stats = await png.stats();
  if (!meta.width || meta.width < 128 || !meta.height || meta.height < 128 || !stats.channels.slice(0, 3).some(c => c.stdev > 5)
    || (meta.hasAlpha && stats.channels[stats.channels.length - 1].sum === 0)) throw new Error(`Blank or invalid thumbnail: ${id}`);
}
for (const name of ['wall', 'wall-normal', 'floor', 'floor-normal']) if (!fs.existsSync(`public/revamp/textures/${name}.webp`)) throw new Error(`Missing ${name} texture`);
await import('./verify-scale.mjs');
console.log(`Verified all runtime assets. Models and audio: ${(total / 1e6).toFixed(2)} MB`);
