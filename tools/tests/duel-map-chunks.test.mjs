import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Document, Format} from '@gltf-transform/core';
import {MeshoptDecoder, MeshoptEncoder} from 'meshoptimizer';
import {Matrix4, Vector3} from 'three';
import {appendVisualSubset, boundsIntersect, createMapIO, newVisualPart, PAGES_LIMIT, remapTriangles, sha256,
  sourceBounds, subsetAttribute, subsetCollision, triangleInBounds} from '../build-duel-map-chunks.mjs';

const bounds = {min: [-1, -1, -1], max: [1, 1, 1]};

test('Source bounds preserve the existing metres/axis mapping, including padding', () => {
  assert.deepEqual(sourceBounds([0, -500, -256], [1950, 1450, 640]),
    {min: [0, -256 * .0254, -1450 * .0254], max: [1950 * .0254, 640 * .0254, 500 * .0254]});
  const padded = sourceBounds([0, -500, -256], [1950, 1450, 640], 384);
  assert.equal(padded.min[0], -384 * .0254); assert.equal(padded.max[1], 1024 * .0254);
  assert.throws(() => sourceBounds([1, 0, 0], [0, 1, 1]), /Invalid/);
  assert.throws(() => sourceBounds([0, 0, 0], [1, 1, 1], -1), /Invalid/);
});

test('triangle selection keeps crossing faces but rejects diagonal AABB false positives', () => {
  const indices = new Uint32Array([0, 1, 2]);
  assert.equal(triangleInBounds(new Float32Array([-10, 0, 0, 10, 0, 0, 0, 10, 0]), indices, 0, bounds), true);
  assert.equal(triangleInBounds(new Float32Array([0, 10, 0, 10, 0, 0, 10, 10, 0]), indices, 0, bounds), false);
  assert.equal(boundsIntersect({min: [1, 0, 0], max: [2, 1, 1]}, bounds), true);
});

test('vertex remapping retains winding, sharing and exact typed attribute values', () => {
  const remapped = remapTriangles(new Uint32Array([8, 4, 9, 9, 4, 2, 0, 1, 2]), [0, 1]);
  assert.deepEqual(remapped.oldVertices, [8, 4, 9, 2]);
  assert.deepEqual([...remapped.indices], [0, 1, 2, 2, 1, 3]);
  const source = Int16Array.from({length: 20}, (_, i) => i * 151 - 120);
  const result = subsetAttribute(source, 2, [8, 4, 9, 2]);
  assert.ok(result instanceof Int16Array);
  assert.deepEqual([...result], [source[16], source[17], source[8], source[9], source[18], source[19], source[4], source[5]]);
});

function collisionFixture() {
  const positions = new Float32Array([
    -2, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2,
    -.5, 0, -.5, .5, 0, -.5, 0, 0, .5,
    20, 0, 20, 21, 0, 20, 20, 0, 21
  ]);
  const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const manifest = {version: 2, unit: .0254, build: 'fixture', collisionSha256: sha256(binary), surfaces: [{id: 0}, {id: 1}],
    groups: [{id: 4, offset: 0, vertexCount: positions.length / 3, indexCount: indices.length, movement: true, shots: false, tags: ['playerclip'], excludes: [],
      primitives: [{id: 90, firstTriangle: 0, triangleCount: 4, surfaceId: 0, kind: 'convex-hull'},
        {id: 99, firstTriangle: 4, triangleCount: 2, surfaceId: 0, kind: 'mesh', triangleSurfaces: [1, 0]}]}]};
  return {manifest, binary, positions, indices};
}

test('collision keeps a complete intersecting convex hull and trims only open mesh triangles', () => {
  const fixture = collisionFixture(), result = subsetCollision(fixture.manifest, fixture.binary, bounds);
  const group = result.manifest.groups[0];
  assert.equal(group.id, 4); assert.equal(group.movement, true); assert.equal(group.shots, false); assert.deepEqual(group.tags, ['playerclip']);
  assert.deepEqual(group.primitives[0], fixture.manifest.groups[0].primitives[0]);
  assert.deepEqual(group.primitives[1], {id: 99, firstTriangle: 4, triangleCount: 1, surfaceId: 0, kind: 'mesh', triangleSurfaces: [1]});
  assert.equal(group.indexCount, 15); assert.equal(group.vertexCount, 7); assert.equal(result.statistics.hulls, 1); assert.equal(result.statistics.meshes, 1);
  assert.equal(result.manifest.sourceCollisionSha256, fixture.manifest.collisionSha256);
  assert.equal(result.manifest.collisionSha256, sha256(result.binary));
  const vertices = new Float32Array(result.binary.buffer, result.binary.byteOffset, group.vertexCount * 3);
  const indices = new Uint32Array(result.binary.buffer, result.binary.byteOffset + group.vertexCount * 12, group.indexCount);
  for (let i = 0; i < indices.length; i++) for (let axis = 0; axis < 3; axis++) {
    assert.equal(vertices[indices[i] * 3 + axis], fixture.positions[fixture.indices[i] * 3 + axis]);
  }
});

