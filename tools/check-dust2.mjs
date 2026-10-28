import fs from 'node:fs';
import crypto from 'node:crypto';
const base = 'public/revamp/maps/dust2', sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const collision = JSON.parse(fs.readFileSync(`${base}/collision.json`, 'utf8'));
const visuals = JSON.parse(fs.readFileSync(`${base}/visual.json`, 'utf8'));
const audit = JSON.parse(fs.readFileSync('docs/dust2-map-inventory.json', 'utf8'));
if (collision.unit !== .0254 || collision.transform !== '[x,z,-y]*0.0254' || collision.version !== 1 ||
  sha(fs.readFileSync(`${base}/collision.bin`)) !== collision.collisionSha256 || collision.collisionSha256 !== audit.collisionSha256)
  throw new Error('Dust 2 native collision audit mismatch');
if (visuals.version !== 2 || JSON.stringify(visuals.files) !== JSON.stringify(audit.visualFiles)) throw new Error('Dust 2 visual manifest mismatch');
let bytes = 0;
for (const [i, filename] of visuals.files.entries()) {
  if (!/^visual-\d+\.gltf$/.test(filename)) throw new Error('Invalid map asset filename');
  const buffer = fs.readFileSync(`${base}/${filename}`);
  if (buffer.length > 25 * 1024 * 1024 || sha(buffer) !== audit.visualSha256[i])
    throw new Error(`Invalid or stale Dust 2 visual asset: ${filename}`);
  const gltf = JSON.parse(buffer.toString('utf8'));
  if (!gltf.meshes?.length || !gltf.extensionsRequired?.includes('EXT_meshopt_compression') ||
    gltf.materials?.some(m => !m.extras?.nativeDust2 || /materials\/tools\//.test(m.extras.nativeMaterial))) throw new Error(`Missing native texture/compression metadata: ${filename}`);
  for (const resource of [...gltf.buffers ?? [], ...gltf.images ?? []]) {
    if (!resource.uri && resource.extensions?.EXT_meshopt_compression?.fallback) continue;
    if (resource.uri?.startsWith('data:')) continue;
    if (!visuals.resources.some(r => r.name === resource.uri)) throw new Error(`Unlisted map resource ${resource.uri}`);
  }
  bytes += buffer.length;
}
for (const resource of visuals.resources) {
  if (!/^(visual-\d+(?:_\d+)?\.bin|texture-[a-f0-9]{24}\.webp)$/.test(resource.name)) throw new Error(`Invalid map resource name ${resource.name}`);
  const buffer = fs.readFileSync(`${base}/${resource.name}`);
  if (buffer.length !== resource.bytes || buffer.length > 25 * 1024 * 1024 || sha(buffer) !== resource.sha256) throw new Error(`Stale map resource ${resource.name}`);
  bytes += buffer.length;
}
if (bytes !== visuals.bytes || bytes !== audit.visualBytes) throw new Error('Dust 2 byte-count mismatch');
console.log(`Dust 2 build ${collision.build}: ${collision.groups.reduce((sum, g) => sum + g.indexCount / 3, 0)} native collision triangles; ${(bytes / 1e6).toFixed(2)} MB compressed visuals in ${visuals.files.length} Pages-safe files.`);
