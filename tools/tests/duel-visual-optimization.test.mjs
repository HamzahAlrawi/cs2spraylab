import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Document, Format} from '@gltf-transform/core';
import {MeshoptEncoder, MeshoptDecoder} from 'meshoptimizer';
import {Matrix3, Matrix4, Vector3} from 'three';
import sharp from 'sharp';
import {boundTextures, buildTexturePack, canonicalMaterials, inspectVisuals, normalizeRepeatedUVs, optimizeDocument, optimizeDuelVisuals, optimizedMetadata,
  packDuelTextures, spatialBatch, stabilizeCollapsedNodes, textureBounds, visualPolicy} from '../optimize-duel-visuals.mjs';
import {createMapIO, sha256} from '../build-duel-map-chunks.mjs';

async function fixture({alpha = 'OPAQUE', duplicate = false, separated = false} = {}) {
  const document = new Document(), scene = document.createScene(), buffer = document.createBuffer();
  const colorBytes = await sharp({create: {width: 64, height: 32, channels: 4, background: {r: 180, g: 120, b: 80, alpha: 1}}}).webp({lossless: true}).toBuffer();
  const dataBytes = await sharp({create: {width: 8, height: 8, channels: 4, background: {r: 127, g: 128, b: 255, alpha: 1}}}).webp({lossless: true}).toBuffer();
  const texture = (name, bytes) => document.createTexture(name).setImage(bytes).setMimeType('image/webp').setURI(`texture-${sha256(bytes).slice(0, 24)}.webp`);
  const color = texture('albedo', colorBytes), data = texture('normal-data', dataBytes);
  const material = document.createMaterial('native-brick').setBaseColorTexture(color).setNormalTexture(data).setMetallicRoughnessTexture(data).setOcclusionTexture(data)
    .setMetallicFactor(.2).setRoughnessFactor(.6).setAlphaMode(alpha).setExtras({nativeDust2: true, nativeMaterial: 'brick.vmat', nativeOverlay: false});
  material.getOcclusionTextureInfo().setTexCoord(1);
  const accessor = (type, values, normalized = false) => document.createAccessor().setType(type).setArray(values).setNormalized(normalized).setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute('POSITION', accessor('VEC3', new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])))
    .setAttribute('NORMAL', accessor('VEC3', new Int16Array([0, 0, 32767, 0, 0, 32767, 0, 0, 32767]), true))
    .setAttribute('TANGENT', accessor('VEC4', new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1])))
    .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array([0, 0, 2, 0, 0, 2])))
    .setAttribute('TEXCOORD_1', accessor('VEC2', new Float32Array([.1, .1, .9, .1, .1, .9])))
    .setAttribute('COLOR_0', accessor('VEC4', new Uint8Array([255, 128, 64, 255, 255, 128, 64, 255, 255, 128, 64, 255]), true))
    .setIndices(accessor('SCALAR', new Uint16Array([0, 1, 2]))).setMaterial(material).setExtras({surface: 12});
  const mesh = document.createMesh('test-mesh').addPrimitive(primitive), node = document.createNode('first').setMesh(mesh).setExtras({sector: '0:0', nativeClusters: [3]});
  scene.addChild(node);
  if (duplicate) scene.addChild(document.createNode('second').setMesh(mesh).setTranslation([separated ? 100 : 2, 0, 0]).setExtras({sector: '0:0', nativeClusters: [4]}));
  return {document, scene, node, material, primitive, color, data, colorBytes, dataBytes};
}

test('texture policy bounds ordinary colors/foliage but retains actual native text/sign clarity and data maps', async () => {
  const f = await fixture();
  let limits = textureBounds(f.document);
  assert.equal(limits.get(f.color), 512); assert.equal(limits.get(f.data), 256);
  f.material.setName('directional_sign'); limits = textureBounds(f.document); assert.equal(limits.get(f.color), 1024);
  f.material.setName('brick').setAlphaMode('MASK'); assert.equal(textureBounds(f.document).get(f.color), 512);
  f.material.setAlphaMode('OPAQUE').setExtras({nativeOverlay: true}); assert.equal(textureBounds(f.document).get(f.color), 512);
  f.material.setName('decal_letter_01'); assert.equal(textureBounds(f.document).get(f.color), 1024);
});

