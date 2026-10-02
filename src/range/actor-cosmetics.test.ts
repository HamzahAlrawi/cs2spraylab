import {describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {ActorCosmeticLoader,applyGloves,disposeGloves,bindGloves,type ActorCosmeticInstance} from './actor-cosmetics';
import type {GLTF,GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

function rig(defaults=false) {
  const scene=new THREE.Group(), bone=new THREE.Bone();bone.name='hand_R';scene.add(bone);
  const geometry=new THREE.BoxGeometry(.1,.1,.1);
  const count=geometry.attributes.position.count;
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(count*4),4));
  const weights=new Float32Array(count*4);for(let i=0;i<count;i++) weights[i*4]=1;
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshStandardMaterial());
  mesh.name=defaults?'firstperson_default_gloves_arms':'native_gloves';scene.add(mesh);scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([bone]));return {scene,bone,mesh,animations:[]};
}
const catalog=['a','b','c'].map(id=>({id:`gloves-${id}`,equipment:'gloves',assetKey:`gloves-${id}`}));
function loader() {
  const loadAsync=vi.fn(async()=>rig() as unknown as GLTF);
  return {loadAsync,cache:new ActorCosmeticLoader({loadAsync} as Pick<GLTFLoader,'loadAsync'>,2)};
}
describe('native actor cosmetics resource lifecycle',()=>{
  it('loads only chosen models, clones independent resources, and bounds its cache',async()=>{
    const {cache,loadAsync}=loader();
    const a=await cache.load('gloves-a',catalog),again=await cache.load('gloves-a',catalog);
    expect(loadAsync).toHaveBeenCalledTimes(1);
    const mesh=a.scene.getObjectByName('native_gloves') as THREE.SkinnedMesh;
    const other=again.scene.getObjectByName('native_gloves') as THREE.SkinnedMesh;
    expect(mesh.geometry).not.toBe(other.geometry);expect(mesh.material).not.toBe(other.material);
    await cache.load('gloves-b',catalog);await cache.load('gloves-c',catalog);
    expect(cache.cachedCount).toBe(2);
    a.dispose();again.dispose();cache.dispose();expect(cache.cachedCount).toBe(0);
    await expect(cache.load('gloves-a',catalog)).rejects.toThrow('disposed');
  });
  it('binds to the existing animated hands and restores default gloves without disposing those hands',()=>{
    const root=rig(true),source=rig(),dispose=vi.fn();
    const instance:ActorCosmeticInstance={scene:source.scene,animations:[],dispose};
    const handle=bindGloves(root.scene,instance,'gloves-a');
    expect(root.mesh.visible).toBe(false);expect(handle.meshes[0].skeleton.bones[0]).toBe(root.bone);
    root.bone.position.x=1;root.scene.updateMatrixWorld(true);handle.meshes[0].skeleton.update();
    expect(handle.meshes[0].skeleton.bones[0].matrixWorld.elements[12]).toBe(1);
    expect(handle.meshes[0].frustumCulled).toBe(false);
    handle.dispose();handle.dispose();expect(root.mesh.visible).toBe(true);expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('replaces a chosen pair, supports stock, and cancels a pending load when the view is disposed',async()=>{
    const root=rig(true),{cache}=loader();
    await applyGloves(root.scene,'gloves-a',catalog,cache);
    await applyGloves(root.scene,'gloves-b',catalog,cache);
    expect(root.scene.getObjectByName('cosmetic_gloves-a')).toBeUndefined();
    expect(root.scene.getObjectByName('cosmetic_gloves-b')).toBeDefined();
    await applyGloves(root.scene,null,catalog,cache);expect(root.mesh.visible).toBe(true);
    const pending=applyGloves(root.scene,'gloves-c',catalog,cache);disposeGloves(root.scene);await pending;
    expect(root.scene.getObjectByName('cosmetic_gloves-c')).toBeUndefined();expect(root.mesh.visible).toBe(true);
    cache.dispose();
  });
});