test('collision excludes a fully distant hull and rejects empty chunks', () => {
  const fixture = collisionFixture();
  assert.throws(() => subsetCollision(fixture.manifest, fixture.binary, {min: [100, 100, 100], max: [110, 110, 110]}), /no collision/);
});

test('visual subsets preserve world transforms, UVs, normalized attributes, PBR and extras through meshopt roundtrip', async () => {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const original = new Document(), buffer = original.createBuffer(), scene = original.createScene();
  const textureInventory = JSON.parse(fs.readFileSync('public/revamp/maps/dust2/visual.json'));
  const image = textureInventory.resources.find(r => r.name.endsWith('.webp') && r.bytes < 400);
  const texture = original.createTexture('original-albedo').setImage(fs.readFileSync(`public/revamp/maps/dust2/${image.name}`)).setMimeType('image/webp').setURI(image.name);
  const material = original.createMaterial('native-overlay').setBaseColorTexture(texture).setBaseColorFactor([.4, .5, .6, .7])
    .setMetallicFactor(.25).setRoughnessFactor(.8).setAlphaMode('BLEND').setDoubleSided(true).setExtras({nativeOverlay: true, nativeMaterial: 'fixture'});
  const accessor = (type, array, normalized = false) => original.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer);
  const positions = new Float32Array([0, 0, 0, .5, 0, 0, 0, .5, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const colors = new Uint8Array(24).fill(191), normals = new Int16Array(18);
  for (let i = 2; i < normals.length; i += 3) normals[i] = 32767;
  const primitive = original.createPrimitive().setAttribute('POSITION', accessor('VEC3', positions)).setAttribute('NORMAL', accessor('VEC3', normals, true))
    .setAttribute('TEXCOORD_0', accessor('VEC2', uvs)).setAttribute('COLOR_0', accessor('VEC4', colors, true))
    .setIndices(accessor('SCALAR', new Uint16Array([0, 1, 2, 3, 4, 5]))).setMaterial(material).setExtras({primitiveTag: 12});
  const parent = original.createNode('parent').setTranslation([30, 2, -20]), child = original.createNode('child').setTranslation([.2, .1, -.1])
    .setMesh(original.createMesh().addPrimitive(primitive)).setExtras({sector: '1:-1', nativeClusters: [4, 5]});
  scene.addChild(parent); parent.addChild(child);
  const part = newVisualPart('fixture');
  assert.equal(appendVisualSubset(part, original, {min: [29, 1, -21], max: [32, 4, -18]}), 2);
  assert.equal(part.triangles, 1); assert.equal(part.nodes, 1);
  const output = part.scene.listChildren()[0], expectedMatrix = child.getWorldMatrix();
  assert.deepEqual(output.getWorldMatrix(), expectedMatrix);
  const io = createMapIO(), encoded = await io.writeJSON(part.document, {format: Format.GLTF, basename: 'fixture'});
  assert.ok(encoded.json.extensionsRequired.includes('EXT_meshopt_compression'));
  const decoded = await io.readJSON(encoded), decodedNode = decoded.getRoot().listScenes()[0].listChildren()[0];
  const decodedPrimitive = decodedNode.getMesh().listPrimitives()[0], decodedMaterial = decodedPrimitive.getMaterial();
  assert.deepEqual([...decodedPrimitive.getAttribute('TEXCOORD_0').getArray()], [...uvs.slice(0, 6)]);
  assert.deepEqual([...decodedPrimitive.getAttribute('NORMAL').getArray()], [...normals.slice(0, 9)]);
  assert.deepEqual([...decodedPrimitive.getAttribute('COLOR_0').getArray()], [...colors.slice(0, 12)]);
  assert.equal(decodedPrimitive.getAttribute('COLOR_0').getNormalized(), true);
  assert.deepEqual(decodedPrimitive.getExtras(), {primitiveTag: 12}); assert.deepEqual(decodedNode.getExtras(), child.getExtras());
  assert.deepEqual(decodedMaterial.getBaseColorFactor(), material.getBaseColorFactor()); assert.equal(decodedMaterial.getRoughnessFactor(), .8);
  assert.equal(decodedMaterial.getMetallicFactor(), .25); assert.equal(decodedMaterial.getAlphaMode(), 'BLEND'); assert.equal(decodedMaterial.getDoubleSided(), true);
  assert.deepEqual(decodedMaterial.getExtras(), material.getExtras());
  assert.deepEqual(Buffer.from(decodedMaterial.getBaseColorTexture().getImage()), Buffer.from(texture.getImage()));
  const v = new Vector3().fromArray(decodedPrimitive.getAttribute('POSITION').getElement(1, [])).applyMatrix4(new Matrix4().fromArray(decodedNode.getWorldMatrix()));
  assert.ok(v.distanceTo(new Vector3(.5, 0, 0).applyMatrix4(new Matrix4().fromArray(expectedMatrix))) < 1e-7);
});

test('all generated chunk resources and primary manifest hashes are complete, bounded and smaller than the whole map', {skip: !fs.existsSync('public/revamp/maps/dust2/duel/dust2-long-doors/chunk.json')}, () => {
  const catalog = JSON.parse(fs.readFileSync('src/range/duel/real-map-catalog.json'));
  for (const chunk of catalog.chunks) {
    const base = `public/revamp/maps/dust2/duel/${chunk.id}/`, summary = JSON.parse(fs.readFileSync(base + 'chunk.json'));
    const visual = JSON.parse(fs.readFileSync(base + 'visual.json'));
    assert.equal(summary.id, chunk.id); assert.equal(summary.routeId, chunk.routeId); assert.deepEqual(summary.sourceMin, chunk.sourceMin);
    assert.deepEqual(summary.bounds, sourceBounds(chunk.sourceMin, chunk.sourceMax));
    for (const [name, digest] of Object.entries(summary.hashes)) assert.equal(sha256(fs.readFileSync(base + name)), digest);
    assert.equal(summary.collisionManifestSha256, sha256(fs.readFileSync(base + 'collision.json')));
    assert.equal(summary.visualManifestSha256, sha256(fs.readFileSync(base + 'visual.json')));
    for (const resource of visual.resources) {
      const bytes = fs.readFileSync(base + resource.name); assert.equal(bytes.length, resource.bytes); assert.equal(sha256(bytes), resource.sha256);
    }
    for (const file of visual.files) {
      const bytes = fs.readFileSync(base + file); assert.equal(sha256(bytes), visual.fileHashes[file]);
      const gltf = JSON.parse(bytes);
      assert.ok(gltf.extensionsRequired.includes('EXT_meshopt_compression'));
      for (const reference of [...gltf.images, ...gltf.buffers].filter(item => item.uri)) assert.ok(visual.resources.some(r => r.name === reference.uri));
    }
    const files = fs.readdirSync(base);
    assert.ok(files.every(file => fs.statSync(base + file).size <= PAGES_LIMIT));
    assert.equal(files.reduce((sum, file) => sum + fs.statSync(base + file).size, 0), summary.outputBytes);
    assert.ok(summary.outputBytes < summary.sourceBytes * .7, `${chunk.id} must be a genuine bounded asset subset`);
    assert.ok(summary.collision.triangles < summary.collision.sourceTriangles * .6);
    assert.ok(summary.visual.triangles < summary.visual.sourceTriangles * .6);
    assert.ok(files.includes('visibility.json')&&files.includes('visibility.bin'));
  }
});

test('sliced visibility rows preserve the source map at 1,960 positions', {skip: !fs.existsSync('public/revamp/maps/dust2/visibility.bin')},async()=>{
  const {NativeVisibility}=await import('../../src/range/prefire/native-visibility.mjs');
  const base='public/revamp/maps/dust2/',bytes=fs.readFileSync(base+'visibility.bin');
  const source=new NativeVisibility(JSON.parse(fs.readFileSync(base+'visibility.json')),bytes);
  const catalog=JSON.parse(fs.readFileSync('src/range/duel/real-map-catalog.json'));let checks=0;
  for(const chunk of catalog.chunks){
    const directory=base+'duel/'+chunk.id+'/',metadata=JSON.parse(fs.readFileSync(directory+'visibility.json'));
    assert.equal(metadata.sourceSha256,sha256(bytes));
    const sliced=new NativeVisibility(metadata,fs.readFileSync(directory+'visibility.bin'));
    for(let x=0;x<7;x++)for(let y=0;y<7;y++)for(let z=0;z<5;z++){
      const point=[x,y,z].map((n,i)=>chunk.sourceMin[i]+(chunk.sourceMax[i]-chunk.sourceMin[i])*(n+.5)/[7,7,5][i]);
      assert.deepEqual(sliced.pointRow(point),source.pointRow(point),`${chunk.id}: ${point}`);checks++;
    }
  }
  assert.equal(checks,1960);
});
