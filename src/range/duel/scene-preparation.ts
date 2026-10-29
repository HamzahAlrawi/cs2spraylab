import * as THREE from 'three';
import {backgroundFrame} from '../prefire/background-work';
import {compileRetainedShaders} from '../shader-warmup';
import {PrefireLighting,retainPreparedLighting} from '../prefire/lighting';
import type {Settings} from '../config';
import {waitForGpu,textureUploadBytes} from './gpu-readiness';

/** Upload in small turns; compile the retained materials rather than disposable clones. */
export async function prepareSceneGpu(renderer: THREE.WebGLRenderer, root: THREE.Group,
  lighting: THREE.Scene, camera: THREE.Camera, signal: AbortSignal, quality?: Settings['quality']) {
  const parent=root.parent,parentIndex=parent?.children.indexOf(root)??-1;
  const scene = new THREE.Scene(), textures = new Set<THREE.Texture>(),meshes:THREE.Mesh[]=[];
  const shadowState={enabled:renderer.shadowMap.enabled,type:renderer.shadowMap.type,
    autoUpdate:renderer.shadowMap.autoUpdate,needsUpdate:renderer.shadowMap.needsUpdate};
  scene.fog = lighting.fog; scene.environment = lighting.environment;
  const preparedLight=quality===undefined?undefined:new PrefireLighting(scene,root);
  if(preparedLight)preparedLight.configure(renderer,quality!);
  else for (const node of lighting.children) if (node instanceof THREE.Light) scene.add(node.clone());
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    meshes.push(node);
    node.receiveShadow = !node.userData.nativeContext;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    node.castShadow = !node.userData.nativeContext && !materials.some(material => material.userData.nativeOverlay || material.transparent);
    for (const material of materials) for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
  });
  scene.add(root);
  let retained=false;
  try {
    const list = [...textures]; let index = 0;
    while (index < list.length) {
      await backgroundFrame(signal); const start = performance.now();let uploaded=0;
      do {
        signal.throwIfAborted();const texture=list[index++];renderer.initTexture(texture);uploaded+=textureUploadBytes(texture);
      } while (index < list.length && uploaded<4*1024*1024 && performance.now() - start < 2);
      await waitForGpu(renderer,signal);
    }
    await backgroundFrame(signal);
    await compileRetainedShaders(renderer, scene, camera);
    signal.throwIfAborted();
    root.removeFromParent();root.updateMatrixWorld(true);
    // Zero-count draws upload retained buffers/VAOs without writing pixels.
    // Keep the current framebuffer: an offscreen target changes color-space /
    // tone-mapping shader variants and can synchronously compile during combat.
    const seen=new Set<THREE.BufferGeometry>();
    let batchAt=performance.now(),batchCount=0;
    for(const mesh of meshes) {
      if(seen.has(mesh.geometry))continue;seen.add(mesh.geometry);
      if(batchCount>=8||performance.now()-batchAt>=2){await backgroundFrame(signal);batchAt=performance.now();batchCount=0;}
      signal.throwIfAborted();batchCount++;
      const clone=mesh.clone(false);clone.frustumCulled=false;clone.visible=true;clone.matrixAutoUpdate=false;
      clone.matrix.copy(mesh.matrixWorld);scene.add(clone);
      const range={...mesh.geometry.drawRange},priorTarget=renderer.getRenderTarget(),
        face=renderer.getActiveCubeFace(),level=renderer.getActiveMipmapLevel(),
        viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),
        scissorTest=renderer.getScissorTest(),autoClear=renderer.autoClear,shadowUpdate=renderer.shadowMap.needsUpdate,
        shadowAuto=renderer.shadowMap.autoUpdate,
        autoReset=renderer.info.autoReset,renderInfo={...renderer.info.render};
      try {
        mesh.geometry.setDrawRange(0,0);renderer.shadowMap.needsUpdate=false;renderer.shadowMap.autoUpdate=false;renderer.info.autoReset=false;
        renderer.autoClear=false;renderer.render(scene,camera);
      }finally{
        mesh.geometry.setDrawRange(range.start,range.count);scene.remove(clone);
        renderer.setRenderTarget(priorTarget,face,level);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
        renderer.autoClear=autoClear;renderer.shadowMap.needsUpdate=shadowUpdate;renderer.shadowMap.autoUpdate=shadowAuto;
        renderer.info.autoReset=autoReset;Object.assign(renderer.info.render,renderInfo);
      }
    }
    if(preparedLight) {
      await backgroundFrame(signal);scene.add(root);
      preparedLight.beginFrame(renderer,camera.position);signal.throwIfAborted();
      retainPreparedLighting(root,preparedLight);retained=true;
    }
    await waitForGpu(renderer,signal);
  } finally {
    if(!retained)preparedLight?.dispose();root.removeFromParent(); scene.clear();
    if(preparedLight)Object.assign(renderer.shadowMap,shadowState);
    if(parent){parent.add(root);parent.children.splice(parent.children.indexOf(root),1);parent.children.splice(parentIndex,0,root);}
  }
}
