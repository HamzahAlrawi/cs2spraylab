import {expect, it, vi} from 'vitest';
import {Scene, Mesh, BoxGeometry, MeshStandardMaterial, PerspectiveCamera, Vector4, Group, type WebGLRenderer} from 'three';
import {prewarmShaders, compileRetainedShaders, warmRetainedFirstUse, disposeWarmRenderer} from './shader-warmup';

it('isolates compiling materials from weapon disposal and drains before renderer shutdown', async () => {
  const scene = new Scene(), material = new MeshStandardMaterial(), geometry = new BoxGeometry();
  scene.add(new Mesh(geometry,material)); let finish: (() => void) | undefined;
  const pending = new Promise<void>(resolve => {finish = resolve;});
  const dispose = vi.fn(), compileAsync = vi.fn(async (snapshot: Scene) => {
    expect((snapshot.children[0] as Mesh).material).not.toBe(material); await pending; return snapshot;
  });
  const renderer = {compileAsync, dispose} as unknown as WebGLRenderer;
  prewarmShaders(renderer,scene,new PerspectiveCamera()); await Promise.resolve();
  material.dispose(); disposeWarmRenderer(renderer); expect(dispose).not.toHaveBeenCalled();
  finish!(); await new Promise(resolve => setTimeout(resolve,0));
  expect(dispose).toHaveBeenCalledTimes(1); geometry.dispose();
});

it.each([false,true])('warms final retained actors without pixels and restores state even on renderer failure (%s)',fails=>{
  const scene=new Scene(),root=new Group(),mesh=new Mesh(new BoxGeometry(),new MeshStandardMaterial());root.add(mesh);scene.add(root);
  root.visible=false;mesh.visible=false;
  const viewport=new Vector4(1,2,300,200),scissor=new Vector4(4,5,100,80),info={calls:7,triangles:9,points:0,lines:0,frame:3};
  let currentScissor=scissor.clone(),test=false;
  const renderer={autoClear:true,shadowMap:{autoUpdate:true,needsUpdate:true},info:{autoReset:true,render:{...info}},
    getViewport:(v:Vector4)=>v.copy(viewport),getScissor:(v:Vector4)=>v.copy(currentScissor),getScissorTest:()=>test,
    setScissor:(...args:unknown[])=>{currentScissor=args[0] instanceof Vector4?args[0].clone():new Vector4(...args as [number,number,number,number]);},
    setViewport:vi.fn(),setScissorTest:(value:boolean)=>{test=value;},render:vi.fn(()=>{
      expect(root.visible).toBe(true);expect(mesh.visible).toBe(true);expect(mesh.frustumCulled).toBe(false);
      expect(currentScissor.toArray()).toEqual([0,0,0,0]);expect(test).toBe(true);expect(renderer.autoClear).toBe(false);
      expect(renderer.shadowMap.needsUpdate).toBe(false);renderer.info.render.calls=99;if(fails)throw Error('GPU');
    })} as unknown as WebGLRenderer;
  const call=()=>warmRetainedFirstUse(renderer,scene,new PerspectiveCamera(),[root,root]);
  if(fails)expect(call).toThrow('GPU');else call();
  expect(root.visible).toBe(false);expect(mesh.visible).toBe(false);expect(mesh.frustumCulled).toBe(true);
  expect(currentScissor).toEqual(scissor);expect(test).toBe(false);expect(renderer.autoClear).toBe(true);
  expect(renderer.shadowMap).toEqual({autoUpdate:true,needsUpdate:true});expect(renderer.info.render).toEqual(info);
  mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();
});

