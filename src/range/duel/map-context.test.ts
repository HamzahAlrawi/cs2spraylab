import {describe,it,expect,vi} from 'vitest';
import {BoxGeometry,BufferAttribute,Group,Mesh,MeshBasicMaterial,Vector3,ShaderLib,Texture} from 'three';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {MapContextCache,contextContains,type ContextBounds} from './map-context';
import {validDeliveredAsset} from '../prefire/asset-delivery';

const bounds:ContextBounds={min:[-70.358,-14.6304,-91.948],max:[.508,24.384,-36.322]};
function fixture() {
  const scene=new Group(),material=new MeshBasicMaterial({vertexColors:true}),geometry=new BoxGeometry(2,3,4);
  geometry.setAttribute('color',new BufferAttribute(new Uint8Array(geometry.attributes.position.count*3).fill(102),3,true));
  const mesh=new Mesh(geometry,material);mesh.position.set(-48,6,-62);scene.add(mesh);
  return {scene,mesh,material,geometry};
}
describe('shared visual-only native context',()=>{
  it('shares one vertex-color decode/geometry, preserves native transforms and isolates clipping materials',async()=>{
    const f=fixture(),loader=vi.fn(async()=>f.scene),cache=new MapContextCache(loader);
    const [a,b]=await Promise.all([cache.load(),cache.load()]);
    const x=a.root.children[0] as Mesh,y=b.root.children[0] as Mesh;
    expect(loader).toHaveBeenCalledOnce();expect(x.geometry).toBe(f.geometry);expect(y.geometry).toBe(x.geometry);
    expect(x.material).not.toBe(y.material);expect(Array.isArray(x.material)).toBe(false);
    expect((x.material as MeshBasicMaterial).map).toBeNull();expect((x.material as MeshBasicMaterial).vertexColors).toBe(true);
    expect(x.geometry.attributes.color).toBe(f.geometry.attributes.color);
    expect(x.position.toArray()).toEqual([-48,6,-62]);expect(a.root.scale.toArray()).toEqual([1,1,1]);
    expect(x.matrixAutoUpdate).toBe(false);expect(x.matrixWorldAutoUpdate).toBe(false);
    const world=x.matrixWorld.clone();a.root.updateMatrixWorld(true);
    expect(x.matrixWorld).toEqual(world);
    expect(x.userData.nativeContext).toBe(true);expect(a.root.userData.nativeContext).toBe(true);
    expect(x.castShadow).toBe(false);expect(x.receiveShadow).toBe(false);
    const hits:unknown[]=[];x.raycast({} as never,hits as never);expect(hits).toEqual([]);
    const parent=new Group();a.attach(parent,bounds);expect(parent.children).toContain(a.root);
    expect(a.root.visible).toBe(true);expect(b.root.visible).toBe(false);
    expect(x.visible).toBe(false);expect(x.frustumCulled).toBe(true);
    a.attach(parent,{min:[0,0,0],max:[1,1,1]});expect(x.visible).toBe(true);
    a.attach(parent,bounds);
    const shader={vertexShader:ShaderLib.basic.vertexShader,fragmentShader:ShaderLib.basic.fragmentShader,uniforms:{}};
    (x.material as MeshBasicMaterial).onBeforeCompile(shader as never,{} as never);
    expect(shader.vertexShader).toContain('(modelMatrix*vec4(transformed,1.0)).xyz');
    expect(shader.fragmentShader).toContain('greaterThanEqual(duelContextWorld,duelContextMin)');
    expect((shader.uniforms as any).duelContextMin.value.toArray()).toEqual(bounds.min);
    expect((shader.uniforms as any).duelContextMax.value.toArray()).toEqual(bounds.max);
    expect((x.material as MeshBasicMaterial).polygonOffset).toBe(true);
    expect(f.material.onBeforeCompile.toString()).not.toContain('duelContextWorld');
    await expect(cache.dispose()).rejects.toThrow('leases');
    const geometryDispose=vi.spyOn(f.geometry,'dispose'),materialDispose=vi.spyOn(f.material,'dispose');
    a.dispose();a.dispose();expect(parent.children).toEqual([]);expect(geometryDispose).not.toHaveBeenCalled();
    b.dispose();await cache.dispose();expect(geometryDispose).toHaveBeenCalledOnce();expect(materialDispose).toHaveBeenCalledOnce();
  });
  it('subtracts the padded native 3D box, not the smaller playable chunk or full map',()=>{
    expect(contextContains(new Vector3(-48,6,-62),bounds)).toBe(true);
    expect(contextContains(new Vector3(-70.358,6,-62),bounds)).toBe(true);
    for(const point of [new Vector3(-70.359,6,-62),new Vector3(.509,6,-62),
      new Vector3(-48,25,-62),new Vector3(-48,-15,-62),new Vector3(-48,6,-92),new Vector3(-48,6,-36)]) {
      expect(contextContains(point,bounds)).toBe(false);
    }
    expect(()=>contextContains(new Vector3(),{min:[0,0,0],max:[NaN,1,1]})).toThrow('renderBounds');
  });
  it('samples a shared atlas per native repeating tile with explicit derivatives and distinct shader caching',async()=>{
    const f=fixture();f.material.map=new Texture();f.material.userData.duelContextAtlas={size:2048,tileSize:128,gutter:4};
    const cache=new MapContextCache(async()=>f.scene),lease=await cache.load();lease.attach(new Group(),bounds);
    const material=(lease.root.children[0] as Mesh).material as MeshBasicMaterial;
    const shader={vertexShader:ShaderLib.basic.vertexShader,fragmentShader:ShaderLib.basic.fragmentShader,uniforms:{}};
    material.onBeforeCompile(shader as never,{} as never);
    expect(shader.vertexShader).toContain('attribute vec4 _context_tile');
    expect(shader.fragmentShader).toContain('textureGrad(map,contextAtlasUV');
    expect(shader.fragmentShader).toContain('fract(vMapUv)');
    expect(shader.fragmentShader).toContain('duelContextTile.z>1.5');
    expect(shader.fragmentShader).toContain('dFdx(vMapUv)*contextInner');
    expect((shader.uniforms as any).duelContextAtlas.value.toArray()).toEqual([2048,128,4]);
    expect(material.customProgramCacheKey()).toBe('duel-distant-context-atlas-v2');
    lease.dispose();await cache.dispose();
  });
  it('rejects transformed parents and disposed attachments instead of shifting the map',async()=>{
    const cache=new MapContextCache(async()=>fixture().scene),lease=await cache.load(),parent=new Group();
    parent.position.x=10;expect(()=>lease.attach(parent,bounds)).toThrow('world coordinates');
    lease.dispose();expect(()=>lease.attach(new Group(),bounds)).toThrow('disposed');await cache.dispose();
  });
  it('retries failed loads and aborts leases without poisoning reusable cached assets',async()=>{
    const loader=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(fixture().scene),cache=new MapContextCache(loader);
    await expect(cache.load()).rejects.toThrow('offline');
    const controller=new AbortController();controller.abort();await expect(cache.load(controller.signal)).rejects.toThrow();
    const lease=await cache.load();expect(loader).toHaveBeenCalledTimes(2);lease.dispose();await cache.dispose();
  });
  it('does not release a pending asset underneath a concurrent lease',async()=>{
    const f=fixture();let resolve!:(scene:Group)=>void;
    const cache=new MapContextCache(()=>new Promise<Group>(done=>{resolve=done;}));
    const lease=cache.load(),failure=expect(lease).rejects.toThrow();await Promise.resolve();
    const clearing=cache.dispose();resolve(f.scene);await failure;await clearing;
  });
  it('cancels one waiter promptly without aborting another chunk sharing the download',async()=>{
    const f=fixture();let resolve!:(scene:Group)=>void,downloadSignal!:AbortSignal;
    const cache=new MapContextCache(signal=>{downloadSignal=signal;return new Promise<Group>(done=>{resolve=done;});});
    const controller=new AbortController(),a=cache.load(controller.signal),b=cache.load();await Promise.resolve();
    controller.abort();await expect(a).rejects.toMatchObject({name:'AbortError'});
    expect(downloadSignal.aborted).toBe(false);resolve(f.scene);
    const lease=await b;lease.dispose();await cache.dispose();
  });
  it('aborts the shared download when every waiting chunk cancels and releases late decode results',async()=>{
    const f=fixture(),dispose=vi.spyOn(f.geometry,'dispose');let resolve!:(scene:Group)=>void,downloadSignal!:AbortSignal;
    const cache=new MapContextCache(signal=>{downloadSignal=signal;return new Promise<Group>(done=>{resolve=done;});});
    const controller=new AbortController(),pending=cache.load(controller.signal);await Promise.resolve();
    controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
    expect(downloadSignal.aborted).toBe(true);resolve(f.scene);
    await new Promise(done=>setTimeout(done,0));expect(dispose).toHaveBeenCalledOnce();await cache.dispose();
  });
});

