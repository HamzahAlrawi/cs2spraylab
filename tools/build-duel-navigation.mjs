import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {Group} from 'three';
import {PAGES_LIMIT, sha256} from './build-duel-map-chunks.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = ['src/range/duel/real-map-catalog.json', 'src/range/duel/real-map.ts',
  'src/range/duel/real-map-rounds.ts', 'src/range/duel/real-map-round-data.json',
  'src/range/duel/native-navigation.ts', 'src/range/actor-collision.ts', 'src/range/actor-physics.ts'];
const sourceHashes = root => Object.fromEntries(sourceFiles.map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]));
const binaryView = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

export function validateNavigation(data, arena) {
  if (data?.version !== 1 || !Array.isArray(data.nodes) || !data.nodes.length || data.nodes.length > 15000) throw new Error('Invalid navigation node count/version');
  let directedLinks = 0, maxLinks = 0;
  for (const node of data.nodes) {
    if (!node?.point || ![node.point.x, node.point.y, node.point.z].every(Number.isFinite) || !Array.isArray(node.links) || node.links.length > 64 ||
        node.links.some(id => !Number.isSafeInteger(id) || id < 0 || id >= data.nodes.length)) throw new Error('Invalid navigation point/link data');
    const margin = 16 * .0254;
    if (node.point.x < arena.minX + margin || node.point.x > arena.maxX - margin ||
        node.point.z < arena.minZ + margin || node.point.z > arena.maxZ - margin) throw new Error('Navigation point lies outside chunk actor bounds');
    maxLinks = Math.max(maxLinks, node.links.length); directedLinks += node.links.length;
  }
  return {nodes: data.nodes.length, directedLinks, maxLinks};
}

function atomicWrite(directory, name, bytes) {
  const target = path.join(directory, name), temporary = target + '.tmp';
  if (path.dirname(path.resolve(target)) !== path.resolve(directory) || bytes.length > PAGES_LIMIT) throw new Error('Invalid navigation output path/size');
  try {fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, target);}
  finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
}

export function metadataBytes(directory, original, navigationBytes, navigationStats, builderHashes) {
  const metadata = {...original, navigationSha256: sha256(navigationBytes),
    navigation: {version: 1, bytes: navigationBytes.length, ...navigationStats, seed: 1, botCount: 5, builderSha256: builderHashes}};
  metadata.hashes = {...metadata.hashes, 'navigation.json': metadata.navigationSha256};
  // Recount rather than incrementing old totals: this must be idempotent and
  // also work immediately after base chunk exports replace chunk.json.
  const baseBytes = fs.readdirSync(directory).filter(name => name !== 'chunk.json' && name !== 'navigation.json')
    .reduce((sum, name) => {
      const stat = fs.statSync(path.join(directory, name));
      if (!stat.isFile() || name.endsWith('.tmp')) throw new Error('Unexpected non-asset chunk output; clean up before baking navigation');
      return sum + stat.size;
    }, 0) + navigationBytes.length;
  metadata.outputBytes = baseBytes;
  for (let previous = -1; previous !== metadata.outputBytes;) {
    previous = metadata.outputBytes; metadata.outputBytes = baseBytes + Buffer.byteLength(JSON.stringify(metadata));
  }
  return Buffer.from(JSON.stringify(metadata));
}

