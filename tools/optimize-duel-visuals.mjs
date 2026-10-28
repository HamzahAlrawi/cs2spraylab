import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Document, Format, Logger} from '@gltf-transform/core';
import {KHRTextureTransform} from '@gltf-transform/extensions';
import {copyToDocument, dedup, listTextureInfoByMaterial, meshopt, weld} from '@gltf-transform/functions';
import {MeshoptDecoder, MeshoptEncoder} from 'meshoptimizer';
import {Matrix3, Matrix4, Vector3} from 'three';
import sharp from 'sharp';
import {appendVisualSubset, createMapIO, newVisualPart, PAGES_LIMIT, sha256, sourceBounds} from './build-duel-map-chunks.mjs';

const rootDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const textureBase = '/maps/dust2/duel/shared/';
export const visualPolicy = Object.freeze({version: 2, cellSize: 32, cellHeight: 64, cellYOffset: 16, colorSize: 512, criticalColorSize: 1024, dataSize: 256,
  quality: 80, positionBits: 14, normalBits: 8, texcoordBits: 16, colorBits: 12, meshoptLevel: 'high',
  transparentBatching: false, removeUnusedUVs: true, normalizeRepeatedUVs: true, maxUVRange: 64});
const protectedFiles = ['collision.json', 'collision.bin', 'navigation.json'];
const ignoredMaterialExtras = new Set(['nativeMaterial', 'nativeMaterials']);
const ignoredNodeExtras = new Set(['sector', 'nativeClusters', 'nativeSourceNodes', 'nativeBounds']);
const slots = ['BaseColor', 'Emissive', 'Normal', 'MetallicRoughness', 'Occlusion'];
const textMaterial = /(?:^|[\s/_.-])(?:sign|signs|signage|poster|posters|graffiti|letter|letters|label|labels|advert|advertisement|logo|banner|notice|text|number|numbers|license|licenseplate|plate|writing|inscription)(?:[\s/_.-]|$)/i;

export function geometryBreakdown(json) {
  const views = new Map();
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) for (const [semantic, index] of Object.entries({...primitive.attributes, INDICES: primitive.indices})) {
    const accessor = json.accessors[index], id = accessor.bufferView;
    let row = views.get(id); if (!row) {row = {semantics: new Set(), bytes: json.bufferViews[id].extensions?.EXT_meshopt_compression?.byteLength ?? json.bufferViews[id].byteLength}; views.set(id, row);}
    row.semantics.add(semantic);
  }
  const result = {};
  for (const row of views.values()) {const key = [...row.semantics].sort().join('+'); result[key] = (result[key] ?? 0) + row.bytes;}
  return result;
}

export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const without = (value, ignored) => Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key)));

export function stabilizeCollapsedNodes(document) {
  for (const node of document.getRoot().listNodes()) {
    if (node.getMatrix().every(Number.isFinite)) continue;
    // Matrix decomposition cannot recover a rotation from an all-zero scale.
    // Such native degenerate batches remain collapsed at the same translation.
    if (!node.getScale().every(value => value === 0) || !node.getTranslation().every(Number.isFinite)) throw new Error(`Invalid native render transform: ${node.getName()}`);
    node.setRotation([0, 0, 0, 1]);
    if (!node.getMatrix().every(Number.isFinite)) throw new Error('Collapsed native transform could not be preserved');
  }
}

export async function inspectVisuals(document) {
  let nodes = 0, primitives = 0, triangles = 0, vertices = 0;
  const bounds = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]}, seen = new Set();
  const vector = new Vector3(), element = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue; nodes++;
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION'); primitives++;
      vertices += positions.getCount();
      triangles += (primitive.getIndices()?.getCount() ?? positions.getCount()) / 3;
      for (let i = 0; i < positions.getCount(); i++) {
        vector.fromArray(positions.getElement(i, element)).applyMatrix4(matrix);
        if (![vector.x, vector.y, vector.z].every(Number.isFinite)) throw new Error(`Nonfinite native render position: ${node.getName()}`);
        for (let axis = 0; axis < 3; axis++) {const v = vector.getComponent(axis); bounds.min[axis] = Math.min(bounds.min[axis], v); bounds.max[axis] = Math.max(bounds.max[axis], v);}
      }
    }
  }
  const colorImages = new Set(), dataImages = new Set(), alphaModes = {};
  for (const material of document.getRoot().listMaterials()) {
    alphaModes[material.getAlphaMode()] = (alphaModes[material.getAlphaMode()] ?? 0) + 1;
    for (const slot of slots) {const image = material[`get${slot}Texture`]()?.getImage(); if (image) (slot === 'BaseColor' || slot === 'Emissive' ? colorImages : dataImages).add(sha256(image));}
  }
  const textureBytesByRole = {color: 0, data: 0, mixed: 0}, decodedRGBABytesByRole = {color: 0, data: 0, mixed: 0};
  let decodedRGBABytes = 0, textureBytes = 0, textures = 0;
  for (const texture of document.getRoot().listTextures()) {
    const bytes = texture.getImage(), hash = sha256(bytes); if (seen.has(hash)) continue; seen.add(hash);
    const metadata = await sharp(bytes).metadata(), pixels = metadata.width * metadata.height * 4;
    decodedRGBABytes += pixels; textureBytes += bytes.length; textures++;
    const role = colorImages.has(hash) ? dataImages.has(hash) ? 'mixed' : 'color' : 'data';
    textureBytesByRole[role] += bytes.length; decodedRGBABytesByRole[role] += pixels;
  }
  return {nodes, primitives, triangles, vertices, materials: document.getRoot().listMaterials().length, alphaModes, textures, textureBytes,
    textureBytesByRole, decodedRGBABytes, decodedRGBABytesByRole, bounds};
}

