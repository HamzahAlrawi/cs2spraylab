import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';

test.skip(!existsSync('public/revamp/maps/dust2/duel/dust2-mid-ct/chunk.json'),'Native assets required');
test('background map GPU preparation uploads retained buffers and preserves rendering',async({page},info)=>{
  test.skip(!['chromium','mobile-chromium'].includes(info.project.name));test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/gpu-map-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>GPU preparation</title><style>body{margin:0}</style>'}));
  await page.goto('/gpu-map-test');
  const result=await page.evaluate(async()=>{
    const mapPath='/src/range/duel/real-map.ts',warmPath='/src/range/duel/scene-preparation.ts';
    const {loadRealMapChunk,realMapChunks}=await import(mapPath),{prepareSceneGpu}=await import(warmPath);
    const threePath=performance.getEntriesByType('resource').find(entry=>/\/three\.js\?/.test(entry.name))!.name;
    const THREE=await import(threePath);
    const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    renderer.setSize(innerWidth,innerHeight);document.body.appendChild(renderer.domElement);
    const scene=new THREE.Scene();scene.background=new THREE.Color('#aabac8');
    scene.add(new THREE.HemisphereLight('#e4ebff','#686757',1.2),new THREE.AmbientLight('#ffffff',.5));
    const camera=new THREE.PerspectiveCamera(74,innerWidth/innerHeight,.03,200);
    camera.position.set(-395*.0254,40*.0254,-1004*.0254);camera.lookAt(-395*.0254,40*.0254,-1500*.0254);camera.updateMatrixWorld(true);
    const signal=new AbortController().signal,map=await loadRealMapChunk(realMapChunks.find((chunk:{id:string})=>chunk.id==='dust2-mid-ct'),signal,true);
    const ranges:unknown[]=[];map.scene.traverse((mesh:any)=>{if(mesh.isMesh)ranges.push({...mesh.geometry.drawRange});});
    renderer.setClearColor('#de2468',1);renderer.clear(true,true,true);
    const gl=renderer.getContext(),unchanged=new Uint8Array(innerWidth*innerHeight*4);
    gl.readPixels(0,0,innerWidth,innerHeight,gl.RGBA,gl.UNSIGNED_BYTE,unchanged);
    renderer.setViewport(3,4,100,80);renderer.setScissor(5,6,70,60);renderer.setScissorTest(true);
    renderer.autoClear=false;renderer.shadowMap.needsUpdate=true;
    Object.assign(renderer.info.render,{frame:17,calls:23,triangles:29,points:31,lines:37});
    const state=()=>({viewport:renderer.getViewport(new THREE.Vector4()).toArray(),scissor:renderer.getScissor(new THREE.Vector4()).toArray(),
      scissorTest:renderer.getScissorTest(),autoClear:renderer.autoClear,shadow:renderer.shadowMap.needsUpdate,shadowAuto:renderer.shadowMap.autoUpdate,
      target:renderer.getRenderTarget(),autoReset:renderer.info.autoReset,render:{...renderer.info.render}});
    const before=state(),start=performance.now();await prepareSceneGpu(renderer,map.scene,scene,camera,signal,'auto');
    const preserved=JSON.stringify(before)===JSON.stringify(state());
    const afterPixels=new Uint8Array(unchanged.length);gl.readPixels(0,0,innerWidth,innerHeight,gl.RGBA,gl.UNSIGNED_BYTE,afterPixels);
    const pixelsPreserved=unchanged.every((value,index)=>value===afterPixels[index]);
    const warmMs=performance.now()-start,geometryBefore=renderer.info.memory.geometries,after:unknown[]=[];
    map.scene.traverse((mesh:any)=>{if(mesh.isMesh)after.push({...mesh.geometry.drawRange});});
    const detached=map.scene.parent===null;scene.add(map.scene);map.updateVisibility(camera.position);
    renderer.setViewport(0,0,innerWidth,innerHeight);renderer.setScissorTest(false);renderer.autoClear=true;renderer.render(scene,camera);
    const pixels=new Uint8Array(innerWidth*innerHeight*4);gl.readPixels(0,0,innerWidth,innerHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let changed=0;for(let i=4;i<pixels.length;i+=4)if(pixels[i]!==pixels[0]||pixels[i+1]!==pixels[1]||pixels[i+2]!==pixels[2])changed++;
    (window as any).disposeGpuTest=()=>{map.dispose();renderer.dispose();};
    return {detached,preserved,pixelsPreserved,geometryBefore,rangesMatch:JSON.stringify(ranges)===JSON.stringify(after),changed,warmMs};
  });
  expect(result.detached).toBe(true);expect(result.preserved).toBe(true);expect(result.pixelsPreserved).toBe(true);
  expect(result.rangesMatch).toBe(true);expect(result.geometryBefore).toBeGreaterThan(10);
  expect(result.changed).toBeGreaterThan(10000);expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('prepared-native-map.png')});
  console.log('GPU-ready native map:',JSON.stringify(result));await page.evaluate(()=>(window as any).disposeGpuTest());
});