export async function buildDuelNavigation({root = defaultRoot, ids} = {}) {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, sourceFiles[0]))), builderHashes = sourceHashes(root);
  const rounds=JSON.parse(fs.readFileSync(path.join(root,'src/range/duel/real-map-round-data.json')));
  if (catalog.version !== 1 || catalog.map !== 'dust2') throw new Error('Unsupported real-map catalog');
  const chunks = catalog.chunks.filter(chunk => !ids || ids.includes(chunk.id));
  if (!chunks.length || (ids && chunks.length !== ids.length)) throw new Error('Unknown or duplicate chunk ID');
  const outputRoot = path.resolve(root, 'public/revamp/maps/dust2/duel');
  const vite = await createServer({root, server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
  let collision;
  try {
    const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
    const {createRealMapArena, chunkBounds} = await vite.ssrLoadModule('/src/range/duel/real-map.ts');
    const {sanitizeDuelConfig} = await vite.ssrLoadModule('/src/range/duel/config.ts');
    const {exportNativeNavigation, installNativeNavigation} = await vite.ssrLoadModule('/src/range/duel/native-navigation.ts');
    const config = sanitizeDuelConfig({botCount: 5}), pending = [];
    for (const chunk of chunks) {
      if (!/^[a-z0-9-]+$/.test(chunk.id)) throw new Error('Invalid catalog chunk ID');
      const directory = path.resolve(outputRoot, chunk.id);
      if (path.dirname(directory) !== outputRoot) throw new Error('Navigation output must stay inside chunk root');
      const metadataPath = path.join(directory, 'chunk.json'), originalMetadataBytes = fs.readFileSync(metadataPath), original = JSON.parse(originalMetadataBytes);
      if (original.version !== 1 || original.id !== chunk.id || original.map !== catalog.map || original.routeId !== chunk.routeId ||
          JSON.stringify(original.sourceMin) !== JSON.stringify(chunk.sourceMin) || JSON.stringify(original.sourceMax) !== JSON.stringify(chunk.sourceMax)) throw new Error('Chunk metadata/catalog mismatch; rebuild base chunks first');
      const collisionManifestBytes = fs.readFileSync(path.join(directory, 'collision.json')), visualManifestBytes = fs.readFileSync(path.join(directory, 'visual.json'));
      assert.equal(sha256(collisionManifestBytes), original.collisionManifestSha256, 'Collision manifest hash mismatch');
      assert.equal(sha256(visualManifestBytes), original.visualManifestSha256, 'Visual manifest hash mismatch');
      const manifest = JSON.parse(collisionManifestBytes), binary = fs.readFileSync(path.join(directory, 'collision.bin'));
      assert.equal(sha256(binary), manifest.collisionSha256, 'Native collision checksum mismatch');
      assert.equal(manifest.sourceCollisionSha256, original.sourceCollisionSha256, 'Native source collision identity mismatch');
      const started = performance.now();
      collision = await NativeMapCollision.create(manifest, binaryView(binary));
      const mapStub = () => ({scene: new Group(), collision, settle() {throw new Error('Navigation bake unexpectedly requested map.settle');}, dispose() {}});
      const arena = createRealMapArena(mapStub(), chunk, config, 1,rounds.chunks[chunk.id]), data = exportNativeNavigation(arena);
      const stats = validateNavigation(data, arena), bytes = Buffer.from(JSON.stringify(data));
      if (bytes.length > PAGES_LIMIT) throw new Error('Navigation exceeds Pages file limit');
      collision.dispose(); collision = await NativeMapCollision.create(manifest, binaryView(binary));
      // Exercise the same install-before-create lifecycle as the browser, with
      // a fresh collision identity. Native queries from prepare() would prove
      // an expensive graph rebuild, and are forbidden during this roundtrip.
      const installedArena = {...chunkBounds(chunk), solids: [], native: collision}, decoded = JSON.parse(bytes);
      installNativeNavigation(installedArena, decoded);
      const nativeVertical = collision.vertical;
      collision.vertical = function(...args) {
        if (new Error().stack?.includes('prepareNativeNavigation')) throw new Error('Installed graph was regenerated during arena creation');
        return nativeVertical.apply(this, args);
      };
      try {
        for (const seed of [1, 19]) {
          const reused = createRealMapArena(mapStub(), chunk, config, seed,rounds.chunks[chunk.id]);
          assert.deepEqual(exportNativeNavigation(reused), decoded, 'Installed graph changed across arena/seed creation');
        }
      } finally {collision.vertical = nativeVertical;}
      collision.dispose(); collision = undefined;
      pending.push({chunk, directory, originalMetadataBytes, original, bytes, stats});
      console.log(`${chunk.id}: ${stats.nodes} nodes, ${stats.directedLinks} directed links, max ${stats.maxLinks} links/node, ${bytes.length} bytes; fresh-install/no-rebuild roundtrip passed (${((performance.now() - started) / 1000).toFixed(1)}s)`);
    }
    assert.deepEqual(sourceHashes(root), builderHashes, 'Navigation inputs changed during export; rerun after edits finish');
    for (const result of pending) {
      assert.deepEqual(fs.readFileSync(path.join(result.directory, 'chunk.json')), result.originalMetadataBytes, 'Chunk metadata changed during navigation bake');
      assert.equal(sha256(fs.readFileSync(path.join(result.directory, 'collision.json'))), result.original.collisionManifestSha256);
      assert.equal(sha256(fs.readFileSync(path.join(result.directory, 'visual.json'))), result.original.visualManifestSha256);
    }
    for (const {directory, original, bytes, stats} of pending) {
      const metadata = metadataBytes(directory, original, bytes, stats, builderHashes);
      atomicWrite(directory, 'navigation.json', bytes); atomicWrite(directory, 'chunk.json', metadata);
      const actualBytes = fs.readdirSync(directory).reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0);
      assert.equal(JSON.parse(metadata).outputBytes, actualBytes, 'Final chunk byte count mismatch');
    }
    return pending.map(({chunk, bytes, stats}) => ({id: chunk.id, bytes: bytes.length, sha256: sha256(bytes), ...stats}));
  } finally {collision?.dispose(); await vite.close();}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('Usage: node tools/build-duel-navigation.mjs [chunk-id ...]\nRun after tools/build-duel-map-chunks.mjs and after native navigation changes are ready.');
  else {
    const ids = process.argv.slice(2);
    await buildDuelNavigation({ids: ids.length ? ids : undefined});
  }
}
