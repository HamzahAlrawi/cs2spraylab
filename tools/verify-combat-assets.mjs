import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const inventory = JSON.parse(fs.readFileSync('docs/combat-asset-inventory.json', 'utf8'));
const data = JSON.parse(fs.readFileSync('src/range/game-data.json', 'utf8'));
assert.equal(inventory.build, data.build);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const [id, entry] of Object.entries(inventory.weapons)) {
  const bytes = fs.readFileSync(`public/revamp/models/${id}.glb`);
  assert.equal(hash(bytes), entry.worldSha256, `${id}: stale native world asset`);
  assert.equal(bytes.length, entry.worldBytes);
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF'); assert.equal(bytes.readUInt32LE(4), 2);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(gltf.meshes.length, entry.meshes); assert(gltf.meshes.length > 0);
  assert(gltf.meshes.every(mesh => !mesh.name?.includes('body_legacy')));
  assert(gltf.images.every(image => !image.uri), `${id}: external image dependency`);
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    const position = gltf.accessors[primitive.attributes.POSITION];
    assert(position.count > 0 && position.min.every(Number.isFinite) && position.max.every(Number.isFinite));
    assert(position.max.some((value, axis) => value > position.min[axis]));
  }
  if (entry.legacyWorldSha256) {
    const legacyBytes = fs.readFileSync(`public/revamp/models/${id}-legacy.glb`);
    assert.equal(hash(legacyBytes), entry.legacyWorldSha256); assert.equal(legacyBytes.length, entry.legacyWorldBytes);
    const legacy = JSON.parse(legacyBytes.toString('utf8', 20, 20 + legacyBytes.readUInt32LE(12)));
    assert(legacy.meshes.length > 0 && legacy.meshes.every(mesh => mesh.name?.includes('body_legacy')));
    assert(legacy.images.every(image => !image.uri));
  }
  const png = fs.readFileSync(`public/revamp/models/${id}.png`);
  assert.equal(hash(png), entry.previewSha256);
  const metadata = await sharp(png).metadata(), stats = await sharp(png).stats();
  assert.equal(metadata.width, 480); assert.equal(metadata.height, 240); assert(metadata.hasAlpha);
  assert(stats.channels.slice(0, 3).some(channel => channel.stdev > 5));
  assert(stats.channels[3].sum > 0);
  console.log(`${id}: native HD geometry, embedded textures, nonblank preview and SHA256 verified`);
}
