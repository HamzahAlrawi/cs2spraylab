import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';

test.skip(!existsSync('public/revamp/maps/dust2/collision.bin'),'Local native map assets required');
test('loads actual Dust 2 resources and releases scenes with bounded idle image reuse',async({page})=>{
  test.setTimeout(120000);
  // Isolate the loader from the app and shared-repo HMR reloads.
  await page.route('**/native-map-smoke',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Map Loading Test</title>'}));
  await page.goto('/native-map-smoke');
  const result=await page.evaluate(async()=>{
    const modulePath='/src/range/prefire/map.ts';
    const {loadDust2,compileMapShaders}=await import(modulePath);
    const created=new Set<string>(),revoked=new Set<string>();
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=create(blob);created.add(url);return url;};
    URL.revokeObjectURL=url=>{revoked.add(url);revoke(url);};
    const start=performance.now(),map=await loadDust2();
    let meshes=0;map.scene.traverse((node:{isMesh?:boolean})=>{if(node.isMesh)meshes++;});
    let compiled=false;
    await compileMapShaders({compileAsync:async()=>{compiled=true;}},{} as never,{} as never);
    const diagnostics={...map.collision.surfaceDiagnostics};
    map.dispose();map.dispose();
    const aborted=new AbortController();aborted.abort();
    let abortName='';try{await loadDust2(aborted.signal);}catch(error){abortName=(error as Error).name;}
    return {meshes,diagnostics,compiled,abortName,urls:created.size,revoked:revoked.size,empty:map.scene.children.length===0,elapsedMs:performance.now()-start};
  });
  console.log('Native loader smoke:',JSON.stringify(result));
  expect(result.meshes).toBeGreaterThan(100);
  expect(result.diagnostics.sourceSurfaces).toBe(31);
  expect(result.diagnostics.validatedSolids).toBeGreaterThan(1000);
  expect(result.urls).toBeGreaterThan(0);expect(result.revoked).toBe(result.urls);
  expect(result.compiled).toBe(true);expect(result.abortName).toBe('AbortError');expect(result.empty).toBe(true);
});

test('warm decoded images retain identical rendered pixels across map disposal and reload', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'GPU texture lifecycle regression'); test.setTimeout(120000);
  await page.route('**/warm-map-smoke', route => route.fulfill({contentType:'text/html',body:'<!doctype html><title>Warm map</title>'}));
  await page.goto('/warm-map-smoke');
  const result = await page.evaluate(async () => {
    const mapPath = '/src/range/prefire/map.ts';
    const {loadDust2} = await import(mapPath);
    const threePath=performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname.endsWith('/deps/three.js'))!.name;
    const THREE = await import(threePath);
    const renderer = new THREE.WebGLRenderer({antialias: false, preserveDrawingBuffer: true}); renderer.setSize(640,360);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#bbc9d1');
    scene.add(new THREE.HemisphereLight('#ffffff','#4c5a48',2), new THREE.AmbientLight('#ffffff',1));
    const camera = new THREE.PerspectiveCamera(74,640/360,.03,180);
    camera.position.set(615*.0254,65*.0254,-188*.0254); camera.lookAt(660*.0254,65*.0254,-350*.0254);
    const pixels = () => {
      renderer.render(scene,camera); const gl = renderer.getContext(), data = new Uint8Array(640*360*4);
      gl.readPixels(0,0,640,360,gl.RGBA,gl.UNSIGNED_BYTE,data); return data;
    };
    const first = await loadDust2(); scene.add(first.scene); first.updateVisibility(camera.position);
    const a = pixels(); scene.remove(first.scene); first.dispose();
    const second = await loadDust2(); scene.add(second.scene); second.updateVisibility(camera.position);
    const b = pixels(); let changed = 0, variation = 0;
    for (let i=0;i<a.length;i++) {if(a[i]!==b[i])changed++; if(a[i]!==a[i%4])variation++;}
    const stats = second.loadStats; scene.remove(second.scene); second.dispose(); renderer.dispose();
    return {changed,variation,stats};
  });
  expect(result.variation).toBeGreaterThan(1000); expect(result.changed).toBe(0);
  expect(result.stats.decodedReused).toBeGreaterThan(0); expect(result.stats.warmBudgetBytes).toBe(32*1024*1024);
});

test('cancelled maps discard queued texture work and release every started decode',async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(120000);
  await page.route('**/cancel-map-smoke',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Cancelled map</title>'}));
  await page.goto('/cancel-map-smoke');
  const result=await page.evaluate(async()=>{
    const modulePath='/src/range/prefire/map.ts',{loadDust2}=await import(modulePath);
    const controller=new AbortController(),decode=createImageBitmap.bind(window);
    let started=0,closed=0;
    window.createImageBitmap=((...args:Parameters<typeof createImageBitmap>)=>{
      started++;if(started===4)controller.abort();
      return (decode as any)(...args).then((image:ImageBitmap)=>{
        const close=image.close.bind(image);image.close=()=>{closed++;close();};return image;
      });
    }) as typeof createImageBitmap;
    let error='';try{await loadDust2(controller.signal);}catch(reason){error=(reason as Error).name;}
    return {started,closed,error};
  });
  expect(result.error).toBe('AbortError');expect(result.started).toBe(4);expect(result.closed).toBe(result.started);
});