export function canonicalMaterials(document) {
  const canonical = [], mapping = new Map(), ignored = new Set(['name', 'extras']);
  for (const material of document.getRoot().listMaterials()) {
    const extrasKey = stableJson(without(material.getExtras(), ignoredMaterialExtras));
    let index = canonical.findIndex(row => row.extrasKey === extrasKey && material.equals(row.material, ignored));
    if (index < 0) {index = canonical.length; canonical.push({material, extrasKey, sources: new Set()});}
    const row = canonical[index], extras = material.getExtras();
    for (const source of [extras.nativeMaterial, ...(extras.nativeMaterials ?? [])].filter(Boolean)) row.sources.add(source);
    mapping.set(material, index);
  }
  for (const row of canonical) if (row.sources.size) row.material.setExtras({...row.material.getExtras(), nativeMaterials: [...row.sources].sort()});
  return {canonical: canonical.map(row => row.material), mapping};
}

export function textureBounds(document, policy = visualPolicy) {
  const limits = new Map();
  for (const material of document.getRoot().listMaterials()) {
    const extras = material.getExtras(), name = `${material.getName()} ${extras.nativeMaterial ?? ''} ${(extras.nativeMaterials ?? []).join(' ')}`;
    // Alpha cutouts and generic overlays are often foliage/stains, not text.
    // Preserve 1K only for actual signage/text-like semantic material names.
    const critical = textMaterial.test(name);
    for (const slot of slots) {
      const texture = material[`get${slot}Texture`](); if (!texture) continue;
      const color = slot === 'BaseColor' || slot === 'Emissive';
      const size = color ? critical ? policy.criticalColorSize : policy.colorSize : policy.dataSize;
      limits.set(texture, Math.max(size, limits.get(texture) ?? 0));
    }
  }
  return limits;
}