const asset='public/revamp/maps/dust2/duel/context/';
it.skipIf(!existsSync(asset+'context.json'))('pins the generated native visual-only package within the delivery budget',async()=>{
  const metadata=JSON.parse(readFileSync(asset+'context.json','utf8')),binary=readFileSync(asset+'context.glb');
  expect(metadata.visualOnly).toBe(true);expect(binary.length).toBe(metadata.bytes);
  expect(binary.length).toBeLessThanOrEqual(5_000_000);expect(gzipSync(binary,{level:9}).length).toBeLessThanOrEqual(3_000_000);
  expect(createHash('sha256').update(binary).digest('hex')).toBe(metadata.sha256);
  expect(validDeliveredAsset(metadata.delivery)).toBe(true);
  const delivered=readFileSync('public/revamp'+metadata.delivery.url);
  expect(delivered.length).toBe(metadata.delivery.bytes);
  expect(createHash('sha256').update(delivered).digest('hex')).toBe(metadata.delivery.sha256);
  expect(metadata.triangles).toBeLessThan(metadata.sourceTriangles/10);
  expect(metadata.meshes).toBe(1);expect(metadata.materials).toBe(1);expect(metadata.textures).toBe(1);
  expect(metadata.version).toBe(2);expect(metadata.atlas.size).toBeLessThanOrEqual(2048);
  expect(binary.readUInt32LE(0)).toBe(0x46546c67);
  const {NodeIO}=await import('@gltf-transform/core'),{ALL_EXTENSIONS}=await import('@gltf-transform/extensions');
  const {MeshoptDecoder}=await import('meshoptimizer');await MeshoptDecoder.ready;
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
  const document=await io.readBinary(binary),scenes=document.getRoot().listScenes();
  expect(scenes).toHaveLength(1);expect(document.getRoot().getDefaultScene()).toBe(scenes[0]);
  expect(document.getRoot().listTextures()).toHaveLength(1);expect(document.getRoot().listMaterials()).toHaveLength(1);
  expect(document.getRoot().listMaterials()[0].getExtras()).toMatchObject({duelContextAtlas:{size:2048,tileSize:128,gutter:4}});
  expect(document.getRoot().listMaterials()[0].getExtension('KHR_materials_unlit')).toBeTruthy();
  let primitives=0;
  let visibleTriangles=0;scenes[0].traverse(node=>{
    for(const primitive of node.getMesh()?.listPrimitives()??[]) {
      primitives++;visibleTriangles+=primitive.getIndices()!.getCount()/3;
      expect(primitive.listSemantics().sort()).toEqual(['COLOR_0','POSITION','TEXCOORD_0','_CONTEXT_TILE']);
      const color=primitive.getAttribute('COLOR_0')!,value:number[]=[];
      expect(color.getNormalized()).toBe(true);
      let darkest=1,brightest=0;
      for(let i=0;i<color.getCount();i++)for(const c of color.getElement(i,value)) {
        darkest=Math.min(darkest,c);brightest=Math.max(brightest,c);
      }
      expect(darkest).toBeGreaterThanOrEqual(0);expect(brightest).toBeLessThanOrEqual(.9+1/255);
      expect(brightest-darkest).toBeGreaterThan(.1);
    }
  });
  expect(visibleTriangles).toBe(metadata.triangles);expect(primitives).toBe(1);
});

