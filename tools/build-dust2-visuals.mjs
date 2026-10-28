import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Document, NodeIO, Format, Logger} from '@gltf-transform/core';
import {ALL_EXTENSIONS, EXTTextureWebP} from '@gltf-transform/extensions';
import {copyToDocument, dedup, meshopt, simplify, weld} from '@gltf-transform/functions';
import {MeshoptEncoder, MeshoptSimplifier} from 'meshoptimizer';
import {Box3, Matrix3, Matrix4, Vector3} from 'three';
import sharp from 'sharp';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function pruneDust2Assets(out, manifest) {
  const root = path.resolve(out), workspace = path.resolve('.');
  if (!root.startsWith(workspace + path.sep)) throw new Error('Map output must stay inside this workspace.');
  const keep = new Set([...manifest.files, ...manifest.resources.map(resource => resource.name)]);
  for (const name of fs.readdirSync(root)) {
    if (!/^(visual-\d+(?:_\d+)?\.(?:glb|gltf|bin)|texture-[a-f0-9]{24}\.webp|atlas\.webp)$/.test(name) || keep.has(name)) continue;
    const target = path.resolve(root, name);
    if (path.dirname(target) !== root) throw new Error('Invalid generated asset path.');
    fs.unlinkSync(target);
  }
}

export async function buildDust2Visuals(rawMap, out, visibility) {
  await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder': MeshoptEncoder});
  const original = await io.read(rawMap), output = new Document();
  output.setLogger(new Logger(Logger.Verbosity.ERROR));
  const buffer = output.createBuffer(), scene = output.createScene('Dust 2 native surfaces');
  const sourceMaterials = original.getRoot().listMaterials();
  const copied = copyToDocument(output, original, sourceMaterials);
  output.createExtension(EXTTextureWebP).setRequired(true);
  const colorTextures = new Set(sourceMaterials.map(m => copied.get(m.getBaseColorTexture())));
  const textureFiles = new Map();
  for (const texture of output.getRoot().listTextures()) {
    const bytes = texture.getImage();
    if (!bytes) throw new Error(`Missing native image: ${texture.getName()}`);
    // Retain readable wall/prop detail. Data maps need less resolution than albedo.
    const isColor = colorTextures.has(texture);
    const encoded = await sharp(bytes).resize({width: isColor ? 1024 : 256, height: isColor ? 1024 : 256, fit: 'inside', withoutEnlargement: true})
      .webp({quality: isColor ? 86 : 90, alphaQuality: 100}).toBuffer();
    const filename = `texture-${sha(encoded).slice(0, 24)}.webp`;
    texture.setImage(encoded).setMimeType('image/webp').setURI(filename);
    textureFiles.set(filename, encoded);
  }
  for (const source of sourceMaterials) {
    const material = copied.get(source), vmat = source.getExtras().vmat ?? {};
    const overlay = vmat.IntParams?.F_OVERLAY === 1 || /overlay/.test(vmat.ShaderName ?? '');
    // Exported static overlays sometimes lack their native blend declaration.
    if (overlay && material.getAlphaMode() === 'OPAQUE') material.setAlphaMode('BLEND');
    material.setExtras({nativeDust2: true, nativeMaterial: vmat.Name ?? source.getName(), nativeOverlay: overlay});
    material.setBaseColorFactor([1, 1, 1, 1]);
  }
  // Native prop instances often differ only by tint. Bake that exact linear
  // factor into vertex colors so their geometry can share one draw/material.
  await output.transform(dedup({propertyTypes: ['Texture']}));
  const materialGroups = new Map(), canonicalMaterials = [], ignoreName = new Set(['name']);
  for (const source of sourceMaterials) {
    const material = copied.get(source);
    let index = canonicalMaterials.findIndex(other => material.equals(other, ignoreName));
    if (index < 0) {index = canonicalMaterials.length; canonicalMaterials.push(material);}
    materialGroups.set(source, index);
  }
  const cells = new Map(), p = new Vector3(), n = new Vector3(), normalMatrix = new Matrix3(), box = new Box3();
  let kept = 0, removed = 0, sourceTriangles = 0;
  for (const node of original.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    // VRF's [Source y, Source z, Source x] is already in metres.
    const matrix = new Matrix4().makeRotationY(Math.PI / 2).multiply(new Matrix4().fromArray(node.getWorldMatrix()));
    normalMatrix.getNormalMatrix(matrix);
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial(), vmat = material?.getExtras().vmat ?? {};
      const name = `${mesh.getName()} ${vmat.Name ?? material?.getName() ?? ''}`.toLowerCase();
      // Filter authoring/light-volume helpers by material, not whole mixed meshes.
      if (/materials\/tools\/|blocklight|lightshaft|nav_attribute|soccer_ball|bomb_target|buyzone/.test(name) ||
          /csgo_effects/.test(vmat.ShaderName ?? '') || vmat.IntParams?.F_DEPTH_FEATHER === 1) {removed++; continue;}
      const position = primitive.getAttribute('POSITION'), indices = primitive.getIndices(), normals = primitive.getAttribute('NORMAL');
      if (!position || !indices || !material) {removed++; continue;}
      const pa = position.getArray(), ia = indices.getArray(), na = normals?.getArray();
      const uv0 = primitive.getAttribute('TEXCOORD_0')?.getArray(), uv1 = primitive.getAttribute('TEXCOORD_1')?.getArray();
      // Foliage COLOR_0 encodes wind weights, not a visible tint. Applying it as
      // glTF vertex color turns native green palms red/magenta.
      const colorAttribute = vmat.IntParams?.F_PAINT_VERTEX_COLORS === 1 ? primitive.getAttribute('COLOR_0') : null;
      const ca = colorAttribute?.getArray(), sourceColorSize = colorAttribute?.getElementSize() ?? 0;
      const colorSize = 4, factor = material.getBaseColorFactor();
      const colorScale = colorAttribute?.getNormalized() ? (ca instanceof Uint8Array ? 255 : ca instanceof Uint16Array ? 65535 : 1) : 1;
      box.makeEmpty();
      for (let i = 0; i < pa.length; i += 3) box.expandByPoint(p.fromArray(pa, i).applyMatrix4(matrix));
      // Only reject separate miniature skybox geometry below the playable world.
      // High roofs, trims, signs and doors remain: they frame real peek angles.
      if (box.max.y < -15) {removed++; continue;}
      for (let i = 0; i < ia.length; i += 3) {
        const verts = [ia[i], ia[i + 1], ia[i + 2]].map(index => p.fromArray(pa, index * 3).applyMatrix4(matrix).toArray());
        const cx = Math.floor((verts[0][0] + verts[1][0] + verts[2][0]) / 3 / 24), cz = Math.floor((verts[0][2] + verts[1][2] + verts[2][2]) / 3 / 24);
        const materialIndex = materialGroups.get(material), key = `${cx}:${cz}:${materialIndex}`;
        if (!cells.has(key)) cells.set(key, {positions: [], normals: [], uv0: [], uv1: [], colors: [], material: canonicalMaterials[materialIndex], uv1Present: true, colorSize, sector: `${cx}:${cz}`});
        const cell = cells.get(key);
        for (let corner = 0; corner < 3; corner++) {
          const index = ia[i + corner]; cell.positions.push(...verts[corner]);
          if (na) cell.normals.push(...n.fromArray(na, index * 3).applyMatrix3(normalMatrix).normalize().toArray());
          else cell.normals.push(0, 1, 0);
          cell.uv0.push(uv0?.[index * 2] ?? 0, uv0?.[index * 2 + 1] ?? 0);
          cell.uv1.push(uv1?.[index * 2] ?? 0, uv1?.[index * 2 + 1] ?? 0);
          for (let c = 0; c < 4; c++) cell.colors.push(factor[c] * (ca && c < sourceColorSize ? ca[index * sourceColorSize + c] / colorScale : 1));
        }
      }
      sourceTriangles += ia.length / 3; kept++;
    }
  }
  for (const [name, cell] of cells) {
    const accessor = (type, values) => output.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
    const primitive = output.createPrimitive().setAttribute('POSITION', accessor('VEC3', cell.positions)).setAttribute('NORMAL', accessor('VEC3', cell.normals))
      .setAttribute('TEXCOORD_0', accessor('VEC2', cell.uv0)).setMaterial(cell.material);
    if (cell.uv1Present) primitive.setAttribute('TEXCOORD_1', accessor('VEC2', cell.uv1));
    if (cell.colorSize) primitive.setAttribute('COLOR_0', accessor(`VEC${cell.colorSize}`, cell.colors));
    box.makeEmpty(); for (let i = 0; i < cell.positions.length; i += 3) box.expandByPoint(p.fromArray(cell.positions, i));
    const nativeMin = [box.min.x / .0254, -box.max.z / .0254, box.min.y / .0254];
    const nativeMax = [box.max.x / .0254, -box.min.z / .0254, box.max.y / .0254];
    const clusters = visibility.boxClusters(nativeMin, nativeMax);
    scene.addChild(output.createNode(name).setMesh(output.createMesh(name).addPrimitive(primitive)).setExtras({sector: cell.sector, nativeClusters: clusters}));
  }
  await output.transform(weld(), simplify({simplifier: MeshoptSimplifier, ratio: .5, error: .00015, lockBorder: true}), dedup());
  const nodes = scene.listChildren(), sectors = new Map();
  for (const node of nodes) {
    const sector = node.getExtras().sector;
    if (!sectors.has(sector)) sectors.set(sector, []);
    sectors.get(sector).push(node);
  }
  let triangles = 0;
  for (const mesh of output.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) triangles += primitive.getIndices().getCount() / 3;
  const files = [], hashes = [], resources = new Map();
  // External, content-addressed textures are shared across sectors rather than
  // embedded hundreds of times. Every geometry buffer stays below Pages' limit.
  const selectedSectors = [...sectors.values()];
  for (let start = 0; start < selectedSectors.length; start += 10) {
    const part = new Document(), partScene = part.createScene('Dust 2 sector');
    part.setLogger(new Logger(Logger.Verbosity.ERROR));
    const selected = selectedSectors.slice(start, start + 10).flat(), mapping = copyToDocument(part, output, selected);
    for (const node of selected) partScene.addChild(mapping.get(node));
    const filename = `visual-${files.length}.gltf`;
    part.getRoot().listBuffers()[0].setURI(filename.replace('.gltf', '.bin'));
    await part.transform(meshopt({encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: 16, quantizeColor: 12}));
    const result = await io.writeJSON(part, {format: Format.GLTF, basename: filename.replace('.gltf', '')});
    const jsonBytes = Buffer.from(JSON.stringify(result.json));
    fs.writeFileSync(`${out}/${filename}`, jsonBytes); files.push(filename); hashes.push(sha(jsonBytes));
    for (const [name, data] of Object.entries(result.resources)) {
      if (data.length > 25 * 1024 * 1024) throw new Error(`${name} exceeds Pages file limit`);
      fs.writeFileSync(`${out}/${name}`, data); resources.set(name, {name, bytes: data.length, sha256: sha(data)});
    }
  }
  const bytes = [...resources.values()].reduce((sum, r) => sum + r.bytes, 0) + files.reduce((sum, f) => sum + fs.statSync(`${out}/${f}`).size, 0);
  const manifest = {version: 2, files, fileHashes:Object.fromEntries(files.map((file,index)=>[file,hashes[index]])), bytes, resources: [...resources.values()]};
  fs.writeFileSync(`${out}/visual.json`, JSON.stringify(manifest));
  pruneDust2Assets(out, manifest);
  console.log(`Native surface visuals: ${(bytes / 1e6).toFixed(2)} MB, ${triangles} triangles, ${nodes.length} culled material batches in ${files.length} sectors.`);
  return {visualFiles: files, visualSha256: hashes, visualBytes: bytes, renderChunks: nodes.length, sourceTriangles, triangles,
    visualResources: manifest.resources, keptPrimitives: kept, removedDecorativePrimitives: removed,
    textureCount: textureFiles.size, materialCount: output.getRoot().listMaterials().length,
    geometrySimplification: 'Visual-only Meshoptimizer ratio 0.5, error 0.00015, locked sector/UV borders; native UVs, PBR maps, alpha modes, vertex colors, roofs and overlays preserved.'};
}
