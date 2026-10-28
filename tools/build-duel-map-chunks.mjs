import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Document, Format, Logger, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization} from '@gltf-transform/extensions';
import {copyToDocument, dedup} from '@gltf-transform/functions';
import {MeshoptDecoder, MeshoptEncoder} from 'meshoptimizer';
import {Box3, Matrix4, Triangle, Vector3} from 'three';

export const PAGES_LIMIT = 25 * 1024 * 1024;
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const unit = .0254;
const triangle = new Triangle(), box = new Box3(), point = new Vector3();

export function sourceBounds(sourceMin, sourceMax, padding = 0) {
  if (![sourceMin, sourceMax].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) ||
      !Number.isFinite(padding) || padding < 0 || sourceMin.some((v, i) => v >= sourceMax[i])) throw new Error('Invalid Source bounds');
  const min = sourceMin.map(v => v - padding), max = sourceMax.map(v => v + padding);
  return {min: [min[0] * unit, min[2] * unit, -max[1] * unit], max: [max[0] * unit, max[2] * unit, -min[1] * unit]};
}

export function boundsIntersect(a, b) {
  return a.min.every((v, i) => v <= b.max[i] && a.max[i] >= b.min[i]);
}

export function geometryBounds(positions, indices, firstTriangle = 0, triangleCount = indices.length / 3) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = firstTriangle * 3, end = (firstTriangle + triangleCount) * 3; i < end; i++) {
    const vertex = indices[i] * 3;
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[vertex + axis]); max[axis] = Math.max(max[axis], positions[vertex + axis]);
    }
  }
  return {min, max};
}

// SAT keeps boundary-crossing faces, without keeping an entire distant batch
// merely because a large diagonal triangle's bounding box touches the chunk.
export function triangleInBounds(positions, indices, offset, bounds) {
  const a = indices[offset] * 3, b = indices[offset + 1] * 3, c = indices[offset + 2] * 3;
  for (let axis = 0; axis < 3; axis++) {
    const p = positions[a + axis], q = positions[b + axis], r = positions[c + axis];
    if (Math.max(p, q, r) < bounds.min[axis] - 1e-5 || Math.min(p, q, r) > bounds.max[axis] + 1e-5) return false;
  }
  box.min.fromArray(bounds.min).addScalar(-1e-5); box.max.fromArray(bounds.max).addScalar(1e-5);
  triangle.a.fromArray(positions, a); triangle.b.fromArray(positions, b); triangle.c.fromArray(positions, c);
  return box.intersectsTriangle(triangle);
}

export function remapTriangles(indices, selectedTriangles) {
  const oldVertices = [], remap = new Map(), remapped = new Uint32Array(selectedTriangles.length * 3);
  let cursor = 0;
  for (const triangle of selectedTriangles) for (let corner = 0; corner < 3; corner++) {
    const original = indices[triangle * 3 + corner];
    let next = remap.get(original);
    if (next === undefined) {next = oldVertices.length; remap.set(original, next); oldVertices.push(original);}
    remapped[cursor++] = next;
  }
  return {oldVertices, indices: remapped};
}

export function subsetAttribute(values, elementSize, oldVertices) {
  const result = new values.constructor(oldVertices.length * elementSize);
  for (let i = 0; i < oldVertices.length; i++) for (let component = 0; component < elementSize; component++) {
    result[i * elementSize + component] = values[oldVertices[i] * elementSize + component];
  }
  return result;
}

function view(bytes, Type, offset, length) {
  if (offset % Type.BYTES_PER_ELEMENT || offset + length * Type.BYTES_PER_ELEMENT > bytes.byteLength) throw new Error('Invalid collision buffer range');
  return new Type(bytes.buffer, bytes.byteOffset + offset, length);
}