export async function boundTextures(document, policy = visualPolicy) {
  const limits = textureBounds(document, policy), cache = new Map(); let resized = 0;
  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage(); if (!image) throw new Error('Missing native material texture');
    const limit = limits.get(texture); if (!limit) throw new Error('Unsupported/unreferenced native texture slot');
    const sourceHash = sha256(image), key = `${sourceHash}:${limit}:${policy.quality}`;
    let encoded = cache.get(key);
    if (!encoded) {
      const metadata = await sharp(image).metadata();
      if (Math.max(metadata.width, metadata.height) > limit) {
        encoded = await sharp(image).resize({width: limit, height: limit, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3'})
          .webp({quality: policy.quality, alphaQuality: 100, effort: 5, smartSubsample: true}).toBuffer(); resized++;
      } else encoded = image;
      cache.set(key, encoded);
    }
    texture.setImage(encoded).setMimeType('image/webp').setURI(`texture-${sha256(encoded).slice(0, 24)}.webp`);
  }
  return {resized};
}

function transformedAttributes(primitive, matrix, usedUVs) {
  const result = {}, vector = new Vector3(), element = [], normal = new Matrix3().getNormalMatrix(matrix), determinant = matrix.determinant();
  for (const semantic of primitive.listSemantics()) {
    if (usedUVs && semantic.startsWith('TEXCOORD_') && !usedUVs.has(semantic)) continue;
    const attribute = primitive.getAttribute(semantic), size = attribute.getElementSize(), values = new Float32Array(attribute.getCount() * size);
    for (let i = 0; i < attribute.getCount(); i++) {
      attribute.getElement(i, element);
      if (semantic === 'POSITION') vector.fromArray(element).applyMatrix4(matrix).toArray(element);
      else if (semantic === 'NORMAL') vector.fromArray(element).applyMatrix3(normal).normalize().toArray(element);
      else if (semantic === 'TANGENT') {vector.fromArray(element).transformDirection(matrix).toArray(element); element[3] *= Math.sign(determinant);}
      for (let component = 0; component < size; component++) values[i * size + component] = element[component];
    }
    result[semantic] = {type: attribute.getType(), size, values, extras: structuredClone(attribute.getExtras())};
  }
  return {attributes: result, reflected: determinant < 0};
}

export function spatialBatch(document, policy = visualPolicy) {
  const {canonical, mapping} = canonicalMaterials(document), batches = new Map(); let sourcePrimitive = 0, sourceTriangles = 0;
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    if (node.getSkin() || mesh.getWeights().length || document.getRoot().listAnimations().length) throw new Error('Only static native map geometry can be batched');
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4 || primitive.listTargets().length) throw new Error('Only static triangle primitives can be batched');
      const materialIndex = mapping.get(primitive.getMaterial());
      if (materialIndex === undefined) throw new Error('Missing native material');
      const material = canonical[materialIndex], usedUVs = policy.removeUnusedUVs ? new Set(listTextureInfoByMaterial(material).map(info =>
        `TEXCOORD_${info.getExtension('KHR_texture_transform')?.getTexCoord() ?? info.getTexCoord()}`)) : undefined;
      const {attributes, reflected} = transformedAttributes(primitive, matrix, usedUVs), positions = attributes.POSITION;
      const indices = primitive.getIndices()?.getArray() ?? Uint32Array.from({length: positions.values.length / 3}, (_, i) => i);
      if (indices.length % 3) throw new Error('Incomplete native render triangle');
      const layout = Object.entries(attributes).map(([key, value]) => [key, value.type, value.extras]);
      const primitiveExtras = primitive.getExtras(), nodeExtras = without(node.getExtras(), ignoredNodeExtras);
      const state = stableJson([materialIndex, layout, primitiveExtras, nodeExtras]), transparent = material.getAlphaMode() === 'BLEND';
      sourceTriangles += indices.length / 3;
      for (let at = 0; at < indices.length; at += 3) {
        const vertices = [indices[at], indices[at + 1], indices[at + 2]];
        if (reflected) [vertices[0], vertices[2]] = [vertices[2], vertices[0]];
        const center = [0, 0, 0];
        for (const vertex of vertices) for (let axis = 0; axis < 3; axis++) center[axis] += positions.values[vertex * 3 + axis] / 3;
        const cell = `${Math.floor(center[0] / policy.cellSize)}:${Math.floor((center[1] + (policy.cellYOffset ?? 16)) / policy.cellHeight)}:${Math.floor(center[2] / policy.cellSize)}`;
        const key = transparent ? `transparent:${sourcePrimitive}` : `${cell}:${state}`;
        let batch = batches.get(key);
        if (!batch) {
          batch = {cell, materialIndex, extras: structuredClone(primitiveExtras), nodeExtras: structuredClone(nodeExtras), indices: [], maps: new Map(),
            attributes: Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, {...value, values: []}])), nodes: new Set(), clusters: new Set()};
          batches.set(key, batch);
        }
        batch.nodes.add(node.getName()); for (const cluster of node.getExtras().nativeClusters ?? []) batch.clusters.add(cluster);
        let vertexMap = batch.maps.get(sourcePrimitive); if (!vertexMap) {vertexMap = new Map(); batch.maps.set(sourcePrimitive, vertexMap);}
        for (const vertex of vertices) {
          let next = vertexMap.get(vertex);
          if (next === undefined) {
            next = batch.attributes.POSITION.values.length / 3; vertexMap.set(vertex, next);
            for (const [semantic, value] of Object.entries(attributes)) for (let component = 0; component < value.size; component++) {
              batch.attributes[semantic].values.push(value.values[vertex * value.size + component]);
            }
          }
          batch.indices.push(next);
        }
      }
      sourcePrimitive++;
    }
  }
  const output = new Document(); output.setLogger(new Logger(Logger.Verbosity.ERROR));
  const scene = output.createScene('Dust 2 bounded native render batches'), buffer = output.createBuffer(), materials = copyToDocument(output, document, canonical);
  for (const batch of batches.values()) {
    const primitive = output.createPrimitive().setMaterial(materials.get(canonical[batch.materialIndex])).setExtras(batch.extras);
    for (const [semantic, value] of Object.entries(batch.attributes)) primitive.setAttribute(semantic,
      output.createAccessor().setType(value.type).setArray(new Float32Array(value.values)).setBuffer(buffer).setExtras(value.extras));
    const indices = batch.attributes.POSITION.values.length / 3 <= 65535 ? new Uint16Array(batch.indices) : new Uint32Array(batch.indices);
    primitive.setIndices(output.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
    scene.addChild(output.createNode(`cell-${batch.cell}-material-${batch.materialIndex}`).setMesh(output.createMesh().addPrimitive(primitive))
      .setExtras({...batch.nodeExtras, sector: batch.cell, nativeClusters: [...batch.clusters].sort((a, b) => a - b), nativeSourceNodes: [...batch.nodes].sort()}));
  }
  return {document: output, sourceTriangles};
}

