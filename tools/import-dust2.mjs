import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';
import crypto from 'node:crypto';
import {extractNativeSurfaces} from './native-surface-metadata.mjs';

const cli = path.resolve(process.env.CS2_MAP_CLI || (fs.existsSync('.local-tools/vrf-dev/Source2Viewer-CLI.exe')
  ? '.local-tools/vrf-dev/Source2Viewer-CLI.exe' : '.local-tools/vrf/Source2Viewer-CLI.exe'));
const exporterVersion = execFileSync(cli, ['--version'], {encoding: 'utf8'}).split(/\r?\n/)[0];
const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const vpk = `${game}/game/csgo/maps/de_dust2.vpk`;
const work = 'research/dust2';
fs.mkdirSync(work, {recursive: true});
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const mapSha256 = sha(fs.readFileSync(vpk)), cacheFile = `${work}/cache.json`;
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const refresh = process.argv.includes('--refresh') || cache.mapSha256 !== mapSha256;
const native = `${work}/world_physics.vmdl_c`;
if (refresh || !fs.existsSync(native)) execFileSync(cli, ['-i', vpk, '-f', 'maps/de_dust2/world_physics.vmdl_c', '-o', native], {stdio: 'ignore'});
const jsonFile = `${work}/physics.json`;
if (refresh || !fs.existsSync(jsonFile)) {
  const dump = execFileSync(cli, ['-i', native, '-b', 'PHYS'], {encoding: 'utf8', maxBuffer: 512e6});
  const text = dump.slice(dump.indexOf('<!-- kv3')).replace(/#\[([\s\S]*?)\]/g, (_, hex) =>
    JSON.stringify(Buffer.from(hex.replace(/\s/g, ''), 'hex').toString('base64')));
  fs.writeFileSync(jsonFile, JSON.stringify(parseKv3(text)));
}
const physics = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
const surfaceSources = {};
for (const [kind, source, output] of [
  ['physics','surfaceproperties/surfaceproperties.vsurf_c',`${work}/surfaces.vsurf`],
  ['game','scripts/surfaceproperties_game.txt',`${work}/surfaceproperties_game.txt`],
]) {
  execFileSync(cli,['-i',`${game}/game/csgo/pak01_dir.vpk`,'-f',source,...(kind === 'physics' ? ['-d'] : []),'-o',output],{stdio:'pipe'});
  const bytes = fs.readFileSync(output);
  surfaceSources[kind] = {source,sha256:sha(bytes),data:parseKv3(bytes.toString('utf8')).SurfacePropertiesList};
}
const surfaces = extractNativeSurfaces(physics.m_surfacePropertyHashes,surfaceSources.physics.data,surfaceSources.game.data);
const out = 'public/revamp/maps/dust2';
fs.mkdirSync(out, {recursive: true});
const unit = .0254;
const convert = (x, y, z) => [x * unit, z * unit, -y * unit];
const groups = new Map();
const groupFor = id => {
  if (!groups.has(id)) groups.set(id, {id, vertices: [], indices: [], primitives: []});
  return groups.get(id);
};
const floats = blob => {
  const b = Buffer.from(blob, 'base64');
  return Array.from({length: b.length / 4}, (_, i) => b.readFloatLE(i * 4));
};
let primitiveId = 0;
for (const part of physics.m_parts) {
  const shape = part.m_rnShape;
  for (const hull of shape.m_hulls) {
    const group = groupFor(hull.m_nCollisionAttributeIndex), data = hull.m_Hull;
    const firstTriangle = group.indices.length / 3;
    const positions = floats(data.m_VertexPositions || data.m_Vertices);
    const base = group.vertices.length / 3;
    for (let i = 0; i < positions.length; i += 3) group.vertices.push(...convert(...positions.slice(i, i + 3)));
    const edges = Buffer.from(data.m_Edges, 'base64'), faces = Buffer.from(data.m_Faces, 'base64');
    for (const start of faces) {
      const face = []; let edge = start;
      do {
        face.push(edges[edge * 4 + 2]); edge = edges[edge * 4];
        if (face.length > edges.length / 4) throw new Error('Invalid native hull edge loop');
      } while (edge !== start);
      for (let i = 1; i + 1 < face.length; i++) group.indices.push(base + face[0], base + face[i], base + face[i + 1]);
    }
    group.primitives.push({id:primitiveId++,firstTriangle,triangleCount:group.indices.length/3-firstTriangle,
      surfaceId:hull.m_nSurfacePropertyIndex,kind:'convex-hull'});
  }
  for (const entry of shape.m_meshes) {
    const group = groupFor(entry.m_nCollisionAttributeIndex), mesh = entry.m_Mesh;
    const firstTriangle = group.indices.length / 3;
    const base = group.vertices.length / 3, positions = floats(mesh.m_Vertices);
    for (let i = 0; i < positions.length; i += 3) group.vertices.push(...convert(...positions.slice(i, i + 3)));
    const triangles = Buffer.from(mesh.m_Triangles, 'base64');
    if (mesh.m_Materials.length && (mesh.m_Materials.length !== triangles.length/12 ||
      mesh.m_Materials.some(id=>!Number.isSafeInteger(id) || !surfaces[id]))) throw new Error('Invalid per-triangle native surface indices');
    for (let i = 0; i < triangles.length; i += 4) group.indices.push(base + triangles.readUInt32LE(i));
    group.primitives.push({id:primitiveId++,firstTriangle,triangleCount:group.indices.length/3-firstTriangle,
      surfaceId:entry.m_nSurfacePropertyIndex,kind:'mesh',
      ...(mesh.m_Materials.length ? {triangleSurfaces:mesh.m_Materials} : {})});
  }
}
const buffers = [], manifestGroups = []; let offset = 0;
for (const group of groups.values()) {
  const attr = physics.m_collisionAttributes[group.id];
  const as = attr.m_InteractAsStrings.map(s => s.toLowerCase());
  const exclude = attr.m_InteractExcludeStrings.map(s => s.toLowerCase());
  const onlyGrenades = as.includes('csgo_grenadeclip'), sky = as.includes('sky');
  const movement = !onlyGrenades && !sky && !exclude.includes('player');
  const shots = !onlyGrenades && !sky && !as.some(s => ['playerclip', 'npcclip', 'passbullets'].includes(s));
  if (!movement && !shots) continue;
  if (group.indices.some(index => index < 0 || index >= group.vertices.length / 3)) throw new Error('Invalid native triangle indices');
  const vertices = new Float32Array(group.vertices), indices = new Uint32Array(group.indices);
  buffers.push(Buffer.from(vertices.buffer), Buffer.from(indices.buffer));
  manifestGroups.push({id: group.id, offset, vertexCount: vertices.length / 3, indexCount: indices.length, movement, shots, tags: as, excludes: exclude, primitives:group.primitives});
  offset += vertices.byteLength + indices.byteLength;
}
const collision = Buffer.concat(buffers);
fs.writeFileSync(`${out}/collision.bin`, collision);
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1];
fs.writeFileSync(`${out}/collision.json`, JSON.stringify({version: 2, build, unit, transform: '[x,z,-y]*0.0254', source: 'maps/de_dust2/world_physics.vmdl_c',
  sourceSha256: sha(fs.readFileSync(native)), mapSha256, collisionSha256: sha(collision), groups: manifestGroups, surfaces,
  surfaceSources:Object.fromEntries(Object.values(surfaceSources).map(s=>[s.source,s.sha256]))}));
