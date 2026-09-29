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
  const animatedView = j.nodes.some(n => n.extras?.assembly_version === 3 && n.extras?.native_reload);
  if (animatedView && (!j.skins?.length || !['idle', 'reload'].every(name => j.animations?.some(a => a.name === name)))) throw new Error(`Native view animation missing: ${id}`);
  if (!animatedView && (id.startsWith('view-') || id === 'target')) {
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
const motionFile = 'public/revamp/models/duel-motion.glb';
if (fs.existsSync(motionFile)) {
  const b = fs.readFileSync(motionFile);
  if (b.toString('utf8', 0, 4) !== 'glTF' || b.readUInt32LE(4) !== 2) throw new Error('Invalid duel motion glTF');
  const j = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
  const required = ['death_chest_a', 'death_chest_b', 'death_gut_a', 'run_ne_rifle', 'jump_crouch_stand_rifle', 'inair_crouch_stand_rifle'];
  if ((j.meshes?.length ?? 0) !== 0 || required.some(name => !j.animations?.some(clip => clip.name.endsWith(`/${name}`))))
    throw new Error('Duel motion clips are incomplete or contain geometry. Run npm run assets:duel-motion -- --refresh.');
  total += b.length;
  console.log(`duel-motion: ${(b.length / 1e6).toFixed(2)} MB, ${j.animations.length} clips`);
} else console.log('duel-motion: absent; using baseline target clips');
for (const id of [...ids, 'target']) {
  const png = sharp(`public/revamp/models/${id}.png`);
  const meta = await png.metadata(), stats = await png.stats();
  if (!meta.width || meta.width < 128 || !meta.height || meta.height < 128 || !stats.channels.slice(0, 3).some(c => c.stdev > 5)
    || (meta.hasAlpha && stats.channels[stats.channels.length - 1].sum === 0)) throw new Error(`Blank or invalid thumbnail: ${id}`);
}
for (const name of ['wall', 'wall-normal', 'floor', 'floor-normal']) if (!fs.existsSync(`public/revamp/textures/${name}.webp`)) throw new Error(`Missing ${name} texture`);
await import('./verify-scale.mjs');
await import('./verify-reload.mjs');
const events = JSON.parse(fs.readFileSync('public/revamp/audio/events.json', 'utf8')).events;
for (const key of [...ids, 'step-concrete', 'step-wood', 'step-metal', 'land-concrete', 'hit-helmet', 'hurt-armor', 'death']) {
  if (!events[key]?.samples.length || !Number.isFinite(events[key].volume) || !Number.isFinite(events[key].pitch)) throw new Error(`Missing native audio event: ${key}`);
}
const samples = [...new Set(Object.values(events).flatMap(event => event.samples))];
for (const url of samples) {
  if (!url.startsWith('/audio/native/') || url.includes('..')) throw new Error(`Invalid audio path: ${url}`);
  const sound = fs.readFileSync(`public/revamp${url}`);
  if (sound.toString('utf8', 0, 4) !== 'RIFF' || sound.toString('utf8', 8, 12) !== 'WAVE') throw new Error(`Invalid native WAV: ${url}`);
  total += sound.length;
}
console.log(`Native audio: ${Object.keys(events).length} events, ${samples.length} unique samples`);
console.log(`Verified all runtime assets. Models and audio: ${(total / 1e6).toFixed(2)} MB`);