export function subsetCollision(manifest, binary, bounds) {
  if (manifest.version !== 2 || manifest.unit !== unit || !manifest.groups?.length) throw new Error('Expected native collision v2');
  const buffers = [], groups = [], statistics = {sourceTriangles: 0, triangles: 0, hulls: 0, meshes: 0};
  let offset = 0;
  for (const group of manifest.groups) {
    const positions = view(binary, Float32Array, group.offset, group.vertexCount * 3);
    const indices = view(binary, Uint32Array, group.offset + group.vertexCount * 12, group.indexCount);
    const selected = [], primitives = [];
    statistics.sourceTriangles += indices.length / 3;
    for (const primitive of group.primitives) {
      const {firstTriangle, triangleCount, kind} = primitive;
      if (!['convex-hull', 'mesh'].includes(kind) || firstTriangle < 0 || (firstTriangle + triangleCount) * 3 > indices.length) throw new Error('Invalid collision primitive');
      if (!boundsIntersect(geometryBounds(positions, indices, firstTriangle, triangleCount), bounds)) continue;
      const firstOutput = selected.length, triangleSurfaces = [];
      for (let triangle = firstTriangle, end = firstTriangle + triangleCount; triangle < end; triangle++) {
        if (kind === 'mesh' && !triangleInBounds(positions, indices, triangle * 3, bounds)) continue;
        selected.push(triangle);
        if (primitive.triangleSurfaces) triangleSurfaces.push(primitive.triangleSurfaces[triangle - firstTriangle]);
      }
      if (firstOutput === selected.length) continue;
      const result = {...primitive, firstTriangle: firstOutput, triangleCount: selected.length - firstOutput};
      if (primitive.triangleSurfaces) result.triangleSurfaces = triangleSurfaces;
      primitives.push(result); statistics[kind === 'convex-hull' ? 'hulls' : 'meshes']++;
    }
    if (!selected.length) continue;
    const remapped = remapTriangles(indices, selected), vertices = subsetAttribute(positions, 3, remapped.oldVertices);
    const vertexBytes = Buffer.from(vertices.buffer), indexBytes = Buffer.from(remapped.indices.buffer);
    groups.push({...group, offset, vertexCount: vertices.length / 3, indexCount: remapped.indices.length, primitives});
    buffers.push(vertexBytes, indexBytes); offset += vertexBytes.length + indexBytes.length; statistics.triangles += selected.length;
  }
  if (!groups.length) throw new Error('Chunk contains no collision');
  const bytes = Buffer.concat(buffers);
  return {manifest: {...manifest, sourceCollisionSha256: manifest.collisionSha256, collisionSha256: sha256(bytes), groups}, binary: bytes, statistics};
}

export function createMapIO() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder});
}

export function newVisualPart(name) {
  const document = new Document(); document.setLogger(new Logger(Logger.Verbosity.ERROR));
  document.createExtension(KHRMeshQuantization).setRequired(true);
  document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method: EXTMeshoptCompression.EncoderMethod.QUANTIZE});
  return {document, scene: document.createScene(name), buffer: document.createBuffer(), triangles: 0, nodes: 0, materialMaps: new Map()};
}

