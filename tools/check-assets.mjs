import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {requiredViewActions} from './native-view-clips.mjs';
const knives = JSON.parse(fs.readFileSync('docs/knife-asset-inventory.json', 'utf8')).knives;
const ids = [...Object.keys(JSON.parse(fs.readFileSync('src/range/game-data.json', 'utf8')).weapons),'knife',...Object.keys(knives)];
const inventory = JSON.parse(fs.readFileSync('docs/weapon-animation-inventory.json', 'utf8')).weapons;
const finishes=JSON.parse(fs.readFileSync('src/range/cosmetics-data.json','utf8')).cosmetics;
const finishInventory=JSON.parse(fs.readFileSync('docs/weapon-cosmetics-inventory.json','utf8'));
const legacy=[...new Set(finishes.map(item=>item.assetKey).filter(key=>key?.endsWith('-legacy')))];
const actors=JSON.parse(fs.readFileSync('src/range/actor-cosmetics-data.json','utf8')).cosmetics;
const assets = [...ids, ...[...ids,...legacy].map(id => `view-${id}`), 'target', 'range-kit',...actors.map(item=>item.assetKey)];
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
  if (id.startsWith('view-')) {
    const weapon = id.slice(5), knife = knives[weapon];
    const entry = knife ? {...knife.viewAudit, sha256: knife.exports[id]?.sha256} : inventory[weapon];
    const assembly = j.nodes.find(n => [4,5].includes(n.extras?.assembly_version))?.extras;
    const equipment=weapon.replace(/-legacy$/,'');
    if (!assembly || assembly.native_view_weapon !== equipment || !j.skins?.length ||
      requiredViewActions(equipment).some(name => !j.animations?.some(a => a.name === name))) throw new Error(`Native view animation missing: ${id}`);
    if (!entry || entry.sha256 !== crypto.createHash('sha256').update(b).digest('hex')) throw new Error(`Stale animation audit: ${id}`);
    if (requiredViewActions(equipment).some(name => !entry.clips[name]?.path.startsWith('animation/anims/viewmodel/') ||
      !Number.isFinite(entry.clips[name]?.maxPartMatrixError) || entry.clips[name].maxPartMatrixError > 1e-4)) throw new Error(`Invalid native clip provenance: ${id}`);
  }
  if (id === 'target') {
    const assembly = j.nodes.find(n => n.extras?.assembly_version === 2)?.extras;
    if (!assembly || !assembly.weapon_bind_origin?.some(v => Math.abs(v) > .001)) throw new Error(`Missing weapon bind-origin correction: ${id}`);
    const grips = assembly.grip_surface_distance;
    if (assembly.grip_surface_distance?.length !== 2 || grips.some(v => !Number.isFinite(v) || v > .045)) throw new Error(`Detached weapon grip: ${id}`);
  }
  if (id === 'target' && (!j.skins?.length || !['idle_rifle', 'run_e_rifle', 'run_w_rifle'].every(name => j.animations?.some(a => a.name.includes(name))))) throw new Error('Target rig/locomotion animations missing');
  hashes.add(crypto.createHash('sha256').update(b).digest('hex'));
  const actor=actors.find(item=>item.assetKey===id);
  if(actor && (actor.assetSha256!==crypto.createHash('sha256').update(b).digest('hex') || !j.skins?.length)) throw new Error(`Invalid native actor cosmetic: ${id}`);
  if (ids.includes(id) && !knives[id]) {
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
  const required = ['death_chest_a', 'death_chest_b', 'death_gut_a', 'run_ne_rifle', 'jump_crouch_stand_rifle', 'inair_crouch_stand_rifle',
    'idle_pistol', 'run_ne_pistol', 'crouch_e_pistol', 'jump_crouch_stand_pistol',
    ...['a', 'b', 'c'].flatMap(key => [`death_fall_${key}`, `death_crouch_fall_${key}`])];
  if ((j.meshes?.length ?? 0) !== 0 || required.some(name => !j.animations?.some(clip => clip.name.endsWith(`/${name}`))))
    throw new Error('Duel motion clips are incomplete or contain geometry. Run npm run assets:duel-motion -- --refresh.');
  total += b.length;
  console.log(`duel-motion: ${(b.length / 1e6).toFixed(2)} MB, ${j.animations.length} clips`);
} else console.log('duel-motion: absent; using baseline target clips');
for (const id of [...ids.filter(id => !knives[id]), 'target']) {
  const png = sharp(`public/revamp/models/${id}.png`);
  const meta = await png.metadata(), stats = await png.stats();
  if (!meta.width || meta.width < 128 || !meta.height || meta.height < 128 || !stats.channels.slice(0, 3).some(c => c.stdev > 5)
    || (meta.hasAlpha && stats.channels[stats.channels.length - 1].sum === 0)) throw new Error(`Blank or invalid thumbnail: ${id}`);
}
for (const name of ['wall', 'wall-normal', 'floor', 'floor-normal']) if (!fs.existsSync(`public/revamp/textures/${name}.webp`)) throw new Error(`Missing ${name} texture`);
for(const id of ids.filter(id=>!id.startsWith('knife-'))) {
  const count = finishes.filter(item=>item.equipment===id).length;
  if(id==='zeus') {
    const native = finishInventory.weapons.zeus;
    if(native.nativeAvailable!==7 || count!==native.nativeAvailable) throw new Error('Zeus finish count does not match its seven installed native pairings');
  } else if(count<10) throw new Error(`Fewer than ten finishes: ${id}`);
}
for (const [id, knife] of Object.entries(knives)) {
  if (!finishes.some(item => item.assetKey === id)) throw new Error(`Missing selectable knife: ${id}`);
  if (knife.exports[id]?.sha256 !== crypto.createHash('sha256').update(fs.readFileSync(`public/revamp/models/${id}.glb`)).digest('hex')) throw new Error(`Stale knife world export: ${id}`);
}
for(const item of [...finishes,...actors]) {
  for(const url of [item.imageUrl,item.map].filter(Boolean)) if(!fs.existsSync(`public/revamp${url}`)) throw new Error(`Missing cosmetic image: ${url}`);
  if(item.equipment === 'gloves' && (!item.imageSource?.startsWith('panorama/images/econ/default_generated/') ||
    item.imageSha256 !== crypto.createHash('sha256').update(fs.readFileSync(`public/revamp${item.imageUrl}`)).digest('hex'))) throw new Error(`Stale native glove inventory preview: ${item.id}`);
  if (item.equipment === 'knife' && (!item.imageSource?.startsWith('panorama/images/econ/') ||
    item.imageSha256 !== crypto.createHash('sha256').update(fs.readFileSync(`public/revamp${item.imageUrl}`)).digest('hex'))) throw new Error(`Stale native knife inventory preview: ${item.id}`);
}
if(!fs.existsSync('public/revamp/textures/cosmetics/gloves-standard-preview.webp')) throw new Error('Missing standard glove inventory preview');
const {verifyWeaponFx} = await import('./import-weapon-fx.mjs');
await verifyWeaponFx();
await import('./verify-scale.mjs');
await import('./verify-reload.mjs');
await import('./verify-world-weapons.mjs');
const audioManifest = JSON.parse(fs.readFileSync('public/revamp/audio/events.json', 'utf8'));
const events = audioManifest.events;
const hearingMetadata = JSON.parse(fs.readFileSync('src/range/sound-events-data.json', 'utf8'));
if (hearingMetadata.build !== audioManifest.build) throw new Error('AI hearing metadata targets a different game build');
for (const [id, event] of Object.entries(hearingMetadata.weapons)) {
  const native = events[id];
  if (!native || event.source !== native.source || event.volume !== native.volume ||
    JSON.stringify(event.distanceCurve) !== JSON.stringify(native.distanceCurve))
    throw new Error(`Stale AI hearing metadata: ${id}. Run node tools/import-audio.mjs --metadata-only.`);
}
for (const key of [...ids.filter(id => !id.startsWith('knife-')), 'step-concrete', 'step-wood', 'step-metal', 'land-concrete', 'hit-helmet', 'hurt-armor', 'death']) {
  if (!events[key]?.samples.length || !Number.isFinite(events[key].volume) || !Number.isFinite(events[key].pitch)) throw new Error(`Missing native audio event: ${key}`);
}
for (const id of ids.filter(id => !id.startsWith('knife'))) for (const action of id==='zeus'?['draw']:['draw', 'reload'])
  if (!events[`${id}-${action}`]?.samples.length && !audioManifest.timelines?.[id]?.[action]?.cues?.some(cue=>events[cue.key]?.samples?.length))
    throw new Error(`Missing native ${action} audio: ${id}`);
const samples = [...new Set(Object.values(events).flatMap(event => event.samples))];
for (const url of samples) {
  if (!url.startsWith('/audio/native/') || url.includes('..')) throw new Error(`Invalid audio path: ${url}`);
  const sound = fs.readFileSync(`public/revamp${url}`);
  if (sound.toString('utf8', 0, 4) !== 'RIFF' || sound.toString('utf8', 8, 12) !== 'WAVE') throw new Error(`Invalid native WAV: ${url}`);
  total += sound.length;
}
console.log(`Native audio: ${Object.keys(events).length} events, ${samples.length} unique samples`);
console.log(`Verified all runtime assets. Models and audio: ${(total / 1e6).toFixed(2)} MB`);
