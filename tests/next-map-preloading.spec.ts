import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';

test.skip(!existsSync('public/revamp/maps/dust2/duel/dust2-mid-ct/chunk.json'),'Native chunk assets required');
test('prepares one next chunk and reuses verified local bytes after a fresh page',async({page,context},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/next-map-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Next chunk preparation</title>'}));
  await page.addInitScript(()=>Object.defineProperty(navigator,'deviceMemory',{value:8,configurable:true}));
  await page.goto('/next-map-test');
  const first=await page.evaluate(async()=>{
    const path='/src/range/duel/real-map.ts',configPath='/src/range/duel/config.ts';
    const {RealMapSession}=await import(path),{sanitizeDuelConfig}=await import(configPath);
    const session=await RealMapSession.load(sanitizeDuelConfig({realMapChunk:'dust2-mid-ct'}),1,new AbortController().signal);
    session.configureDuel(sanitizeDuelConfig({realMapChunk:'dust2-a-short'}));let warmed=0;
    session.prefetchRound(2,async(_scene:unknown,signal:AbortSignal)=>{signal.throwIfAborted();warmed++;});
    const state=session as any,start=performance.now();
    while(!state.prepared.ready&&performance.now()-start<90000)await new Promise(resolve=>setTimeout(resolve,20));
    if(!state.prepared.ready)throw new Error('Next chunk did not become ready');
    const prepared=state.prepared.slot.value,requests=performance.getEntriesByType('resource').length,transition=performance.now();
    await session.prepareRound(2,new AbortController().signal);
    const result={same:state.map===prepared,warmed,transitionMs:performance.now()-transition,
      placeholderChildren:session.scene.getObjectByName('duel-route-arrows')?.children.length,
      newRequests:performance.getEntriesByType('resource').length-requests,chunk:session.chunk.id};
    session.configureDuel(sanitizeDuelConfig({realMapChunk:'dust2-b-entry'}));
    session.prefetchRound(3);const nextAt=performance.now();
    while(!state.prepared.ready&&performance.now()-nextAt<90000)await new Promise(resolve=>setTimeout(resolve,20));
    if(!state.prepared.ready)throw new Error('Third chunk did not become ready');
    const third=state.prepared.slot.value,owned=new Set([state.map,state.previous,third]).size;
    const attached=session.scene.children.filter(child=>[state.map.scene,state.previous.scene,third.scene].includes(child)).length;
    session.configureDuel(sanitizeDuelConfig({realMapChunk:'dust2-long-doors'}));
    const cancelled=state.prepared.key===undefined&&third.scene.children.length===0&&third.collision.disposed;
    const moduleUrl=(path:string)=>performance.getEntriesByType('resource').find(entry=>entry.name.includes(path))?.name??path;
    session.dispose();const cachePath=moduleUrl('/src/range/prefire/asset-delivery.ts'),queryPath=moduleUrl('/src/range/prefire/query-cache.ts');
    await (await import(cachePath)).settleAssetCache();await (await import(queryPath)).settleQueryCache();
    const reportPath=moduleUrl('/src/range/prefire/collision-preparation.ts');return {...result,owned,attached,cancelled,collision:(await import(reportPath)).collisionPreparationReport()};
  });
  expect(first.same).toBe(true);expect(first.warmed).toBe(1);expect(first.chunk).toBe('dust2-a-short');expect(first.newRequests).toBe(0);
  expect(first.transitionMs).toBeLessThan(250);
  expect(first.placeholderChildren,'do not physically walk a temporary route before selecting the actual round guide').toBe(0);
  expect(first.owned).toBe(3);expect(first.attached).toBe(1);expect(first.cancelled).toBe(true);
  expect(first.collision.map((entry:{source:string})=>entry.source)).toEqual(['worker','worker','worker']);
  // Disable HTTP caching: this witness must pass via app-owned local storage.
  const cdp=await context.newCDPSession(page);await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await page.reload();const objects:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/maps/'))objects.push(request.url());});
  const repeat=await page.evaluate(async()=>{
    const path='/src/range/duel/real-map.ts',{loadRealMapChunk,realMapChunks}=await import(path);
    const map=await loadRealMapChunk(realMapChunks.find((chunk:{id:string})=>chunk.id==='dust2-a-short'),new AbortController().signal);
    const surfaces=map.collision.surfaceDiagnostics.sourceSurfaces;map.dispose();
    const reportPath=performance.getEntriesByType('resource').find(entry=>entry.name.includes('/src/range/prefire/collision-preparation.ts'))?.name??'/src/range/prefire/collision-preparation.ts';
    return {surfaces,collision:(await import(reportPath)).collisionPreparationReport()};
  });
  expect(repeat.surfaces).toBeGreaterThan(0);expect(objects).toEqual([]);expect(errors).toEqual([]);
  expect(repeat.collision[0].source).toBe('disk');
  console.log('Prepared map transition / page-lifetime disk reuse:',JSON.stringify({first,repeat,networkMapRequests:objects.length}));
});

test('all visited chunks reload from app storage with every map request blocked and HTTP caching disabled',async({page,context},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(240000);
  const errors:string[]=[],requests:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/local-map-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local maps</title>'}));
  await page.goto('/local-map-test');
  const warmed=await page.evaluate(async()=>{
    const path='/src/range/duel/real-map.ts',{loadRealMapChunk,realMapChunks}=await import(path),rows=[];
    for(const chunk of realMapChunks){const map=await loadRealMapChunk(chunk,new AbortController().signal);rows.push({id:chunk.id,hash:map.collision.collisionSha256});map.dispose();}
    const url=(path:string)=>performance.getEntriesByType('resource').find(entry=>entry.name.includes(path))?.name??path;
    await (await import(url('/src/range/prefire/asset-delivery.ts'))).settleAssetCache();
    await (await import(url('/src/range/prefire/query-cache.ts'))).settleQueryCache();return rows;
  });
  const cdp=await context.newCDPSession(page);await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await page.route('**/maps/**',route=>{
    // Development source modules may also live in a maps/ folder. Block every
    // native asset request, not the JavaScript that selects the cached package.
    if(!new URL(route.request().url()).pathname.startsWith('/maps/'))return route.continue();
    requests.push(route.request().url());return route.abort('blockedbyclient');
  });
  await page.reload();
  const replayed=await page.evaluate(async()=>{
    const path='/src/range/duel/real-map.ts',{loadRealMapChunk,realMapChunks}=await import(path),rows=[];
    for(const chunk of [...realMapChunks].reverse()) {
      const map=await loadRealMapChunk(chunk,new AbortController().signal);
      if(!map.scene.getObjectByName('duel-distant-native-context'))throw Error('Cached context missing');
      rows.push({id:chunk.id,hash:map.collision.collisionSha256});map.dispose();
    }
    return rows.reverse();
  });
  expect(replayed).toEqual(warmed);expect(warmed).toHaveLength(8);expect(requests).toEqual([]);expect(errors).toEqual([]);
  console.log('All previously visited chunks: zero map requests, HTTP cache disabled, fresh page');
});
