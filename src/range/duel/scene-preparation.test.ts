import {afterEach,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {prepareSceneGpu} from './scene-preparation';
afterEach(()=>vi.unstubAllGlobals());
it.each([false,true])('restores attached scene ownership, draw ranges and render state after GPU preparation (failure=%s)',async(fails)=>{
  vi.stubGlobal('requestAnimationFrame',(run:FrameRequestCallback)=>{queueMicrotask(()=>run(0));return 1;});
  const parent=new THREE.Scene(),before=new THREE.Group(),root=new THREE.Group(),after=new THREE.Group();
  const geometry=new THREE.BoxGeometry();geometry.setDrawRange(3,12);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());root.add(mesh);parent.add(before,root,after);
  let scissor=new THREE.Vector4(3,4,80,60),test=false;
  const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,WAIT_FAILED:4,
    isContextLost:()=>false,fenceSync:()=>({}),flush:vi.fn(),clientWaitSync:()=>2,deleteSync:vi.fn()};
  const renderer={getContext:()=>gl,shadowMap:{enabled:false,type:0,autoUpdate:true,needsUpdate:false},
    compileAsync:vi.fn(async()=>{}),initTexture:vi.fn(),getRenderTarget:()=>null,setRenderTarget:vi.fn(),
    getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,info:{autoReset:true,render:{calls:2,triangles:3}},
    autoClear:true,getViewport:(v:THREE.Vector4)=>v.set(0,0,800,600),setViewport:vi.fn(),
    getScissor:(v:THREE.Vector4)=>v.copy(scissor),setScissor:(v:THREE.Vector4)=>{scissor=v.clone();},
    getScissorTest:()=>test,setScissorTest:(value:boolean)=>{test=value;},render:vi.fn(()=>{if(fails)throw Error('warm failed');}),
  } as unknown as THREE.WebGLRenderer;
  const pending=prepareSceneGpu(renderer,root,parent,new THREE.PerspectiveCamera(),new AbortController().signal);
  if(fails)await expect(pending).rejects.toThrow('warm failed');else await pending;
  expect(parent.children).toEqual([before,root,after]);expect(root.parent).toBe(parent);
  expect(geometry.drawRange).toEqual({start:3,count:12});expect(renderer.autoClear).toBe(true);
  expect(renderer.info.render).toEqual({calls:2,triangles:3});expect(scissor.toArray()).toEqual([3,4,80,60]);
  expect(test).toBe(false);expect(renderer.shadowMap.autoUpdate).toBe(true);
});

it('warms every retained resource with fewer foreground turns without accelerating background preparation',async()=>{
  let frames=0;
  vi.stubGlobal('requestAnimationFrame',(run:FrameRequestCallback)=>{frames++;queueMicrotask(()=>run(0));return frames;});
  vi.spyOn(performance,'now').mockReturnValue(0);
  try {
    const run=async(background:boolean)=>{
      frames=0;
      const root=new THREE.Group(),scene=new THREE.Scene(),material=new THREE.MeshStandardMaterial();
      for(let i=0;i<128;i++)root.add(new THREE.Mesh(new THREE.BoxGeometry(),material));
      const textures=Array.from({length:12},()=>new THREE.DataTexture(null,1024,1024));
      root.children.forEach((mesh,index)=>{
        const own=material.clone();own.map=textures[index%textures.length];(mesh as THREE.Mesh).material=own;
      });
      scene.add(root);
      const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,WAIT_FAILED:4,
        isContextLost:()=>false,fenceSync:()=>({}),flush:vi.fn(),clientWaitSync:()=>2,deleteSync:vi.fn()};
      const renderer={getContext:()=>gl,shadowMap:{enabled:false,type:0,autoUpdate:true,needsUpdate:false},
        compileAsync:vi.fn(async()=>{}),initTexture:vi.fn(),getRenderTarget:()=>null,setRenderTarget:vi.fn(),
        getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,info:{autoReset:true,render:{calls:0,triangles:0}},
        autoClear:true,getViewport:(v:THREE.Vector4)=>v.set(0,0,800,600),setViewport:vi.fn(),
        getScissor:(v:THREE.Vector4)=>v.set(0,0,800,600),setScissor:vi.fn(),getScissorTest:()=>false,setScissorTest:vi.fn(),render:vi.fn(),
      } as unknown as THREE.WebGLRenderer;
      await prepareSceneGpu(renderer,root,scene,new THREE.PerspectiveCamera(),new AbortController().signal,undefined,background);
      expect(renderer.render).toHaveBeenCalledTimes(128);expect(renderer.initTexture).toHaveBeenCalledTimes(12);
      expect(renderer.compileAsync).toHaveBeenCalledOnce();expect(root.parent).toBe(scene);
      root.traverse(node=>{if(node instanceof THREE.Mesh){expect(node.geometry.drawRange.count).toBe(Infinity);node.geometry.dispose();(node.material as THREE.Material).dispose();}});
      textures.forEach(texture=>texture.dispose());material.dispose();
      return frames;
    };
    const background=await run(true),foreground=await run(false);
    expect(background).toBeGreaterThanOrEqual(28);expect(foreground).toBeLessThan(background/2);
  }finally{vi.restoreAllMocks();}
});