test('resizing preserves aspect ratio and does not recompress already-bounded PBR maps', async () => {
  const f = await fixture();
  await boundTextures(f.document, {...visualPolicy, colorSize: 16, criticalColorSize: 32, dataSize: 8});
  const metadata = await sharp(f.color.getImage()).metadata(); assert.equal(metadata.width, 16); assert.equal(metadata.height, 8);
  assert.deepEqual(Buffer.from(f.data.getImage()), f.dataBytes);
  assert.equal(f.color.getURI(), `texture-${sha256(f.color.getImage()).slice(0, 24)}.webp`);
  const critical = await fixture(); critical.material.setName('sign');
  await boundTextures(critical.document, {...visualPolicy, colorSize: 16, criticalColorSize: 64});
  assert.deepEqual(Buffer.from(critical.color.getImage()), critical.colorBytes);
});

test('material consolidation preserves sampler, UV channel, alpha, roughness and overlay distinctions', async () => {
  const f = await fixture(), duplicate = f.material.clone().setName('another-name').setExtras({nativeDust2: true, nativeMaterial: 'other.vmat', nativeOverlay: false});
  const overlay = f.material.clone().setExtras({...f.material.getExtras(), nativeOverlay: true});
  const rough = f.material.clone().setRoughnessFactor(.9), transparent = f.material.clone().setAlphaMode('BLEND');
  const uv = f.material.clone(); uv.getBaseColorTextureInfo().setTexCoord(1);
  const sampler = f.material.clone(); sampler.getBaseColorTextureInfo().setWrapS(33071);
  const result = canonicalMaterials(f.document);
  assert.equal(result.mapping.get(f.material), result.mapping.get(duplicate));
  for (const material of [overlay, rough, transparent, uv, sampler]) assert.notEqual(result.mapping.get(material), result.mapping.get(f.material));
  assert.deepEqual(result.canonical[result.mapping.get(f.material)].getExtras().nativeMaterials, ['brick.vmat', 'other.vmat']);
});

test('batching retains every triangle, spatial culling cells, source UVs/colors and material metadata', async () => {
  const f = await fixture({duplicate: true}), batched = spatialBatch(f.document), stats = await inspectVisuals(batched.document);
  assert.equal(stats.triangles, 2); assert.equal(stats.primitives, 1);
  const output = batched.document.getRoot().listScenes()[0].listChildren()[0], primitive = output.getMesh().listPrimitives()[0];
  assert.deepEqual(output.getExtras().nativeClusters, [3, 4]); assert.deepEqual(output.getExtras().nativeSourceNodes, ['first', 'second']);
  assert.deepEqual([...primitive.getAttribute('TEXCOORD_0').getArray()], [0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0, 2]);
  assert.equal(primitive.getAttribute('COLOR_0').getArray()[1], Math.fround(128 / 255));
  assert.deepEqual(primitive.getExtras(), {surface: 12}); assert.equal(primitive.getMaterial().getRoughnessFactor(), .6);
  const separated = await fixture({duplicate: true, separated: true});
  assert.equal((await inspectVisuals(spatialBatch(separated.document).document)).primitives, 2);
});

test('transparent and decal nodes retain separate sorting surfaces', async () => {
  const f = await fixture({alpha: 'BLEND', duplicate: true}); f.material.setExtras({...f.material.getExtras(), nativeOverlay: true});
  const output = spatialBatch(f.document).document, stats = await inspectVisuals(output);
  assert.equal(stats.primitives, 2); assert.equal(stats.triangles, 2);
  for (const node of output.getRoot().listNodes()) assert.equal(node.getMesh().listPrimitives()[0].getMaterial().getExtras().nativeOverlay, true);
});