console.log('Native collision:', manifestGroups.map(g => `${g.id}: ${g.indexCount / 3} triangles, movement=${g.movement}, shots=${g.shots}`).join('; '));
console.log(`Source surfaces: ${surfaces.filter(s=>s.name).length}/${surfaces.length} resolved by hash; convex hulls are validated at load, meshes remain opaque.`);

if (!process.argv.includes('--collision-only')) {
const rawMap = `${work}/native-current.glb`;
if (refresh || cache.exporterVersion !== exporterVersion || !fs.existsSync(rawMap)) execFileSync(cli, ['-i', vpk, '-f', 'maps/de_dust2.vmap_c', '-d', '--gltf_export_format', 'glb', '--gltf_export_materials', '--gltf_textures_adapt', '--gltf_export_extras', '-o', rawMap], {stdio: 'ignore'});
const {buildDust2Visuals} = await import('./build-dust2-visuals.mjs');
const {importVisibility} = await import('./import-dust2-visibility.mjs');
const visibility = importVisibility(cli, vpk, work, out, refresh);
const visuals = await buildDust2Visuals(rawMap, out, visibility);
const audit = {build, exporterVersion, mapSha256, physicsSha256: sha(fs.readFileSync(native)), collisionSha256: sha(collision),
  collisionBytes: collision.length, ...visuals, transform: '[x,z,-y]*0.0254', groups: manifestGroups};
fs.writeFileSync('docs/dust2-map-inventory.json', JSON.stringify(audit, null, 2) + '\n');
fs.writeFileSync(cacheFile, JSON.stringify({mapSha256, exporterVersion}));
}
