import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';

// Isolated loader timing. No renderer, game process, or application mutations.
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});
const browser=await chromium.launch({channel:'chromium'}),results=[];
try {
  await server.listen();
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  for(const cpu of [1,4]) {
    const context=await browser.newContext();
    try {
      const page=await context.newPage();
      await page.route('**/loader-audit',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Loader audit</title>'}));
      await page.goto(origin+'/loader-audit');
      const cdp=await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
      const report=await page.evaluate(async()=>{
        const [{loadRealMapChunk,realMapChunks},{NativeMapCollision}]=await Promise.all([
          import('/src/range/duel/real-map.ts'),import('/src/range/prefire/native-collision.ts')]);
        const rows=[],create=NativeMapCollision.create;
        let collisionMs=0;
        NativeMapCollision.create=async function(...args){
          const start=performance.now();try{return await create.apply(this,args);}
          finally{collisionMs=performance.now()-start;}
        };
        let previous;
        try {
          for(const id of ['dust2-mid-ct','dust2-a-short','dust2-mid-ct']) {
            const start=performance.now(),map=await loadRealMapChunk(realMapChunks.find(chunk=>chunk.id===id),new AbortController().signal);
            rows.push({id,totalMs:performance.now()-start,collisionMs,...map.loadStats});
            previous?.dispose();previous=map;
          }
        }finally{previous?.dispose();NativeMapCollision.create=create;}
        return rows;
      });
      results.push({cpuRate:cpu,results:report});
      console.log(JSON.stringify({cpuRate:cpu,results:report}));
    }finally{await context.close();}
  }
}finally{
  await browser.close();await server.close();
  await fs.mkdir('research',{recursive:true});
  await fs.writeFile(process.env.REPORT??'research/duel-loader-stages-2026-10-22.json',JSON.stringify({
    note:'Development module imports finish before timing. Isolated local loader without rendering; collision timing includes validation and first-use Rapier initialization. Sequential maps keep only the current map while loading the next. CPU throttling is synthetic.',results},null,2));
}