test('native zero-scale degenerate batches stay at their exact collapsed translation without NaN rotations', async () => {
  const f = await fixture(); f.node.setScale([0, 0, 0]).setTranslation([12, 3, -20]).setRotation([NaN, NaN, NaN, NaN]);
  stabilizeCollapsedNodes(f.document); const stats = await inspectVisuals(f.document);
  assert.deepEqual(stats.bounds, {min: [12, 3, -20], max: [12, 3, -20]}); assert.equal(stats.triangles, 1);
});

test('only unreferenced UV channels are removed; material UV sets and transforms remain intact', async () => {
  const f = await fixture(); f.material.getOcclusionTextureInfo().setTexCoord(0);
  const primitive = spatialBatch(f.document).document.getRoot().listMeshes()[0].listPrimitives()[0];
  assert.ok(primitive.getAttribute('TEXCOORD_0')); assert.equal(primitive.getAttribute('TEXCOORD_1'), null);
  const referenced = await fixture();
  assert.ok(spatialBatch(referenced.document).document.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('TEXCOORD_1'));
});

test('world-transform baking handles inherited/nonuniform/negative scale, normals, tangents and winding', async () => {
  const f = await fixture(), parent = f.document.createNode('parent').setTranslation([12, 3, -20]).setScale([-2, 3, 1]);
  f.scene.removeChild(f.node); f.scene.addChild(parent); parent.addChild(f.node); f.node.setTranslation([.25, .5, -.25]);
  const matrix = new Matrix4().fromArray(f.node.getWorldMatrix()), expected = new Vector3(1, 0, 0).applyMatrix4(matrix);
  const output = spatialBatch(f.document).document, primitive = output.getRoot().listMeshes()[0].listPrimitives()[0], positions = primitive.getAttribute('POSITION');
  assert.ok(Array.from({length: positions.getCount()}, (_, i) => new Vector3().fromArray(positions.getElement(i, []))).some(p => p.distanceTo(expected) < 1e-5));
  const normal = new Vector3(0, 0, 1).applyMatrix3(new Matrix3().getNormalMatrix(matrix)).normalize();
  assert.ok(new Vector3().fromArray(primitive.getAttribute('NORMAL').getElement(0, [])).distanceTo(normal) < 1e-6);
  assert.deepEqual(primitive.getAttribute('TANGENT').getElement(0, []), [-1, 0, 0, -1]);
  const indices = primitive.getIndices(), a = new Vector3().fromArray(positions.getElement(indices.getScalar(0), [])), b = new Vector3().fromArray(positions.getElement(indices.getScalar(1), [])), c = new Vector3().fromArray(positions.getElement(indices.getScalar(2), []));
  assert.ok(new Vector3().crossVectors(b.sub(a), c.sub(a)).dot(normal) > 0);
});

test('repeating UV normalization preserves actual sampled coordinates and skips unsafe rotated/large ranges', async () => {
  const f = await fixture(), material = f.material;
  const originalUVs = [...f.primitive.getAttribute('TEXCOORD_0').getArray()];
  const result = normalizeRepeatedUVs(f.document);
  assert.equal(result.normalizedChannels, 1);
  for (const slot of ['BaseColor', 'Normal', 'MetallicRoughness']) {
    const info = material[`get${slot}TextureInfo`](), transform = info.getExtension('KHR_texture_transform'), offset = transform.getOffset(), scale = transform.getScale();
    const values = f.primitive.getAttribute('TEXCOORD_0').getArray();
    for (let i = 0; i < values.length; i++) assert.ok(Math.abs(values[i] * scale[i % 2] + offset[i % 2] - originalUVs[i]) < 1e-6);
  }
  const rotated = await fixture(), extension = rotated.document.createExtension((await import('@gltf-transform/extensions')).KHRTextureTransform);
  rotated.material.getBaseColorTextureInfo().setExtension('KHR_texture_transform', extension.createTransform().setRotation(.2));
  assert.equal(normalizeRepeatedUVs(rotated.document).skippedRotated, 1);
  const huge = await fixture(); huge.primitive.getAttribute('TEXCOORD_0').getArray()[2] = 1000;
  assert.equal(normalizeRepeatedUVs(huge.document).skippedLarge, 1);
});

