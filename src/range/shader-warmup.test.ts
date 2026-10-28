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