export function appendVisualSubset(part, original, bounds) {
  const output = part.document;
  let materials = part.materialMaps.get(original);
  if (!materials) {materials = new Map(); part.materialMaps.set(original, materials);}
  let sourceTriangles = 0;
  for (const node of original.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    if (node.getSkin() || mesh.getWeights().length) throw new Error('Map chunks require static native map geometry');
    const matrix = new Matrix4().fromArray(node.getWorldMatrix()), outputMesh = output.createMesh(mesh.getName()).setExtras(structuredClone(mesh.getExtras()));
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4 || primitive.listTargets().length) throw new Error('Map chunks require static triangle primitives');
      const position = primitive.getAttribute('POSITION'); if (!position) throw new Error('Missing native render positions');
      const count = position.getCount(), sourceIndices = primitive.getIndices()?.getArray() ?? Uint32Array.from({length: count}, (_, i) => i);
      if (sourceIndices.length % 3) throw new Error('Incomplete native render triangle');
      sourceTriangles += sourceIndices.length / 3;
      const world = new Float32Array(count * 3), element = [];
      for (let i = 0; i < count; i++) {
        position.getElement(i, element); point.fromArray(element).applyMatrix4(matrix).toArray(world, i * 3);
      }
      if (!boundsIntersect(geometryBounds(world, sourceIndices), bounds)) continue;
      const selected = [];
      for (let i = 0; i < sourceIndices.length; i += 3) if (triangleInBounds(world, sourceIndices, i, bounds)) selected.push(i / 3);
      if (!selected.length) continue;
      const remapped = remapTriangles(sourceIndices, selected), outputPrimitive = output.createPrimitive().setMode(4).setExtras(structuredClone(primitive.getExtras()));
      for (const semantic of primitive.listSemantics()) {
        const attribute = primitive.getAttribute(semantic);
        outputPrimitive.setAttribute(semantic, output.createAccessor(attribute.getName()).setType(attribute.getType()).setNormalized(attribute.getNormalized())
          .setExtras(structuredClone(attribute.getExtras())).setArray(subsetAttribute(attribute.getArray(), attribute.getElementSize(), remapped.oldVertices)).setBuffer(part.buffer));
      }
      const typedIndices = remapped.oldVertices.length <= 65535 ? new Uint16Array(remapped.indices) : remapped.indices;
      outputPrimitive.setIndices(output.createAccessor().setType('SCALAR').setArray(typedIndices).setBuffer(part.buffer));
      const material = primitive.getMaterial();
      if (material) {
        if (!materials.has(material)) {
          const copied = copyToDocument(output, original, [material]);
          materials.set(material, copied.get(material));
        }
        outputPrimitive.setMaterial(materials.get(material));
      }
      outputMesh.addPrimitive(outputPrimitive); part.triangles += selected.length;
    }
    if (!outputMesh.listPrimitives().length) {outputMesh.dispose(); continue;}
    part.scene.addChild(output.createNode(node.getName()).setMatrix(node.getWorldMatrix()).setMesh(outputMesh).setExtras(structuredClone(node.getExtras())));
    part.nodes++;
  }
  return sourceTriangles;
}

function safeName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw new Error(`Invalid map resource: ${name}`);
  return name;
}

function writeAsset(directory, name, bytes) {
  safeName(name);
  if (bytes.length > PAGES_LIMIT) throw new Error(`${name} exceeds Cloudflare Pages 25 MiB file limit`);
  fs.writeFileSync(path.join(directory, name), bytes);
  return {name, bytes: bytes.length, sha256: sha256(bytes)};
}

function writeJson(directory, name, value) {return writeAsset(directory, name, Buffer.from(JSON.stringify(value)));}

async function writeVisuals(io, parts, directory) {
  const files = [], fileHashes = {}, resources = new Map();
  let triangles = 0, nodes = 0;
  for (const part of parts) {
    if (!part.triangles) continue;
    // Source buffers are already quantized. Preserve their raw attributes and
    // transforms, then apply only lossless meshopt encoding, not quantize().
    await part.document.transform(dedup());
    const filename = `visual-${files.length}.gltf`, bufferName = filename.replace('.gltf', '.bin');
    for (const buffer of part.document.getRoot().listBuffers()) buffer.setURI(bufferName);
    for (const texture of part.document.getRoot().listTextures()) {
      const image = texture.getImage(); if (!image) throw new Error('Missing native PBR image');
      texture.setURI(`texture-${sha256(image).slice(0, 24)}.webp`);
      if (texture.getMimeType() !== 'image/webp') throw new Error('Unexpected native texture format');
    }
    const result = await io.writeJSON(part.document, {format: Format.GLTF, basename: filename.slice(0, -5)});
    const primary = writeJson(directory, filename, result.json); files.push(filename); fileHashes[filename] = primary.sha256;
    for (const [name, bytes] of Object.entries(result.resources)) {
      const previous = resources.get(name), digest = sha256(bytes);
      if (previous && previous.sha256 !== digest) throw new Error(`Conflicting native resource ${name}`);
      if (!previous) resources.set(name, writeAsset(directory, name, bytes));
    }
    triangles += part.triangles; nodes += part.nodes;
  }
  if (!files.length) throw new Error('Chunk contains no render geometry');
  const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join(directory, file)).size, 0) + [...resources.values()].reduce((sum, r) => sum + r.bytes, 0);
  const manifest = {version: 2, files, fileHashes, bytes, resources: [...resources.values()]};
  const primary = writeJson(directory, 'visual.json', manifest);
  return {manifest, primary, triangles, nodes};
}

