import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {Document, NodeIO, Logger} from '@gltf-transform/core';
import {ALL_EXTENSIONS, EXTMeshoptCompression, KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {mergeDocuments, dequantize, flatten, join, prune, dedup, unlit, unpartition, weld, compactPrimitive, reorder} from '@gltf-transform/functions';
import {MeshoptDecoder, MeshoptEncoder} from 'meshoptimizer';
import {MeshoptSimplifier} from 'meshoptimizer-lod';
import sharp from 'sharp';
import {buildMapManifests} from './build-map-manifests.mjs';

// Distant visual approximation only: no collision, navigation or active-map edits.
// Simplification selects existing vertices; there is no centering, rescaling,
// position quantization or invented geometry. Transparent detail is omitted.
export const contextPolicy = Object.freeze({ratio:.025,error:.006,maxErrorMeters:.16,colorGain:.9,tileSize:128,gutter:4,
  targetBytes:3_000_000,maxBytes:5_000_000});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export const srgbToLinear=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
function wrapIndex(index,size,mode) {
  if(mode===33071)return Math.max(0,Math.min(size-1,index));
  const period=mode===33648?size*2:size,wrapped=((index%period)+period)%period;
  return mode===33648&&wrapped>=size?period-1-wrapped:wrapped;
}
export function sampleDiffuse(image,uv,{offset=[0,0],scale=[1,1],rotation=0,wrapS=10497,wrapT=10497}={}) {
  const cosine=Math.cos(rotation),sine=Math.sin(rotation),u=uv[0]*scale[0],v=uv[1]*scale[1];
  const x=(offset[0]+u*cosine-v*sine)*image.width-.5,y=(offset[1]+u*sine+v*cosine)*image.height-.5;
  const left=Math.floor(x),top=Math.floor(y),fx=x-left,fy=y-top,result=[0,0,0];
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++) {
    const weight=(dx?fx:1-fx)*(dy?fy:1-fy),at=(wrapIndex(top+dy,image.height,wrapT)*image.width+wrapIndex(left+dx,image.width,wrapS))*4;
    for(let c=0;c<3;c++)result[c]+=srgbToLinear(image.data[at+c]/255)*weight;
  }
  return result;
}

export async function bakeContextColors(document) {
  const images=new Map(),extension=document.createExtension(KHRMaterialsUnlit);
  const shared=document.createMaterial('distant-linear-vertex-color').setBaseColorFactor([1,1,1,1]).setDoubleSided(true)
    .setExtension('KHR_materials_unlit',extension.createUnlit());
  for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()) {
    const material=primitive.getMaterial(),texture=material?.getBaseColorTexture(),info=material?.getBaseColorTextureInfo();
    let image;
    if(texture) {
      if(!images.has(texture)) {
        const {data,info:decoded}=await sharp(texture.getImage()).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
        images.set(texture,{data,width:decoded.width,height:decoded.height});
      }
      image=images.get(texture);
    }
    const transform=info?.getExtension('KHR_texture_transform'),factor=material?.getBaseColorFactor()??[1,1,1,1];
    const uv=primitive.getAttribute('TEXCOORD_'+(transform?.getTexCoord()??info?.getTexCoord()??0));
    if(image&&!uv)throw Error('Native diffuse texture has no matching UV attribute');
    const options={offset:transform?.getOffset(),scale:transform?.getScale(),rotation:transform?.getRotation(),
      wrapS:info?.getWrapS(),wrapT:info?.getWrapT()};
    const positions=primitive.getAttribute('POSITION'),previous=primitive.getAttribute('COLOR_0'),colors=new Uint8Array(positions.getCount()*3),uvValue=[],vertex=[];
    for(let i=0;i<positions.getCount();i++) {
      const sampled=image?sampleDiffuse(image,uv.getElement(i,uvValue),options):[1,1,1];
      if(previous)previous.getElement(i,vertex);
      for(let c=0;c<3;c++)colors[i*3+c]=Math.round(255*Math.max(0,Math.min(1,sampled[c]*factor[c]*(previous?vertex[c]:1)))*contextPolicy.colorGain);
    }
    for(const semantic of primitive.listSemantics())if(semantic!=='POSITION')primitive.setAttribute(semantic,null);
    primitive.setAttribute('COLOR_0',document.createAccessor().setType('VEC3').setNormalized(true).setArray(colors).setBuffer(positions.getBuffer()));
    primitive.setMaterial(shared);
  }
  await document.transform(prune(),dedup(),join(),prune(),unpartition());
}

/** One repeat-aware atlas keeps native UVs and texture detail without hundreds
 * of materials/draw calls. Runtime samples each padded tile independently. */