test('texture packs are aligned, deterministic and checksum every image slice, without changing image inventory', () => {
  const data = [Buffer.from('first-image'), Buffer.from('other-image-data')], names = data.map(bytes => `texture-${sha256(bytes).slice(0, 24)}.webp`);
  const resources = data.map((bytes, i) => ({name: names[i], bytes: bytes.length, sha256: sha256(bytes)})), visual = {resources};
  const first = buildTexturePack(visual, name => data[names.indexOf(name)]), second = buildTexturePack(visual, name => data[names.indexOf(name)]);
  assert.deepEqual(first, second); assert.equal(first.manifest.sha256, sha256(first.binary)); assert.equal(first.manifest.name, 'textures.bin');
  for (const image of first.manifest.images) {assert.equal(image.offset % 4, 0); assert.deepEqual(first.binary.subarray(image.offset, image.offset + image.length), data[names.indexOf(image.name)]);}
  assert.deepEqual(visual, {resources});
  assert.throws(() => buildTexturePack(visual, () => Buffer.from('wrong')), /integrity mismatch/);
});

test('meshopt output is deterministic, keeps geometry/surface distinctions and retains all PBR resources', async () => {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const policy = {...visualPolicy, colorSize: 16, criticalColorSize: 32, dataSize: 8}, a = await fixture({duplicate: true}), b = await fixture({duplicate: true});
  const x = await optimizeDocument(a.document, policy), y = await optimizeDocument(b.document, policy);
  assert.equal(x.before.triangles, x.after.triangles); assert.equal(x.after.primitives, 1); assert.ok(x.after.decodedRGBABytes < x.before.decodedRGBABytes);
  assert.deepEqual([...x.files.keys()], [...y.files.keys()]);
  for (const [name, bytes] of x.files) assert.deepEqual(bytes, y.files.get(name), name);
  const json = JSON.parse(x.files.get('visual-0.gltf')); assert.ok(json.extensionsRequired.includes('EXT_meshopt_compression'));
  const decoded = await createMapIO().readJSON({json, resources: Object.fromEntries([...x.files].filter(([name]) => name !== 'visual-0.gltf' && name !== 'visual.json'))});
  assert.equal((await inspectVisuals(decoded)).triangles, 2);
  const material = decoded.getRoot().listMaterials()[0];
  assert.equal(material.getMetallicFactor(), .2); assert.equal(material.getRoughnessFactor(), .6);
  for (const slot of ['BaseColor', 'Normal', 'MetallicRoughness', 'Occlusion']) assert.ok(material[`get${slot}Texture`]());
  assert.equal(x.visual.textureBase, '/maps/dust2/duel/shared/');
});

test('metadata updates preserve collision/navigation identities and count exact output bytes', async () => {
  const f = await fixture(), result = await optimizeDocument(f.document), protectedAssets = new Map([['collision.json', Buffer.from('collision')], ['collision.bin', Buffer.from([1, 2, 3])], ['navigation.json', Buffer.from('navigation')]]);
  const original = {id: 'fixture', navigationSha256: sha256(protectedAssets.get('navigation.json')), collisionManifestSha256: sha256(protectedAssets.get('collision.json')), hashes: {'navigation.json': 'original'}, visual: {sourceTriangles: 999}};
  const bytes = optimizedMetadata(original, result.files, protectedAssets, result, 'input', 'tool'), metadata = JSON.parse(bytes);
  assert.equal(metadata.navigationSha256, original.navigationSha256); assert.equal(metadata.collisionManifestSha256, original.collisionManifestSha256);
  assert.equal(metadata.hashes['navigation.json'], 'original'); assert.equal(metadata.visual.sourceTriangles, 999);
  assert.equal(metadata.outputBytes, bytes.length + [...result.files.values(), ...protectedAssets.values()].reduce((sum, bytes) => sum + bytes.length, 0));
  assert.deepEqual(optimizedMetadata(original, result.files, protectedAssets, result, 'input', 'tool'), bytes);
});

