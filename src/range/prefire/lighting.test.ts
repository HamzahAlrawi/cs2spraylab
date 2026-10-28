import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {PrefireLighting,retainPreparedLighting,releasePreparedLighting,takePreparedLighting} from './lighting';

function fixture() {
  const scene = new THREE.Scene(), map = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const decal = wall.clone(); decal.material = new THREE.MeshStandardMaterial();
  decal.material.userData.nativeOverlay = true;
  const hidden = wall.clone(); hidden.visible = false;
  map.add(wall, decal, hidden); scene.add(map);
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {shadowMap: {enabled: false, type: 0, autoUpdate: true, needsUpdate: false},
    getRenderTarget: () => target, setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {target = next;},
    render: vi.fn(() => {renderer.shadowMap.needsUpdate = false;})} as unknown as THREE.WebGLRenderer;
  return {scene, map, wall, decal, hidden, renderer, light: new PrefireLighting(scene, map)};
}

describe('native map lighting without per-frame map shadow draws', () => {
  it('transfers a prepared shadow map exactly once and frees cancelled maps',()=>{
    const {map,renderer,light}=fixture(),active=new THREE.Scene(),wrapper=new THREE.Group();
    wrapper.add(map);light.configure(renderer,'auto');light.beginFrame(renderer,{x:0,y:0,z:0});
    retainPreparedLighting(map,light);
    expect(takePreparedLighting(active,wrapper)).toBe(light);expect(light.sun.parent).toBe(active);
    light.beginFrame(renderer,{x:200,y:0,z:100});expect(renderer.render).toHaveBeenCalledOnce();
    expect(takePreparedLighting(active,wrapper)).toBeUndefined();light.dispose();
    const cancelled=new PrefireLighting(active,map),dispose=vi.spyOn(cancelled,'dispose');
    retainPreparedLighting(map,cancelled);releasePreparedLighting(map);expect(dispose).toHaveBeenCalledOnce();
    expect(takePreparedLighting(active,map)).toBeUndefined();
  });
  it('receives shadows, casts from opaque cover, and excludes native overlay slabs', () => {
    const {wall, decal, light} = fixture();
    expect(wall.castShadow).toBe(true); expect(wall.receiveShadow).toBe(true);
    expect(decal.castShadow).toBe(false); expect(decal.receiveShadow).toBe(true);
    expect(light.sky.intensity + light.fill.intensity).toBeLessThan(1.2);
  });
  it('temporarily includes hidden native casters for a bake, then restores the exact PVS state', () => {
    const {hidden, renderer, light} = fixture();
    light.configure(renderer, 'auto');
    vi.mocked(renderer.render).mockImplementationOnce((_scene, camera) => {
      expect(hidden.visible).toBe(true); expect(renderer.shadowMap.needsUpdate).toBe(true);
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      expect(frustum.intersectsObject(hidden)).toBe(false);
      expect(renderer.getRenderTarget()?.width).toBe(1); renderer.shadowMap.needsUpdate = false;
    });
    light.beginFrame(renderer, {x: 1, y: 2, z: 1});
    expect(hidden.visible).toBe(false); expect(renderer.getRenderTarget()).toBeNull();
    renderer.shadowMap.needsUpdate = false;
    for (let i = 0; i < 1280; i++) {
      light.beginFrame(renderer, {x: 1 + i / 1280, y: 2, z: 1});
      expect(renderer.shadowMap.needsUpdate).toBe(false); expect(hidden.visible).toBe(false);
    }
    light.beginFrame(renderer, {x: 14, y: 2, z: 1});
    light.beginFrame(renderer, {x: -100, y: 2, z: 130});
    expect(renderer.render).toHaveBeenCalledTimes(1); expect(hidden.visible).toBe(false);
  });
  it('fits every chunk corner without moving the sun as the player crosses a tunnel', () => {
    const {map,scene,renderer,light: old} = fixture();
    scene.remove(old.sky,old.fill,old.sun,old.sun.target);old.dispose();
    const distant = new THREE.Mesh(new THREE.BoxGeometry(8,30,16),new THREE.MeshStandardMaterial());
    distant.position.set(110,12,-70);map.add(distant);
    const light = new PrefireLighting(scene,map);light.configure(renderer,'auto');
    light.sun.shadow.updateMatrices(light.sun);
    const frustum = light.sun.shadow.getFrustum();
    expect(frustum.intersectsObject(distant)).toBe(true);
    const position = light.sun.position.clone(), target = light.sun.target.position.clone();
    light.beginFrame(renderer,{x:0,y:0,z:0});light.beginFrame(renderer,{x:110,y:0,z:-70});
    expect(light.sun.position.equals(position)).toBe(true);expect(light.sun.target.position.equals(target)).toBe(true);
    expect(renderer.render).toHaveBeenCalledOnce();light.dispose();
  });
  it.each(['low', 'performance'] as const)('%s adds no shadow pass and leaves PVS untouched', quality => {
    const {hidden, renderer, light} = fixture();
    light.configure(renderer, quality); light.beginFrame(renderer, {x: 0, y: 2, z: 0});
    expect(renderer.shadowMap.enabled).toBe(false); expect(renderer.shadowMap.needsUpdate).toBe(false);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(hidden.visible).toBe(false); expect(light.sun.castShadow).toBe(false);
  });
  it('invalidates and disposes the cached GPU map when quality changes', () => {
    const {renderer, light} = fixture(); light.configure(renderer, 'auto');
    light.beginFrame(renderer, {x: 0, y: 2, z: 0}); light.endFrame();
    const dispose = vi.fn(); light.sun.shadow.map = {dispose} as unknown as THREE.WebGLRenderTarget;
    renderer.shadowMap.needsUpdate = false; light.configure(renderer, 'high');
    expect(dispose).toHaveBeenCalledOnce(); expect(light.sun.shadow.mapSize.x).toBe(4096);
    light.beginFrame(renderer, {x: 0, y: 2, z: 0}); expect(renderer.render).toHaveBeenCalledTimes(2);
  });
  it('restores PVS and the render target on a failed bake, then retries', () => {
    const {renderer, hidden, light} = fixture(); light.configure(renderer, 'auto');
    vi.mocked(renderer.render).mockImplementationOnce(() => {throw new Error('Context failure');});
    expect(() => light.beginFrame(renderer, {x: 0, y: 2, z: 0})).toThrow('Context failure');
    expect(hidden.visible).toBe(false); expect(renderer.getRenderTarget()).toBeNull();
    light.beginFrame(renderer, {x: 0, y: 2, z: 0}); expect(renderer.render).toHaveBeenCalledTimes(2);
  });
});
