import {expect,it,vi} from 'vitest';
import {Mesh,PerspectiveCamera,type Material,type Scene,type WebGLRenderer} from 'three';
import {SmokeRenderer} from './smoke-render';
import {disposeWarmRenderer} from '../shader-warmup';

function pollingRenderer() {
  const jobs:{material:Material;finish():void;released:ReturnType<typeof vi.fn>}[]=[];
  const programs=new Map<Material,{isReady():boolean}>();
  const compileAsync=vi.fn((scene:Scene)=>{
    const material=(scene.children[0] as Mesh).material as Material,released=vi.fn();
    programs.set(material,{isReady:()=>true});
    material.addEventListener('dispose',()=>{released();programs.delete(material);});
    let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});
    jobs.push({material,finish,released});
    // Mirror Three's poll of currentProgram after asynchronous compilation.
    return pending.then(()=>{expect(programs.get(material)!.isReady()).toBe(true);return scene;});
  });
  const renderer={compileAsync,dispose:vi.fn()} as unknown as WebGLRenderer;
  return {renderer,jobs};
}

it('reproduces the missing-program poll when a direct compile bypasses material ownership',async()=>{
  const smoke=new SmokeRenderer(),{renderer,jobs}=pollingRenderer();
  const pending=renderer.compileAsync((smoke as any).scene,new PerspectiveCamera());
  const failure=expect(pending).rejects.toThrow('isReady');
  smoke.dispose();expect(jobs[0].released).toHaveBeenCalledOnce();jobs[0].finish();await failure;
  disposeWarmRenderer(renderer);expect(renderer.dispose).toHaveBeenCalledOnce();
});

it('warms both actual smoke and temporary blit shader variants without changing materials',async()=>{
  const smoke=new SmokeRenderer(),{renderer,jobs}=pollingRenderer(),preparing=smoke.prepare(renderer);
  await vi.waitFor(()=>expect(jobs).toHaveLength(1));
  const primary=jobs[0].material;expect(primary).toBe((smoke as any).material);
  jobs[0].finish();await vi.waitFor(()=>expect(jobs).toHaveLength(2));
  expect(jobs[1].material).toBe((smoke as any).blit);expect(jobs[1].material).not.toBe(primary);
  jobs[1].finish();await preparing;
  expect((smoke as any).mesh.material).toBe(primary);
  expect(jobs[0].released).not.toHaveBeenCalled();expect(jobs[1].released).not.toHaveBeenCalled();
  smoke.dispose();expect(jobs[0].released).toHaveBeenCalledOnce();expect(jobs[1].released).toHaveBeenCalledOnce();
  disposeWarmRenderer(renderer);expect(renderer.dispose).toHaveBeenCalledOnce();
});

it.each([0,1])('keeps smoke variant %s alive through owner disposal and renderer shutdown until its poll ends',async phase=>{
  const smoke=new SmokeRenderer(),{renderer,jobs}=pollingRenderer(),preparing=smoke.prepare(renderer);
  await vi.waitFor(()=>expect(jobs).toHaveLength(1));
  if(phase===1){jobs[0].finish();await vi.waitFor(()=>expect(jobs).toHaveLength(2));}
  smoke.dispose();smoke.dispose();disposeWarmRenderer(renderer);disposeWarmRenderer(renderer);
  const active=jobs[phase];expect(active.released).not.toHaveBeenCalled();expect(renderer.dispose).not.toHaveBeenCalled();
  active.finish();await preparing;await new Promise(resolve=>setTimeout(resolve,0));
  expect(active.released).toHaveBeenCalledOnce();expect(renderer.dispose).toHaveBeenCalledOnce();
  expect(jobs).toHaveLength(phase+1);expect((smoke as any).mesh.material).toBe((smoke as any).material);
});

it('restores the primary smoke material and releases a pending blit on compile rejection',async()=>{
  const smoke=new SmokeRenderer(),{renderer,jobs}=pollingRenderer(),failure=Error('blit compile failed');
  let fail!:(error:Error)=>void;
  vi.mocked(renderer.compileAsync).mockImplementationOnce(scene=>Promise.resolve(scene))
    .mockImplementationOnce(scene=>{
      const material=(scene.children[0] as Mesh).material as Material,released=vi.fn();
      material.addEventListener('dispose',released);jobs.push({material,released,finish:()=>{}});
      return new Promise<Scene>((_resolve,reject)=>{fail=reject;});
    });
  const preparing=smoke.prepare(renderer),rejection=expect(preparing).rejects.toBe(failure);
  await vi.waitFor(()=>expect(jobs).toHaveLength(1));smoke.dispose();disposeWarmRenderer(renderer);
  expect(jobs[0].released).not.toHaveBeenCalled();fail(failure);await rejection;
  await new Promise(resolve=>setTimeout(resolve,0));expect(jobs[0].released).toHaveBeenCalledOnce();
  expect(renderer.dispose).toHaveBeenCalledOnce();expect((smoke as any).mesh.material).toBe((smoke as any).material);
});