it('retains prepared-map material ownership until compilation settles and blocks late compilation after shutdown',async()=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry();scene.add(new Mesh(geometry,material));
  let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;}),dispose=vi.fn(),released=vi.fn();
  material.addEventListener('dispose',released);
  const compileAsync=vi.fn(async(retained:Scene)=>{expect(retained).toBe(scene);
    expect((retained.children[0] as Mesh).material).toBe(material);await pending;return retained;});
  const renderer={compileAsync,dispose} as unknown as WebGLRenderer,job=compileRetainedShaders(renderer,scene,new PerspectiveCamera());
  await Promise.resolve();disposeWarmRenderer(renderer);expect(dispose).not.toHaveBeenCalled();
  await compileRetainedShaders(renderer,scene,new PerspectiveCamera());expect(compileAsync).toHaveBeenCalledOnce();
  finish();await job;await new Promise(resolve=>setTimeout(resolve,0));
  expect(dispose).toHaveBeenCalledOnce();expect(released).not.toHaveBeenCalled();material.dispose();geometry.dispose();
});

function deferredCompile() {
  let resolve!:()=>void,reject!:(error:Error)=>void;
  const pending=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  const renderer={compileAsync:vi.fn(()=>pending),dispose:vi.fn()} as unknown as WebGLRenderer;
  return {renderer,pending,resolve,reject};
}

it('defers actual material disposal requested during retained compilation and restores the original method',async()=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry();scene.add(new Mesh(geometry,material));
  const original=vi.spyOn(material,'dispose'),released=vi.fn();material.addEventListener('dispose',released);
  const compile=deferredCompile(),job=compileRetainedShaders(compile.renderer,scene,new PerspectiveCamera());
  material.dispose();material.dispose();expect(original).not.toHaveBeenCalled();expect(released).not.toHaveBeenCalled();
  await Promise.resolve();expect(compile.renderer.compileAsync).toHaveBeenCalledWith(scene,expect.any(PerspectiveCamera),scene);
  disposeWarmRenderer(compile.renderer);disposeWarmRenderer(compile.renderer);
  expect(compile.renderer.dispose).not.toHaveBeenCalled();
  compile.resolve();await job;await new Promise(resolve=>setTimeout(resolve,0));
  expect(original).toHaveBeenCalledOnce();expect(released).toHaveBeenCalledOnce();expect(material.dispose).toBe(original);
  expect(compile.renderer.dispose).toHaveBeenCalledOnce();geometry.dispose();
});

it('reference-counts duplicate materials across concurrent jobs and renderers until the last poll settles',async()=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry(),original=material.dispose;
  scene.add(new Mesh(geometry,[material,material]),new Mesh(geometry,material));
  const released=vi.fn();material.addEventListener('dispose',released);
  const first=deferredCompile(),second=deferredCompile(),camera=new PerspectiveCamera();
  const a=compileRetainedShaders(first.renderer,scene,camera),b=compileRetainedShaders(second.renderer,scene,camera);
  await Promise.resolve();material.dispose();first.resolve();await a;
  expect(released).not.toHaveBeenCalled();expect(material.dispose).not.toBe(original);
  material.dispose();second.resolve();await b;
  expect(released).toHaveBeenCalledOnce();expect(material.dispose).toBe(original);
  expect(Object.prototype.hasOwnProperty.call(material,'dispose')).toBe(false);geometry.dispose();
});

it('keeps a shared material alive when one job fails while another job on the same renderer still polls',async()=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry(),released=vi.fn();
  scene.add(new Mesh(geometry,material));material.addEventListener('dispose',released);
  const first=deferredCompile(),second=deferredCompile(),failure=Error('first compile failed');
  vi.mocked(first.renderer.compileAsync).mockImplementationOnce(()=>first.pending.then(()=>scene))
    .mockImplementationOnce(()=>second.pending.then(()=>scene));
  const a=compileRetainedShaders(first.renderer,scene,new PerspectiveCamera());
  const b=compileRetainedShaders(first.renderer,scene,new PerspectiveCamera());
  const rejection=expect(a).rejects.toBe(failure);await Promise.resolve();
  material.dispose();disposeWarmRenderer(first.renderer);first.reject(failure);await rejection;
  expect(released).not.toHaveBeenCalled();expect(first.renderer.dispose).not.toHaveBeenCalled();
  second.resolve();await b;await new Promise(resolve=>setTimeout(resolve,0));
  expect(released).toHaveBeenCalledOnce();expect(first.renderer.dispose).toHaveBeenCalledOnce();geometry.dispose();
});