export async function bakeContextAtlas(document) {
  const primitives=document.getRoot().listMeshes().flatMap(mesh=>mesh.listPrimitives());
  const textures=[...new Set(primitives.map(p=>p.getMaterial()?.getBaseColorTexture()).filter(Boolean))];
  const grid=2**Math.ceil(Math.log2(Math.ceil(Math.sqrt(textures.length+1)))),size=grid*contextPolicy.tileSize;
  if(size>2048)throw Error('Distant context atlas exceeds its 2048px budget');
  const inner=contextPolicy.tileSize-contextPolicy.gutter*2,tiles=[];
  const solid=Buffer.alloc(inner*inner*4,255);
  for(const [index,texture] of [undefined,...textures].entries()) {
    const pixels=texture?await sharp(texture.getImage()).toColourspace('srgb').ensureAlpha().resize(inner,inner,{fit:'fill'}).raw().toBuffer():solid;
    const padded=Buffer.alloc(contextPolicy.tileSize**2*4);
    for(let y=0;y<contextPolicy.tileSize;y++)for(let x=0;x<contextPolicy.tileSize;x++) {
      const sx=((x-contextPolicy.gutter)%inner+inner)%inner,sy=((y-contextPolicy.gutter)%inner+inner)%inner;
      pixels.copy(padded,(y*contextPolicy.tileSize+x)*4,(sy*inner+sx)*4,(sy*inner+sx)*4+4);
    }
    tiles.push({input:padded,raw:{width:contextPolicy.tileSize,height:contextPolicy.tileSize,channels:4},
      left:index%grid*contextPolicy.tileSize,top:Math.floor(index/grid)*contextPolicy.tileSize});
  }
  const atlasImage=await sharp({create:{width:size,height:size,channels:4,background:'#ffffff'}}).composite(tiles).webp({quality:84}).toBuffer();
  const atlas=document.createTexture('native-context-diffuse-atlas').setImage(atlasImage).setMimeType('image/webp');
  const extension=document.createExtension(KHRMaterialsUnlit);
  const shared=document.createMaterial('distant-native-texture-atlas').setBaseColorTexture(atlas).setDoubleSided(true)
    .setExtension('KHR_materials_unlit',extension.createUnlit()).setExtras({duelContextAtlas:{size,tileSize:contextPolicy.tileSize,gutter:contextPolicy.gutter}});
  const wrapping=mode=>mode===33071?1:mode===33648?2:0;
  for(const primitive of primitives) {
    const material=primitive.getMaterial(),texture=material?.getBaseColorTexture(),info=material?.getBaseColorTextureInfo();
    const transform=info?.getExtension('KHR_texture_transform');
    const uv=primitive.getAttribute('TEXCOORD_'+(transform?.getTexCoord()??info?.getTexCoord()??0));
    if(texture&&!uv)throw Error('Missing native UVs for context texture');
    const factor=material?.getBaseColorFactor()??[1,1,1,1],positions=primitive.getAttribute('POSITION'),previous=primitive.getAttribute('COLOR_0');
    const coordinates=new Float32Array(positions.getCount()*2),tile=new Float32Array(positions.getCount()*4),colors=new Uint8Array(positions.getCount()*3);
    const index=texture?textures.indexOf(texture)+1:0,offset=transform?.getOffset()??[0,0],scale=transform?.getScale()??[1,1],angle=transform?.getRotation()??0;
    const c=Math.cos(angle),s=Math.sin(angle),value=[],color=[];
    for(let i=0;i<positions.getCount();i++) {
      if(uv)uv.getElement(i,value);else {value[0]=0;value[1]=0;}
      const u=value[0]*scale[0],v=value[1]*scale[1];
      coordinates.set([offset[0]+u*c-v*s,offset[1]+u*s+v*c],i*2);
      tile.set([index%grid*contextPolicy.tileSize/size,Math.floor(index/grid)*contextPolicy.tileSize/size,
        wrapping(info?.getWrapS()),wrapping(info?.getWrapT())],i*4);
      if(previous)previous.getElement(i,color);
      for(let k=0;k<3;k++)colors[i*3+k]=Math.round(255*Math.max(0,Math.min(1,factor[k]*(previous?color[k]:1)*contextPolicy.colorGain)));
    }
    for(const semantic of primitive.listSemantics())if(semantic!=='POSITION')primitive.setAttribute(semantic,null);
    const accessor=(type,array)=>document.createAccessor().setType(type).setArray(array).setBuffer(positions.getBuffer());
    primitive.setAttribute('TEXCOORD_0',accessor('VEC2',coordinates));
    primitive.setAttribute('_CONTEXT_TILE',accessor('VEC4',tile));
    primitive.setAttribute('COLOR_0',accessor('VEC3',colors).setNormalized(true));
    primitive.setMaterial(shared);
  }
  await document.transform(prune(),dedup(),join(),prune(),unpartition());
  return {size,tiles:textures.length+1,bytes:atlasImage.length};
}