export function normalizeRepeatedUVs(document, policy = visualPolicy) {
  const groups = new Map();
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const material = primitive.getMaterial(); let channels = groups.get(material);
    if (!channels) {channels = new Map(); groups.set(material, channels);}
    for (const info of listTextureInfoByMaterial(material)) {
      const channel = info.getExtension('KHR_texture_transform')?.getTexCoord() ?? info.getTexCoord(), semantic = `TEXCOORD_${channel}`;
      if (!primitive.getAttribute(semantic)) continue;
      let group = channels.get(channel); if (!group) {group = {semantic, primitives: new Set(), infos: new Set()}; channels.set(channel, group);}
      group.primitives.add(primitive); group.infos.add(info);
    }
  }
  let normalizedChannels = 0, skippedRotated = 0, skippedLarge = 0;
  for (const channels of groups.values()) for (const group of channels.values()) {
    const min = [Infinity, Infinity], max = [-Infinity, -Infinity], element = [];
    for (const primitive of group.primitives) {
      const uv = primitive.getAttribute(group.semantic);
      for (let i = 0; i < uv.getCount(); i++) {uv.getElement(i, element); for (let axis = 0; axis < 2; axis++) {min[axis] = Math.min(min[axis], element[axis]); max[axis] = Math.max(max[axis], element[axis]);}}
    }
    if (min.every(value => value >= 0) && max.every(value => value <= 1)) continue;
    // A general rotated/nonuniform transform may introduce shear when composed
    // with this frame. Leave those uncommon UVs untouched instead of guessing.
    if ([...group.infos].some(info => Math.abs(info.getExtension('KHR_texture_transform')?.getRotation() ?? 0) > 1e-8)) {skippedRotated++; continue;}
    const offset = min.map(Math.floor), range = max.map((value, axis) => Math.max(1, Math.ceil(value) - offset[axis]));
    if (range.some(value => value > policy.maxUVRange)) {skippedLarge++; continue;}
    const extension = document.createExtension(KHRTextureTransform).setRequired(true);
    for (const info of group.infos) {
      const previous = info.getExtension('KHR_texture_transform'), oldOffset = previous?.getOffset() ?? [0, 0], oldScale = previous?.getScale() ?? [1, 1];
      const transform = extension.createTransform().setOffset(offset.map((value, axis) => oldOffset[axis] + oldScale[axis] * value))
        .setScale(range.map((value, axis) => oldScale[axis] * value));
      if (previous?.getTexCoord() != null) transform.setTexCoord(previous.getTexCoord());
      info.setExtension('KHR_texture_transform', transform);
    }
    for (const primitive of group.primitives) {
      const uv = primitive.getAttribute(group.semantic), values = new Float32Array(uv.getCount() * 2);
      for (let i = 0; i < uv.getCount(); i++) {uv.getElement(i, element); for (let axis = 0; axis < 2; axis++) values[i * 2 + axis] = (element[axis] - offset[axis]) / range[axis];}
      primitive.setAttribute(group.semantic, uv.clone().setArray(values).setNormalized(false));
    }
    normalizedChannels++;
  }
  return {normalizedChannels, skippedRotated, skippedLarge};
}