it.each([false,true])('releases requested materials on compile failure, including synchronous throws (%s)',synchronous=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry();scene.add(new Mesh(geometry,material));
  const released=vi.fn(),failure=Error('compile failed');material.addEventListener('dispose',released);
  const compile=deferredCompile();
  if(synchronous)vi.mocked(compile.renderer.compileAsync).mockImplementation(()=>{throw failure;});
  const job=compileRetainedShaders(compile.renderer,scene,new PerspectiveCamera());
  const rejection=expect(job).rejects.toBe(failure);material.dispose();
  return Promise.resolve().then(async()=>{
    disposeWarmRenderer(compile.renderer);if(!synchronous)compile.reject(failure);
    await rejection;await new Promise(resolve=>setTimeout(resolve,0));
    expect(released).toHaveBeenCalledOnce();expect(compile.renderer.dispose).toHaveBeenCalledOnce();geometry.dispose();
  });
});

it('restores unrequested material disposal after compilation without disposing a live owner',async()=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry(),original=material.dispose;
  scene.add(new Mesh(geometry,material));const released=vi.fn();material.addEventListener('dispose',released);
  const compile=deferredCompile(),job=compileRetainedShaders(compile.renderer,scene,new PerspectiveCamera());
  compile.resolve();await job;expect(released).not.toHaveBeenCalled();expect(material.dispose).toBe(original);
  material.dispose();expect(released).toHaveBeenCalledOnce();geometry.dispose();
});

it.each(['retained','snapshot'] as const)('skips queued and future %s compilation after renderer closing',async mode=>{
  const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry(),released=vi.fn();
  scene.add(new Mesh(geometry,material));material.addEventListener('dispose',released);
  const renderer={compileAsync:vi.fn(),dispose:vi.fn()} as unknown as WebGLRenderer;
  const compile=mode==='retained'?compileRetainedShaders:prewarmShaders;
  const job=compile(renderer,scene,new PerspectiveCamera());material.dispose();disposeWarmRenderer(renderer);
  await job;await new Promise(resolve=>setTimeout(resolve,0));
  await compileRetainedShaders(renderer,scene,new PerspectiveCamera());await prewarmShaders(renderer,scene,new PerspectiveCamera());
  disposeWarmRenderer(renderer);expect(renderer.compileAsync).not.toHaveBeenCalled();
  expect(renderer.dispose).toHaveBeenCalledOnce();expect(released).toHaveBeenCalledOnce();geometry.dispose();
});

it('blocks late compilation even when shutdown precedes any warmup',async()=>{
  const renderer={compileAsync:vi.fn(),dispose:vi.fn()} as unknown as WebGLRenderer;
  disposeWarmRenderer(renderer);disposeWarmRenderer(renderer);
  await compileRetainedShaders(renderer,new Scene(),new PerspectiveCamera());
  await prewarmShaders(renderer,new Scene(),new PerspectiveCamera());
  expect(renderer.compileAsync).not.toHaveBeenCalled();expect(renderer.dispose).toHaveBeenCalledOnce();
});

it('routes the public map compiler through material ownership and preserves cancellation after compilation',async()=>{
  const {compileMapShaders}=await import('./prefire/map');
  const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry(),released=vi.fn();
  scene.add(new Mesh(geometry,material));material.addEventListener('dispose',released);
  const compile=deferredCompile(),controller=new AbortController();
  const job=compileMapShaders(compile.renderer,scene,new PerspectiveCamera(),controller.signal);
  const rejection=expect(job).rejects.toMatchObject({name:'AbortError'});await Promise.resolve();
  material.dispose();controller.abort();disposeWarmRenderer(compile.renderer);
  expect(released).not.toHaveBeenCalled();expect(compile.renderer.dispose).not.toHaveBeenCalled();
  compile.resolve();await rejection;await new Promise(resolve=>setTimeout(resolve,0));
  expect(released).toHaveBeenCalledOnce();expect(compile.renderer.dispose).toHaveBeenCalledOnce();geometry.dispose();
});
