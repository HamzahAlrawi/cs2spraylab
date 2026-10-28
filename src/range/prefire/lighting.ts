import * as THREE from 'three';
import type {Settings} from '../config';
import type {Vec} from '../actor-physics';

const preparedLighting = new WeakMap<THREE.Group,PrefireLighting>();
export function retainPreparedLighting(map: THREE.Group, light: PrefireLighting) {
  preparedLighting.get(map)?.dispose();preparedLighting.set(map,light);
}
export function releasePreparedLighting(map: THREE.Group) {
  preparedLighting.get(map)?.dispose();preparedLighting.delete(map);
}
export function takePreparedLighting(scene: THREE.Scene, map: THREE.Group): PrefireLighting | undefined {
  let found: PrefireLighting | undefined;
  map.traverse(node=>{
    if(found||!(node instanceof THREE.Group))return;
    found=preparedLighting.get(node);if(found)preparedLighting.delete(node);
  });
  found?.attach(scene);return found;
}

// Static map shadows are cached. Moving actors retain their separate contact
// shadows; they never force a second native-map draw on every gameplay frame.
export class PrefireLighting {
  readonly sky = new THREE.HemisphereLight('#d9e6f2', '#807c70', .95);
  readonly fill = new THREE.AmbientLight('#d6dce1', .22);
  readonly sun = new THREE.DirectionalLight('#fff1d8', 2.25);
  private readonly meshes: THREE.Mesh[] = [];
  private restore: {mesh: THREE.Mesh; visible: boolean}[] = [];
  private dirty = true;
  private enabled = false;
  private readonly bakeTarget = new THREE.WebGLRenderTarget(1, 1);
  private readonly bakeCamera = new THREE.PerspectiveCamera(1, 1, .01, .1);

  constructor(private scene: THREE.Scene, map: THREE.Group) {
    // The main-camera frustum excludes map objects in this shadow-only render.
    // Shadow cameras retain their normal cover frustum and original materials.
    this.bakeCamera.position.set(0, 100000, 0);
    this.bakeCamera.updateMatrixWorld();
    this.sun.position.set(-80, 160, 70);
    const camera = this.sun.shadow.camera;
    Object.assign(camera, {left: -48, right: 48, top: 48, bottom: -48, near: 80, far: 300});
    camera.updateProjectionMatrix();
    this.sun.shadow.bias = -.00005;
    this.sun.shadow.normalBias = .035;
    scene.add(this.sky, this.fill, this.sun, this.sun.target);
    map.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      if(node.userData.nativeContext){node.castShadow=false;node.receiveShadow=false;return;}
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      // Decals are receivers, not raised shadow-casting slabs.
      node.castShadow = !materials.some(material => material.userData.nativeOverlay || material.transparent);
      node.receiveShadow = true;
      this.meshes.push(node);
    });
    // A camera-following shadow frustum changes the illumination at tunnel
    // exits. Fit the retained chunk once, including its visual context.
    map.updateMatrixWorld(true);
    const bounds = new THREE.Box3(), part = new THREE.Box3();
    for(const mesh of this.meshes){
      if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
      if(mesh.geometry.boundingBox)bounds.union(part.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
    }
    if (!bounds.isEmpty()) {
      const center = bounds.getCenter(new THREE.Vector3());
      this.sun.target.position.copy(center);
      this.sun.position.copy(center).add(new THREE.Vector3(-80, 160, 70));
      this.sun.target.updateMatrixWorld(); this.sun.updateMatrixWorld();
      this.sun.shadow.updateMatrices(this.sun);
      const lightBounds = new THREE.Box3();
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z])
          lightBounds.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
      Object.assign(camera, {left: lightBounds.min.x-2, right: lightBounds.max.x+2,
        bottom: lightBounds.min.y-2, top: lightBounds.max.y+2,
        near: Math.max(.1,-lightBounds.max.z-8), far: Math.max(10,-lightBounds.min.z+8)});
      camera.updateProjectionMatrix();
    }
  }

  attach(scene: THREE.Scene) {
    this.scene = scene;scene.add(this.sky,this.fill,this.sun,this.sun.target);
  }

  configure(renderer: THREE.WebGLRenderer, quality: Settings['quality']) {
    const enabled = quality === 'auto' || quality === 'high';
    const size = quality === 'high' ? 4096 : 2048;
    if (enabled !== this.enabled || size !== this.sun.shadow.mapSize.x) {
      this.dirty = true;
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    }
    this.enabled = enabled; this.sun.castShadow = enabled;
    this.sun.shadow.mapSize.set(size, size);
    renderer.shadowMap.enabled = enabled;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
  }

  beginFrame(renderer: THREE.WebGLRenderer, _position: Vec) {
    if (!this.enabled) return;
    if (!this.dirty) return;
    // A caster outside the camera's native PVS may still shade visible ground.
    // Include native static surfaces for the occasional bake, then restore PVS.
    this.restore = this.meshes.map(mesh => ({mesh, visible: mesh.visible}));
    for (const {mesh} of this.restore) mesh.visible = true;
    const shadowUpdate=renderer.shadowMap.needsUpdate;
    renderer.shadowMap.needsUpdate = true;
    const target = renderer.getRenderTarget(),autoClear=renderer.autoClear;
    const viewport=renderer.getViewport?.(new THREE.Vector4()),scissor=renderer.getScissor?.(new THREE.Vector4());
    const scissorTest=renderer.getScissorTest?.(),autoReset=renderer.info?.autoReset,info=renderer.info?{...renderer.info.render}:undefined;
    try {
      renderer.setRenderTarget(this.bakeTarget);
      renderer.setScissorTest?.(false);renderer.autoClear=true;
      if(renderer.info)renderer.info.autoReset=false;
      renderer.render(this.scene, this.bakeCamera);
      this.dirty = false;
    } finally {
      this.endFrame();
      renderer.setRenderTarget(target);
      renderer.shadowMap.needsUpdate=shadowUpdate;
      if(viewport)renderer.setViewport(viewport);if(scissor)renderer.setScissor(scissor);
      if(scissorTest!==undefined)renderer.setScissorTest(scissorTest);renderer.autoClear=autoClear;
      if(renderer.info&&autoReset!==undefined){renderer.info.autoReset=autoReset;Object.assign(renderer.info.render,info);}
    }
  }

  endFrame() {
    for (const {mesh, visible} of this.restore) mesh.visible = visible;
    this.restore.length = 0;
  }

  dispose() {this.endFrame();this.sky.removeFromParent();this.fill.removeFromParent();this.sun.removeFromParent();this.sun.target.removeFromParent();this.sun.shadow.map?.dispose();this.bakeTarget.dispose();}
}