export async function optimizeDocument(document, policy = visualPolicy) {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  await document.transform(dedup({propertyTypes: ['Texture']}));
  const before = await inspectVisuals(document), textureChanges = await boundTextures(document, policy);
  await document.transform(dedup({propertyTypes: ['Texture']}));
  const result = spatialBatch(document, policy);
  await result.document.transform(weld());
  const uvChanges = policy.normalizeRepeatedUVs ? normalizeRepeatedUVs(result.document, policy) : undefined;
  const after = await inspectVisuals(result.document);
  assert.equal(after.triangles, before.triangles, 'Render optimization must retain every triangle');
  assert.ok(after.primitives <= before.primitives, 'Spatial batching must not increase draw calls');
  assert.ok(after.decodedRGBABytes <= before.decodedRGBABytes, 'Texture optimization must not increase decode memory');
  for (let axis = 0; axis < 3; axis++) for (const end of ['min', 'max']) assert.ok(Math.abs(after.bounds[end][axis] - before.bounds[end][axis]) < 2e-5,
    `World geometry bounds changed during batching: ${JSON.stringify({before: before.bounds, after: after.bounds})}`);
  await result.document.transform(meshopt({encoder: MeshoptEncoder, level: policy.meshoptLevel ?? 'medium', quantizePosition: policy.positionBits,
    quantizeNormal: policy.normalBits, quantizeTexcoord: policy.texcoordBits, quantizeColor: policy.colorBits}));
  result.document.getRoot().listBuffers()[0].setURI('visual-0.bin');
  const encoded = await createMapIO().writeJSON(result.document, {format: Format.GLTF, basename: 'visual-0'});
  const gltf = Buffer.from(JSON.stringify(encoded.json)), files = new Map([['visual-0.gltf', gltf]]);
  for (const [name, bytes] of Object.entries(encoded.resources)) {
    if (!/^(visual-\d+(?:_\d+)?\.bin|texture-[a-f0-9]{24}\.webp)$/.test(name) || bytes.length > PAGES_LIMIT) throw new Error(`Invalid/oversized optimized resource ${name}`);
    files.set(name, Buffer.from(bytes));
  }
  if (gltf.length > 16 * 1024 * 1024) throw new Error('Optimized glTF exceeds loader JSON budget');
  const visual = {version: 2, files: ['visual-0.gltf'], fileHashes: {'visual-0.gltf': sha256(gltf)},
    bytes: [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0), textureBase,
    resources: [...files].filter(([name]) => name !== 'visual-0.gltf').map(([name, bytes]) => ({name, bytes: bytes.length, sha256: sha256(bytes)}))};
  const pack = buildTexturePack(visual, name => files.get(name));
  visual.texturePack = pack.manifest; files.set(pack.manifest.name, pack.binary);
  files.set('visual.json', Buffer.from(JSON.stringify(visual)));
  return {before, after, textureChanges, uvChanges, files, visual, geometryBreakdown: geometryBreakdown(encoded.json)};
}

export function buildTexturePack(visual, imageBytes) {
  const resources = visual.resources.filter(resource => resource.name.endsWith('.webp')).slice().sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (!resources.length || new Set(resources.map(resource => resource.name)).size !== resources.length) throw new Error('Texture pack needs unique image resources');
  let offset = 0; const images = [], parts = [];
  for (const resource of resources) {
    if (!/^texture-[a-f0-9]{24}\.webp$/.test(resource.name)) throw new Error('Invalid packed image filename');
    const bytes = imageBytes(resource.name);
    if (!bytes || !bytes.length || bytes.length !== resource.bytes || sha256(bytes) !== resource.sha256) throw new Error(`Packed image integrity mismatch: ${resource.name}`);
    const padding = (4 - offset % 4) % 4;
    if (padding) {parts.push(Buffer.alloc(padding)); offset += padding;}
    images.push({name: resource.name, offset, length: bytes.length}); parts.push(bytes); offset += bytes.length;
  }
  if (offset > PAGES_LIMIT) throw new Error('Texture pack exceeds the Cloudflare Pages 25 MiB limit');
  const binary = Buffer.concat(parts);
  return {binary, manifest: {name: 'textures.bin', bytes: binary.length, sha256: sha256(binary), images}};
}