export async function buildDuelContext(root=process.cwd()) {
  await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready,MeshoptSimplifier.ready]);
  const base=path.join(root,'public/revamp/maps/dust2'),out=path.join(base,'duel/context');
  const manifestBytes=await fs.readFile(path.join(base,'visual.json')),manifest=JSON.parse(manifestBytes);
  if(manifest.version!==2)throw Error('Expected full native visual manifest v2');
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
  const document=new Document();document.setLogger(new Logger(Logger.Verbosity.ERROR));
  let sourceTriangles=0;
  for(const file of manifest.files) {
    if(!/^visual-\d+\.gltf$/.test(file))throw Error('Unexpected native visual filename');
    const source=await io.read(path.join(base,file));
    for(const mesh of source.getRoot().listMeshes())for(const primitive of [...mesh.listPrimitives()]) {
      sourceTriangles+=(primitive.getIndices()?.getCount()??primitive.getAttribute('POSITION').getCount())/3;
      if(primitive.getMaterial()?.getAlphaMode()!=='OPAQUE')mesh.removePrimitive(primitive);
    }
    mergeDocuments(document,source);
    console.log(`Read native ${file}`);
  }
  const scene=document.createScene('dust2-distant-context');
  for(const original of [...document.getRoot().listScenes()])if(original!==scene) {
    for(const child of [...original.listChildren()]){original.removeChild(child);scene.addChild(child);}
    original.dispose();
  }
  document.getRoot().setDefaultScene(scene);
  for(const property of [...document.getRoot().listNodes(),...document.getRoot().listMeshes(),...document.getRoot().listMaterials()])property.setExtras({});
  await document.transform(dequantize(),unlit(),dedup(),flatten(),join());
  // Drop lighting-only attributes, but retain UV seams and native texture
  // topology. Position-only welding previously smeared unrelated wall UVs.
  for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()) {
    for(const semantic of primitive.listSemantics())if(semantic!=='POSITION'&&semantic!=='COLOR_0'&&!semantic.startsWith('TEXCOORD_'))primitive.setAttribute(semantic,null);
  }
  await document.transform(weld());
  for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()) {
    const positions=primitive.getAttribute('POSITION');
    const scale=MeshoptSimplifier.getScale(positions.getArray(),3);
    const indices=Uint32Array.from(primitive.getIndices().getArray()),error=Math.min(contextPolicy.error,contextPolicy.maxErrorMeters/Math.max(scale,.01));
    const info=primitive.getMaterial()?.getBaseColorTextureInfo(),transform=info?.getExtension('KHR_texture_transform');
    const uv=primitive.getAttribute('TEXCOORD_'+(transform?.getTexCoord()??info?.getTexCoord()??0));
    const target=Math.floor(indices.length*contextPolicy.ratio/3)*3;
    const [simplified]=uv?MeshoptSimplifier.simplifyWithAttributes(indices,positions.getArray(),3,uv.getArray(),2,[.02,.02],null,target,error,['Permissive','Prune'])
      :MeshoptSimplifier.simplify(indices,positions.getArray(),3,target,error,['Permissive','Prune']);
    primitive.getIndices().setArray(simplified);compactPrimitive(primitive);
  }
  await document.transform(prune());
  const atlas=await bakeContextAtlas(document);
  await document.transform(dedup(),prune(),unpartition(),reorder({encoder:MeshoptEncoder,target:'size'}));
  for(const property of [...document.getRoot().listNodes(),...document.getRoot().listMeshes()])property.setExtras({});
  document.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
  const binary=await io.writeBinary(document),compressed=gzipSync(binary,{level:9});
  if(binary.length>contextPolicy.maxBytes)throw Error(`Context ${binary.length} bytes (${compressed.length} gzip) exceeds hard 5 MB budget; nothing written`);
  if(compressed.length>contextPolicy.targetBytes)throw Error(`Context download exceeds the 3 MB delivery budget; nothing written`);
  let triangles=0;
  for(const mesh of document.getRoot().listMeshes())for(const primitive of mesh.listPrimitives())triangles+=primitive.getIndices().getCount()/3;
  const objectHash=hash(compressed),objectName=objectHash+'.bin';
  const delivery={url:'/maps/dust2/duel/objects/'+objectName,bytes:compressed.length,sha256:objectHash,
    decodedBytes:binary.length,decodedSha256:hash(binary),encoding:'gzip'};
  const metadata={version:2,map:'dust2',visualOnly:true,delivery,sourceVisualManifestSha256:hash(manifestBytes),
    coordinateSystem:'Original native GLTF world metres; x=Source.x*.0254, y=Source.z*.0254, z=-Source.y*.0254; no recentering',
    policy:contextPolicy,atlas,sourceTriangles,triangles,meshes:document.getRoot().listMeshes().length,
    textures:document.getRoot().listTextures().length,materials:document.getRoot().listMaterials().length,
    file:'context.glb',bytes:binary.length,gzipBytes:compressed.length,sha256:hash(binary),
    notes:'Native visual-only LOD with preserved UV seams, source diffuse textures in a padded repeat-aware atlas, base/vertex factors and bounded absolute simplification error. One unlit atlas material. Runtime subtracts padded chunk renderBounds. Never collision or gameplay geometry.'};
  await fs.mkdir(out,{recursive:true});
  await fs.mkdir(path.join(base,'duel/objects'),{recursive:true});
  await fs.writeFile(path.join(base,'duel/objects',objectName),compressed);
  await fs.writeFile(path.join(out,'context.glb'),binary);
  await fs.writeFile(path.join(out,'context.json'),JSON.stringify(metadata,null,2)+'\n');
  await buildMapManifests(root);
  console.log(JSON.stringify(metadata));return metadata;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await buildDuelContext();
}