test('publication writes shared/local-identical images, protects gameplay assets and repeated application is a no-op', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spraylab-opt-test-'));
  try {
    const directory = path.join(root, 'public/revamp/maps/dust2/duel/fixture'), catalogDirectory = path.join(root, 'src/range/duel');
    fs.mkdirSync(directory, {recursive: true}); fs.mkdirSync(catalogDirectory, {recursive: true});
    fs.writeFileSync(path.join(catalogDirectory, 'real-map-catalog.json'), JSON.stringify({version: 1, map: 'dust2', chunks: [{id: 'fixture'}]}));
    const f = await fixture({duplicate: true}); f.document.getRoot().listBuffers()[0].setURI('visual-0.bin');
    const encoded = await createMapIO().writeJSON(f.document, {format: Format.GLTF, basename: 'visual-0'}), primary = Buffer.from(JSON.stringify(encoded.json));
    fs.writeFileSync(path.join(directory, 'visual-0.gltf'), primary);
    for (const [name, bytes] of Object.entries(encoded.resources)) fs.writeFileSync(path.join(directory, name), bytes);
    const resources = Object.entries(encoded.resources).map(([name, bytes]) => ({name, bytes: bytes.length, sha256: sha256(bytes)}));
    const visual = Buffer.from(JSON.stringify({version: 2, files: ['visual-0.gltf'], fileHashes: {'visual-0.gltf': sha256(primary)}, resources, bytes: primary.length + resources.reduce((sum, r) => sum + r.bytes, 0)}));
    fs.writeFileSync(path.join(directory, 'visual.json'), visual);
    const protectedAssets = new Map([['collision.json', Buffer.from('collision')], ['collision.bin', Buffer.from([1, 2, 3])], ['navigation.json', Buffer.from('navigation')]]);
    for (const [name, bytes] of protectedAssets) fs.writeFileSync(path.join(directory, name), bytes);
    fs.writeFileSync(path.join(directory, 'chunk.json'), JSON.stringify({id: 'fixture', collisionManifestSha256: sha256(protectedAssets.get('collision.json')), navigationSha256: sha256(protectedAssets.get('navigation.json')), visualManifestSha256: sha256(visual), hashes: {}, visual: {}}));
    await optimizeDuelVisuals({root, apply: true});
    const first = fs.readFileSync(path.join(directory, 'chunk.json'));
    const second = await optimizeDuelVisuals({root, apply: true}); assert.equal(second[0].skipped, true); assert.deepEqual(fs.readFileSync(path.join(directory, 'chunk.json')), first);
    for (const [name, bytes] of protectedAssets) assert.deepEqual(fs.readFileSync(path.join(directory, name)), bytes);
    const optimized = JSON.parse(fs.readFileSync(path.join(directory, 'visual.json')));
    for (const resource of optimized.resources.filter(r => r.name.endsWith('.webp'))) assert.deepEqual(fs.readFileSync(path.join(directory, resource.name)), fs.readFileSync(path.join(directory, '../shared', resource.name)));
    assert.ok(optimized.texturePack); assert.ok(!optimized.resources.some(resource => resource.name === 'textures.bin'));
    const packed = fs.readFileSync(path.join(directory, 'textures.bin')); assert.equal(sha256(packed), optimized.texturePack.sha256);
    await packDuelTextures({root, apply: true});
    const packedMetadata = fs.readFileSync(path.join(directory, 'chunk.json'));
    await packDuelTextures({root, apply: true}); assert.deepEqual(fs.readFileSync(path.join(directory, 'chunk.json')), packedMetadata);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.ok(path.basename(root).startsWith('spraylab-opt-test-'));
    fs.rmSync(root, {recursive: true});
  }
});