export function optimizedMetadata(original, files, protectedAssets, stats, inputVisualSha256, toolHash, policy = visualPolicy) {
  const metadata = {...original, visualManifestSha256: sha256(files.get('visual.json'))};
  metadata.hashes = {...metadata.hashes, 'visual.json': metadata.visualManifestSha256};
  if (stats.visual.texturePack) metadata.hashes['textures.bin'] = stats.visual.texturePack.sha256;
  metadata.visual = {...metadata.visual, triangles: stats.after.triangles, batches: stats.after.primitives, files: stats.visual.files.length,
    bytes: stats.visual.bytes, textures: stats.after.textures};
  metadata.visualOptimization = {version: 1, policy, toolSha256: toolHash, inputVisualSha256,
    before: stats.before, after: {...stats.after, bytes: stats.visual.bytes}, sharedTextureBase: textureBase};
  if (stats.visual.texturePack) metadata.visualOptimization.packToolSha256 = toolHash;
  const assetBytes = [...files.values(), ...protectedAssets.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  metadata.outputBytes = assetBytes;
  for (let previous = -1; previous !== metadata.outputBytes;) {
    previous = metadata.outputBytes; metadata.outputBytes = assetBytes + Buffer.byteLength(JSON.stringify(metadata));
  }
  return Buffer.from(JSON.stringify(metadata));
}

async function readChunk(directory, io) {
  const visualBytes = fs.readFileSync(path.join(directory, 'visual.json')), visual = JSON.parse(visualBytes), combined = new Document();
  combined.setLogger(new Logger(Logger.Verbosity.ERROR));
  const scene = combined.createScene('Unoptimized chunk');
  for (const file of visual.files) {
    if (!/^visual-\d+\.gltf$/.test(file)) throw new Error('Invalid source glTF filename');
    const bytes = fs.readFileSync(path.join(directory, file));
    if (visual.fileHashes?.[file]) assert.equal(sha256(bytes), visual.fileHashes[file]);
    const source = await io.read(path.join(directory, file));
    for (const sourceScene of source.getRoot().listScenes()) {
      const children = sourceScene.listChildren(), copied = copyToDocument(combined, source, children);
      for (const node of children) scene.addChild(copied.get(node));
    }
  }
  for (const resource of visual.resources) {
    if (!/^(visual-\d+(?:_\d+)?\.bin|texture-[a-f0-9]{24}\.webp)$/.test(resource.name)) throw new Error('Invalid source resource');
    const bytes = fs.readFileSync(path.join(directory, resource.name)); assert.equal(bytes.length, resource.bytes); assert.equal(sha256(bytes), resource.sha256);
  }
  return {document: combined, visual, visualBytes};
}

export async function reconstructSourceChunk(root, chunk, metadata, io) {
  const directory = path.join(root, 'public/revamp/maps/dust2'), manifestBytes = fs.readFileSync(path.join(directory, 'visual.json')), manifest = JSON.parse(manifestBytes);
  assert.equal(sha256(manifestBytes), metadata.sourceVisualManifestSha256, 'Native render source identity changed');
  const part = newVisualPart('Reconstructed original native chunk'), bounds = sourceBounds(chunk.sourceMin, chunk.sourceMax, chunk.contextPaddingUnits);
  for (const resource of manifest.resources) {
    if (!/^(visual-\d+(?:_\d+)?\.bin|texture-[a-f0-9]{24}\.webp)$/.test(resource.name)) throw new Error('Invalid original render resource');
    const bytes = fs.readFileSync(path.join(directory, resource.name)); assert.equal(bytes.length, resource.bytes); assert.equal(sha256(bytes), resource.sha256);
  }
  for (const file of manifest.files) {
    if (!/^visual-\d+\.gltf$/.test(file)) throw new Error('Invalid original render sector');
    const bytes = fs.readFileSync(path.join(directory, file)); if (manifest.fileHashes?.[file]) assert.equal(sha256(bytes), manifest.fileHashes[file]);
    appendVisualSubset(part, await io.read(path.join(directory, file)), bounds);
  }
  stabilizeCollapsedNodes(part.document);
  const baseline = metadata.visualOptimization?.before;
  return {document: part.document, visual: {bytes: baseline?.bytes ?? metadata.visual.bytes},
    inputVisualSha256: metadata.visualOptimization?.inputVisualSha256 ?? metadata.visualManifestSha256,
    reconstructedSource: {fullVisualManifestSha256: sha256(manifestBytes), triangles: part.triangles}};
}

function validateProtected(directory, metadata, assets) {
  for (const [name, bytes] of assets) assert.equal(sha256(fs.readFileSync(path.join(directory, name))), sha256(bytes), `Protected asset changed: ${name}`);
  assert.equal(sha256(assets.get('collision.json')), metadata.collisionManifestSha256);
  assert.equal(sha256(assets.get('navigation.json')), metadata.navigationSha256);
}

export async function optimizeDuelVisuals({root = rootDefault, ids, apply = false, policy = visualPolicy, rebuildVisuals = false} = {}) {
  await MeshoptDecoder.ready; await MeshoptEncoder.ready;
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/range/duel/real-map-catalog.json')));
  const chunks = catalog.chunks.filter(chunk => !ids || ids.includes(chunk.id));
  if (!chunks.length || (ids && chunks.length !== ids.length)) throw new Error('Unknown/duplicate chunk ID');
  const outputRoot = path.resolve(root, 'public/revamp/maps/dust2/duel'), io = createMapIO(), toolHash = sha256(fs.readFileSync(fileURLToPath(import.meta.url))), summaries = [];
  for (const chunk of chunks) {
    if (!/^[a-z0-9-]+$/.test(chunk.id)) throw new Error('Invalid chunk ID');
    const directory = path.resolve(outputRoot, chunk.id), metadataFile = path.join(directory, 'chunk.json'), oldMetadataBytes = fs.readFileSync(metadataFile), metadata = JSON.parse(oldMetadataBytes);
    if (path.dirname(directory) !== outputRoot || metadata.id !== chunk.id) throw new Error('Invalid chunk output root/identity');
    const retained = [...protectedFiles, ...['radar.json','radar.png'].filter(name=>fs.existsSync(path.join(directory,name)))];
    const protectedAssets = new Map(retained.map(name => [name, fs.readFileSync(path.join(directory, name))]));
    validateProtected(directory, metadata, protectedAssets);
    if (metadata.visualOptimization && !rebuildVisuals) {
      if (stableJson(metadata.visualOptimization.policy) !== stableJson(policy) ||
          (metadata.visualOptimization.toolSha256 !== toolHash && metadata.visualOptimization.packToolSha256 !== toolHash))
        throw new Error(`Rebuild base chunk ${chunk.id} before changing optimization policy/tool; never accumulate lossy recompression.`);
      assert.equal(sha256(fs.readFileSync(path.join(directory, 'visual.json'))), metadata.visualManifestSha256);
      summaries.push({id: chunk.id, skipped: true, reason: 'Already optimized by this exact policy/tool', ...metadata.visualOptimization}); continue;
    }
    console.log(`${chunk.id}: inspecting and optimizing${apply ? ' (authorized apply)' : ' (dry run; no asset writes)'}...`);
    const source = rebuildVisuals ? await reconstructSourceChunk(root, chunk, metadata, io) : await readChunk(directory, io);
    if (source.visualBytes) assert.equal(sha256(source.visualBytes), metadata.visualManifestSha256);
    const result = await optimizeDocument(source.document, policy); result.before.bytes = source.visual.bytes;
    const updatedMetadata = optimizedMetadata(metadata, result.files, protectedAssets, result, source.inputVisualSha256 ?? sha256(source.visualBytes), toolHash, policy);
    // Validate the exact serialized asset through a separate glTF decode before
    // it can replace a working chunk, including texture/material associations.
    const roundtrip = await io.readJSON({json: JSON.parse(result.files.get('visual-0.gltf')), resources: Object.fromEntries([...result.files].filter(([name]) => !name.endsWith('.json') && !name.endsWith('.gltf')))});
    const roundtripStats = await inspectVisuals(roundtrip);
    assert.equal(roundtripStats.triangles, result.before.triangles);
    for (let axis = 0; axis < 3; axis++) for (const side of ['min', 'max']) assert.ok(Math.abs(roundtripStats.bounds[side][axis] - result.before.bounds[side][axis]) < .003, 'Encoded visual bounds drifted');
    const summary = {id: chunk.id, before: result.before, after: {...result.after, bytes: result.visual.bytes,
      geometryBytes: result.visual.resources.filter(resource => resource.name.endsWith('.bin')).reduce((sum, resource) => sum + resource.bytes, 0)},
      textureChanges: result.textureChanges, uvChanges: result.uvChanges, geometryBreakdown: result.geometryBreakdown,
      texturePack: {bytes: result.visual.texturePack.bytes, images: result.visual.texturePack.images.length}};
    if (apply) {
      assert.deepEqual(fs.readFileSync(metadataFile), oldMetadataBytes, 'Chunk changed while optimizing; retry after main edits finish');
      validateProtected(directory, metadata, protectedAssets);
      const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'spraylab-visual-opt-'));
      try {
        for (const [name, bytes] of result.files) fs.writeFileSync(path.join(staging, name), bytes);
        fs.writeFileSync(path.join(staging, 'chunk.json'), updatedMetadata);
        const shared = path.resolve(outputRoot, 'shared'); fs.mkdirSync(shared, {recursive: true});
        for (const [name, bytes] of result.files) {
          if (!name.endsWith('.webp')) continue;
          const target = path.join(shared, name);
          if (fs.existsSync(target)) assert.equal(sha256(fs.readFileSync(target)), sha256(bytes), 'Shared texture hash collision');
          else fs.copyFileSync(path.join(staging, name), target);
        }
        for (const name of result.files.keys()) if (name !== 'visual.json') fs.copyFileSync(path.join(staging, name), path.join(directory, name));
        fs.copyFileSync(path.join(staging, 'visual.json'), path.join(directory, 'visual.json'));
        fs.copyFileSync(path.join(staging, 'chunk.json'), metadataFile);
        const keep = new Set([...result.files.keys(), ...protectedAssets.keys(), 'chunk.json']);
        for (const name of fs.readdirSync(directory)) {
          if (keep.has(name) || !/^(visual-\d+\.(?:gltf|bin)|texture-[a-f0-9]{24}\.webp|textures\.bin)$/.test(name)) continue;
          const target = path.resolve(directory, name); if (path.dirname(target) !== directory) throw new Error('Unsafe visual cleanup'); fs.unlinkSync(target);
        }
        validateProtected(directory, metadata, protectedAssets);
        assert.equal(fs.readdirSync(directory).reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0), JSON.parse(updatedMetadata).outputBytes);
      } finally {
        // Only the exact mkdtemp directory and its known flat files are removed.
        if (!path.resolve(staging).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe temporary asset cleanup');
        for (const name of fs.readdirSync(staging)) fs.unlinkSync(path.join(staging, name)); fs.rmdirSync(staging);
      }
    }
    summaries.push(summary);
    console.log(JSON.stringify(summary));
  }
  return summaries;
}