const baker=()=>import(new URL('../../../tools/build-duel-context.mjs',import.meta.url).href);
describe('native diffuse vertex-color bake',()=>{
  it('preserves native transformed UVs, tile wrapping and material factors in a single shared atlas',async()=>{
    const {bakeContextAtlas}=await baker(),{Document}=await import('@gltf-transform/core');
    const {KHRTextureTransform}=await import('@gltf-transform/extensions'),{default:sharp}=await import('sharp');
    const document=new Document(),buffer=document.createBuffer(),scene=document.createScene();
    const pixels=await sharp({create:{width:2,height:2,channels:4,background:'#c86432'}}).png().toBuffer();
    const texture=document.createTexture().setImage(pixels).setMimeType('image/png');
    const material=document.createMaterial().setBaseColorFactor([.5,.25,.75,1]).setBaseColorTexture(texture);
    const transform=document.createExtension(KHRTextureTransform).createTransform().setTexCoord(1)
      .setScale([.5,1]).setRotation(Math.PI/2).setOffset([1,2]);
    material.getBaseColorTextureInfo()!.setExtension('KHR_texture_transform',transform).setWrapS(33071).setWrapT(33648);
    const positions=new Float32Array([0,0,0,1,0,0,0,1,0]);
    const accessor=(type:'VEC2'|'VEC3'|'SCALAR',array:Float32Array|Uint16Array)=>document.createAccessor().setType(type).setBuffer(buffer).setArray(array);
    const primitive=document.createPrimitive().setMaterial(material).setIndices(accessor('SCALAR',new Uint16Array([0,1,2])))
      .setAttribute('POSITION',accessor('VEC3',positions))
      .setAttribute('TEXCOORD_0',accessor('VEC2',new Float32Array([0,0,0,0,0,0])))
      .setAttribute('TEXCOORD_1',accessor('VEC2',new Float32Array([1.5,.5,1.5,.5,1.5,.5])))
      .setAttribute('COLOR_0',accessor('VEC3',new Float32Array([.4,.5,1,.4,.5,1,.4,.5,1])));
    scene.addChild(document.createNode().setMesh(document.createMesh().addPrimitive(primitive)));
    expect(await bakeContextAtlas(document)).toMatchObject({size:256,tiles:2});
    const result=document.getRoot().listMeshes()[0].listPrimitives()[0],value:number[]=[];
    expect(result.getAttribute('POSITION')!.getArray()).toEqual(positions);
    result.getAttribute('TEXCOORD_0')!.getElement(0,value);expect(value).toEqual([.5,2.75]);
    result.getAttribute('_CONTEXT_TILE')!.getElement(0,value);expect(value).toEqual([.5,0,1,2]);
    value.length=0;result.getAttribute('COLOR_0')!.getElement(0,value);expect(value).toEqual([46/255,29/255,172/255]);
    expect(document.getRoot().listTextures()).toHaveLength(1);expect(document.getRoot().listMaterials()).toHaveLength(1);
    const atlas=result.getMaterial()!.getBaseColorTexture()!;
    expect(atlas.getMimeType()).toBe('image/webp');expect((await sharp(atlas.getImage()!).metadata()).width).toBe(256);
  });
  it('decodes sRGB into linear light rather than applying a second display gamma',async()=>{
    const {srgbToLinear}=await baker();
    expect(srgbToLinear(0)).toBe(0);expect(srgbToLinear(1)).toBe(1);
    expect(srgbToLinear(.5)).toBeCloseTo(.21404114,7);
    expect(srgbToLinear(.04045)).toBeCloseTo(.0031308,7);
  });
  it('samples UV offset/scale/rotation and repeat, clamp and mirrored wrapping',async()=>{
    const {sampleDiffuse}=await baker(),image={width:2,height:2,data:new Uint8Array([
      255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255])};
    expect(sampleDiffuse(image,[.25,.25])).toEqual([1,0,0]);
    expect(sampleDiffuse(image,[1.25,.25])).toEqual([1,0,0]);
    expect(sampleDiffuse(image,[1.25,.25],{wrapS:33071})).toEqual([0,1,0]);
    expect(sampleDiffuse(image,[1.25,.25],{wrapS:33648})).toEqual([0,1,0]);
    expect(sampleDiffuse(image,[.5,.5],{scale:[.5,.5]})).toEqual([1,0,0]);
    const rotated=sampleDiffuse(image,[.25,.25],{offset:[1,0],rotation:Math.PI/2});
    expect(rotated[0]).toBeCloseTo(0);expect(rotated[1]).toBeCloseTo(1);expect(rotated[2]).toBeCloseTo(0);
    expect(sampleDiffuse(image,[.5,.25])).toEqual([.5,.5,0]);
  });
  it('bakes base/vertex factors and transformed UV-set override, without moving positions',async()=>{
    const {bakeContextColors}=await baker(),{Document}=await import('@gltf-transform/core');
    const {KHRTextureTransform}=await import('@gltf-transform/extensions'),{default:sharp}=await import('sharp');
    const document=new Document(),buffer=document.createBuffer(),scene=document.createScene();
    const pixels=await sharp(Buffer.from([255,0,0,255,64,128,255,255]),{raw:{width:2,height:1,channels:4}}).png().toBuffer();
    const texture=document.createTexture().setImage(pixels).setMimeType('image/png');
    const material=document.createMaterial().setBaseColorFactor([.5,.25,.75,1]).setBaseColorTexture(texture);
    const transform=document.createExtension(KHRTextureTransform).createTransform().setTexCoord(1).setScale([.5,1]);
    material.getBaseColorTextureInfo()!.setExtension('KHR_texture_transform',transform);
    const positions=new Float32Array([0,0,0,1,0,0,0,1,0]);
    const accessor=(type:'VEC2'|'VEC3'|'SCALAR',array:Float32Array|Uint16Array)=>document.createAccessor().setType(type).setBuffer(buffer).setArray(array);
    const primitive=document.createPrimitive().setMaterial(material).setIndices(accessor('SCALAR',new Uint16Array([0,1,2])))
      .setAttribute('POSITION',accessor('VEC3',positions))
      .setAttribute('TEXCOORD_0',accessor('VEC2',new Float32Array([.25,.5,.25,.5,.25,.5])))
      .setAttribute('TEXCOORD_1',accessor('VEC2',new Float32Array([1.5,.5,1.5,.5,1.5,.5])))
      .setAttribute('COLOR_0',accessor('VEC3',new Float32Array([.4,.5,1,.4,.5,1,.4,.5,1])));
    scene.addChild(document.createNode().setMesh(document.createMesh().addPrimitive(primitive)));
    await bakeContextColors(document);
    const result=document.getRoot().listMeshes()[0].listPrimitives()[0],color:number[]=[];
    result.getAttribute('COLOR_0')!.getElement(0,color);
    expect(color).toEqual([2/255,6/255,172/255]);
    expect(result.getAttribute('POSITION')!.getArray()).toEqual(positions);
    expect(document.getRoot().listTextures()).toHaveLength(0);
    expect(document.getRoot().listMaterials()).toHaveLength(1);
  });
});
