import * as THREE from 'three';

type CompileRenderer = Pick<THREE.WebGLRenderer,'compileAsync'>;
const warmups = new WeakMap<CompileRenderer, {closing: boolean; jobs: Set<Promise<void>>}>();
type MaterialHold = {refs: number; requested: boolean; original: THREE.Material['dispose']; descriptor?: PropertyDescriptor};
const materialHolds = new WeakMap<THREE.Material, MaterialHold>();

function holdMaterial(material: THREE.Material) {
  let hold = materialHolds.get(material);
  if (!hold) {
    hold = {refs: 0, requested: false, original: material.dispose,
      descriptor: Object.getOwnPropertyDescriptor(material,'dispose')};
    const owner = hold;
    material.dispose = () => {owner.requested = true;};
    materialHolds.set(material,hold);
  }
  hold.refs++;
}

function releaseMaterial(material: THREE.Material) {
  const hold = materialHolds.get(material)!;
  if (--hold.refs) return;
  materialHolds.delete(material);
  if (hold.descriptor) Object.defineProperty(material,'dispose',hold.descriptor);
  else delete (material as Partial<THREE.Material>).dispose;
  if (hold.requested) hold.original.call(material);
}

function holdSceneMaterials(scene: THREE.Scene, held: Set<THREE.Material>) {
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points || node instanceof THREE.Sprite)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!held.has(material)) {holdMaterial(material); held.add(material);}
    }
  });
}

/** Defer owner disposal while Three polls the actual retained shader programs. */
export function compileRetainedShaders(renderer: CompileRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  let state = warmups.get(renderer);
  if (!state) {state = {closing: false, jobs: new Set()}; warmups.set(renderer,state);}
  if (state.closing) return Promise.resolve();
  const held = new Set<THREE.Material>();
  holdSceneMaterials(scene,held);
  let job: Promise<void>;
  job = Promise.resolve().then(() => {
    if (state!.closing) return;
    // Include materials added between scheduling and the synchronous compile entry.
    holdSceneMaterials(scene,held);
    return renderer.compileAsync(scene,camera,scene);
  }).then(() => {}).finally(() => {
    try {for (const material of held) releaseMaterial(material);}
    finally {held.clear(); state!.jobs.delete(job);}
  });
  state.jobs.add(job); return job;
}

/** Exercise retained uniforms, skinning buffers and VAOs with the final shader
 * configuration, but a zero-area scissor. Never paints over the current frame. */
export function warmRetainedFirstUse(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  roots: readonly THREE.Object3D[]) {
  const states: {node: THREE.Object3D; visible: boolean; culled: boolean}[] = [];
  const seen=new Set<THREE.Object3D>();
  for(const root of roots)root.traverse(node=>{
    if(seen.has(node))return;seen.add(node);
    states.push({node,visible:node.visible,culled:node.frustumCulled});node.visible=true;node.frustumCulled=false;
  });
  const viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),
    scissorTest=renderer.getScissorTest(),autoClear=renderer.autoClear,shadowAuto=renderer.shadowMap.autoUpdate,
    shadowUpdate=renderer.shadowMap.needsUpdate,autoReset=renderer.info.autoReset,info={...renderer.info.render};
  try {
    renderer.setScissor(0,0,0,0);renderer.setScissorTest(true);renderer.autoClear=false;
    renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;renderer.info.autoReset=false;
    renderer.render(scene,camera);
  } finally {
    for(const {node,visible,culled} of states){node.visible=visible;node.frustumCulled=culled;}
    renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    renderer.autoClear=autoClear;renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowUpdate;
    renderer.info.autoReset=autoReset;Object.assign(renderer.info.render,info);
  }
}

/** Keep temporary material owners alive while Three polls asynchronous programs. */
export function prewarmShaders(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  let state = warmups.get(renderer);
  if (!state) {state = {closing: false, jobs: new Set()}; warmups.set(renderer,state);}
  if (state.closing) return Promise.resolve();
  const snapshot = new THREE.Scene(), materials = new Map<THREE.Material, THREE.Material>();
  const copyMaterial = (material: THREE.Material) => {
    let clone = materials.get(material);
    if (!clone) {clone = material.clone(); materials.set(material,clone);}
    return clone;
  };
  scene.updateMatrixWorld(true);
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points || node instanceof THREE.Sprite)) return;
    const clone = node.clone(false);
    clone.material = Array.isArray(node.material) ? node.material.map(copyMaterial) : copyMaterial(node.material);
    clone.matrixAutoUpdate = false; clone.matrix.copy(node.matrixWorld); snapshot.add(clone);
  });
  let job: Promise<void>;
  job = Promise.resolve().then(() => state!.closing ? undefined : renderer.compileAsync(snapshot,camera,scene)).then(() => {}, () => {}).finally(() => {
    for (const material of materials.values()) material.dispose(); snapshot.clear(); state!.jobs.delete(job);
  });
  state.jobs.add(job);
  return job;
}

export function disposeWarmRenderer(renderer: THREE.WebGLRenderer) {
  let state = warmups.get(renderer);
  if (!state) {state = {closing: false, jobs: new Set()}; warmups.set(renderer,state);}
  if (state.closing) return;
  state.closing = true;
  if (!state.jobs.size) renderer.dispose();
  else void Promise.allSettled([...state.jobs]).then(() => renderer.dispose());
}