export async function packDuelTextures({root = rootDefault, ids, apply = false} = {}) {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/range/duel/real-map-catalog.json')));
  const chunks = catalog.chunks.filter(chunk => !ids || ids.includes(chunk.id));
  if (!chunks.length || (ids && chunks.length !== ids.length)) throw new Error('Unknown/duplicate chunk ID');
  const outputRoot = path.resolve(root, 'public/revamp/maps/dust2/duel'), toolHash = sha256(fs.readFileSync(fileURLToPath(import.meta.url))), summaries = [];
  for (const chunk of chunks) {
    if (!/^[a-z0-9-]+$/.test(chunk.id)) throw new Error('Invalid chunk ID');
    const directory = path.resolve(outputRoot, chunk.id);
    if (path.dirname(directory) !== outputRoot) throw new Error('Invalid texture pack output root');
    const metadataPath = path.join(directory, 'chunk.json'), visualPath = path.join(directory, 'visual.json');
    const originalMetadata = fs.readFileSync(metadataPath), metadata = JSON.parse(originalMetadata), originalVisual = fs.readFileSync(visualPath), visual = JSON.parse(originalVisual);
    if (metadata.id !== chunk.id || !metadata.visualOptimization || visual.version !== 2) throw new Error('Optimize chunk visuals before packing images');
    assert.equal(sha256(originalVisual), metadata.visualManifestSha256);
    const protectedAssets = new Map(protectedFiles.map(name => [name, fs.readFileSync(path.join(directory, name))])); validateProtected(directory, metadata, protectedAssets);
    const pack = buildTexturePack(visual, name => fs.readFileSync(path.join(directory, name)));
    for (const file of visual.files) {
      if (!/^visual-\d+\.gltf$/.test(file)) throw new Error('Invalid texture-pack glTF name');
      const bytes = fs.readFileSync(path.join(directory, file)); assert.equal(sha256(bytes), visual.fileHashes[file]);
      for (const image of JSON.parse(bytes).images ?? []) if (!pack.manifest.images.some(entry => entry.name === image.uri)) throw new Error('Texture pack is missing a referenced glTF image');
    }
    visual.texturePack = pack.manifest;
    const visualBytes = Buffer.from(JSON.stringify(visual));
    metadata.visualManifestSha256 = sha256(visualBytes);
    metadata.hashes = {...metadata.hashes, 'visual.json': metadata.visualManifestSha256, 'textures.bin': pack.manifest.sha256};
    // Retain the original render tool provenance; this phase never recompresses
    // textures or touches glTF/geometry, and can safely migrate published assets.
    metadata.visualOptimization.packToolSha256 = toolHash;
    const fixedBytes = fs.readdirSync(directory).filter(name => !['chunk.json', 'visual.json', 'textures.bin'].includes(name))
      .reduce((sum, name) => {
        const stat = fs.statSync(path.join(directory, name)); if (!stat.isFile()) throw new Error('Unexpected directory in chunk assets'); return sum + stat.size;
      }, 0) + pack.binary.length + visualBytes.length;
    metadata.outputBytes = fixedBytes;
    for (let previous = -1; previous !== metadata.outputBytes;) {previous = metadata.outputBytes; metadata.outputBytes = fixedBytes + Buffer.byteLength(JSON.stringify(metadata));}
    const metadataBytes = Buffer.from(JSON.stringify(metadata));
    if (apply) {
      assert.deepEqual(fs.readFileSync(metadataPath), originalMetadata, 'Chunk metadata changed while packing');
      assert.deepEqual(fs.readFileSync(visualPath), originalVisual, 'Chunk visuals changed while packing');
      validateProtected(directory, metadata, protectedAssets);
      fs.writeFileSync(path.join(directory, 'textures.bin'), pack.binary); fs.writeFileSync(visualPath, visualBytes); fs.writeFileSync(metadataPath, metadataBytes);
      assert.equal(fs.readdirSync(directory).reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0), metadata.outputBytes);
    }
    const summary = {id: chunk.id, applied: apply, images: pack.manifest.images.length, packBytes: pack.binary.length,
      packSha256: pack.manifest.sha256, imageRequests: 1, outputBytes: metadata.outputBytes}; summaries.push(summary); console.log(JSON.stringify(summary));
  }
  return summaries;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) console.log('Usage: node tools/optimize-duel-visuals.mjs [--apply] [--pack-only|--rebuild-visuals] [chunk-id ...]\nDefault is a no-write dry run. --pack-only updates only image packs. --rebuild-visuals reconstructs original render subsets without touching collision/navigation; use before changing render policy.');
  else {
    const ids = args.filter(arg => !['--apply', '--pack-only', '--rebuild-visuals'].includes(arg)), options = {apply: args.includes('--apply'), rebuildVisuals: args.includes('--rebuild-visuals'), ids: ids.length ? ids : undefined};
    if (args.includes('--pack-only')) await packDuelTextures(options); else await optimizeDuelVisuals(options);
  }
}