export async function buildDuelMapChunks({root = process.cwd(), ids} = {}) {
  await MeshoptDecoder.ready; await MeshoptEncoder.ready;
  const catalogPath = path.join(root, 'src/range/duel/real-map-catalog.json');
  const catalogBytes = fs.readFileSync(catalogPath), catalog = JSON.parse(catalogBytes);
  if (catalog.version !== 1 || catalog.map !== 'dust2') throw new Error('Unsupported real-map catalog');
  const sourceDirectory = path.join(root, 'public/revamp/maps/dust2');
  const outputRoot = path.resolve(sourceDirectory, 'duel');
  if (!outputRoot.startsWith(path.resolve(root) + path.sep)) throw new Error('Chunk outputs must stay inside workspace');
  const sourceCollisionBytes = fs.readFileSync(path.join(sourceDirectory, 'collision.json'));
  const sourceCollision = JSON.parse(sourceCollisionBytes), collisionBinary = fs.readFileSync(path.join(sourceDirectory, 'collision.bin'));
  if (sha256(collisionBinary) !== sourceCollision.collisionSha256) throw new Error('Native source collision hash mismatch');
  const sourceVisualBytes = fs.readFileSync(path.join(sourceDirectory, 'visual.json')), sourceVisual = JSON.parse(sourceVisualBytes);
  if (sourceVisual.version !== 2 || !Array.isArray(sourceVisual.files) || !sourceVisual.files.length) throw new Error('Expected visual manifest v2');
  for (const resource of sourceVisual.resources) {
    safeName(resource.name);
    const bytes = fs.readFileSync(path.join(sourceDirectory, resource.name));
    if (bytes.length !== resource.bytes || sha256(bytes) !== resource.sha256) throw new Error(`Native source resource mismatch: ${resource.name}`);
  }
  const chunks = catalog.chunks.filter(chunk => !ids || ids.includes(chunk.id)).map(chunk => {
    safeName(chunk.id);
    const directory = path.join(outputRoot, chunk.id), bounds = sourceBounds(chunk.sourceMin, chunk.sourceMax, chunk.contextPaddingUnits);
    fs.mkdirSync(directory, {recursive: true});
    const collision = subsetCollision(sourceCollision, collisionBinary, bounds);
    const collisionPrimary = writeJson(directory, 'collision.json', collision.manifest), binaryPrimary = writeAsset(directory, 'collision.bin', collision.binary);
    console.log(`${chunk.id}: native collision ${collision.statistics.triangles}/${collision.statistics.sourceTriangles} triangles, ${(collision.binary.length / 1e6).toFixed(2)} MB`);
    return {chunk, directory, bounds, collision, collisionPrimary, binaryPrimary, parts: []};
  });
  if (!chunks.length || (ids && chunks.length !== ids.length)) throw new Error('Unknown or duplicate chunk ID');
  const io = createMapIO(); let sourceRenderTriangles = 0;
  // Keep source documents bounded to one sector file at a time. Each output
  // part is independently compressed, so no geometry resource exceeds 25 MiB.
  for (const filename of sourceVisual.files) {
    safeName(filename);
    const sourceBytes = fs.readFileSync(path.join(sourceDirectory, filename));
    if (sourceVisual.fileHashes?.[filename] && sha256(sourceBytes) !== sourceVisual.fileHashes[filename]) throw new Error('Native visual manifest hash mismatch');
    const original = await io.read(path.join(sourceDirectory, filename));
    let count = 0;
    for (const context of chunks) {
      const part = newVisualPart(`${context.chunk.name} native context`);
      count = appendVisualSubset(part, original, context.bounds); context.parts.push(part);
    }
    sourceRenderTriangles += count;
    console.log(`Subset ${filename}: ${count} source render triangles`);
  }
  const summaries = [];
  for (const context of chunks) {
    const {chunk, directory, bounds, collision, collisionPrimary, binaryPrimary} = context;
    const visual = await writeVisuals(io, context.parts, directory);
    const manifest = {
      version: 1, id: chunk.id, map: catalog.map, routeId: chunk.routeId, name: chunk.name, build: sourceCollision.build,
      coordinateSystem: catalog.coordinateSystem, sourceCollisionSha256: sourceCollision.collisionSha256,
      collisionManifestSha256: collisionPrimary.sha256, visualManifestSha256: visual.primary.sha256,
      sourceCollisionManifestSha256: sha256(sourceCollisionBytes), sourceVisualManifestSha256: sha256(sourceVisualBytes), catalogSha256: sha256(catalogBytes),
      sourceMin: chunk.sourceMin, sourceMax: chunk.sourceMax, contextPaddingUnits: chunk.contextPaddingUnits,
      bounds: sourceBounds(chunk.sourceMin, chunk.sourceMax), renderBounds: bounds, collisionBounds: bounds,
      hashes: {'collision.json': collisionPrimary.sha256, 'collision.bin': binaryPrimary.sha256, 'visual.json': visual.primary.sha256},
      outputBytes: collisionPrimary.bytes + binaryPrimary.bytes + visual.primary.bytes + visual.manifest.bytes,
      sourceBytes: sourceCollisionBytes.length + collisionBinary.length + sourceVisualBytes.length + sourceVisual.bytes,
      collision: {...collision.statistics, bytes: binaryPrimary.bytes},
      visual: {sourceTriangles: sourceRenderTriangles, triangles: visual.triangles, batches: visual.nodes, files: visual.manifest.files.length, bytes: visual.manifest.bytes,
        textures: visual.manifest.resources.filter(r => r.name.endsWith('.webp')).length},
      policy: 'World coordinates unchanged; padded native geometry; complete intersecting convex hulls; exact intersecting mesh triangles; lossless meshopt recompression of decoded source attributes; original PBR/textures; no PVS.'
    };
    const assetBytes = manifest.outputBytes;
    for (let previous = -1; previous !== manifest.outputBytes;) {
      previous = manifest.outputBytes; manifest.outputBytes = assetBytes + Buffer.byteLength(JSON.stringify(manifest));
    }
    writeJson(directory, 'chunk.json', manifest);
    const keep = new Set(['chunk.json', 'collision.json', 'collision.bin', 'visual.json', ...visual.manifest.files, ...visual.manifest.resources.map(r => r.name)]);
    // Delete only stale files recognizable as our generated assets, and only
    // directly inside this catalog-controlled chunk output directory.
    for (const name of fs.readdirSync(directory)) {
      if (keep.has(name) || !/^(visual-\d+\.(gltf|bin)|texture-[a-f0-9]{24}\.webp)$/.test(name)) continue;
      const target = path.resolve(directory, name);
      if (path.dirname(target) !== path.resolve(directory)) throw new Error('Unsafe generated asset cleanup');
      fs.unlinkSync(target);
    }
    summaries.push(manifest);
    console.log(`${chunk.id}: ${(manifest.outputBytes / 1e6).toFixed(2)} MB vs ${(manifest.sourceBytes / 1e6).toFixed(2)} MB full map; ${visual.triangles}/${sourceRenderTriangles} render triangles, ${visual.nodes} batches`);
  }
  return summaries;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ids = process.argv.slice(2);
  await buildDuelMapChunks({ids: ids.length ? ids : undefined});
}
