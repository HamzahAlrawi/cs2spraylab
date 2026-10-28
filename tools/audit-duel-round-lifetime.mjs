import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chromium'}),rows=[],errors=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const cdp=await page.context().newCDPSession(page);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
  await page.addInitScript(()=>{
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0,quality:'performance'}));
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({skill:3,botCount:3,realMapChunk:'dust2-mid-ct'}));
  });
  await page.goto(process.env.DUEL_URL??'http://127.0.0.1:5176/');
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(row=>row.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(row=>row.name.includes('/duel/DuelEngine.ts')).name;
    const {DuelEngine}=await import(url),tick=DuelEngine.prototype.tick;
    DuelEngine.prototype.tick=function(time){window.lifetimeEngine=this;return tick.call(this,time);};
  });
  await page.getByRole('button',{name:'Enter duel',exact:true}).waitFor({timeout:120000});
  const catalog=JSON.parse(await fs.readFile('src/range/duel/real-map-catalog.json','utf8'));
  const sequence=[...catalog.chunks.map(chunk=>chunk.id),'dust2-mid-ct','dust2-a-short','dust2-mid-ct','dust2-a-short'];
  for(const id of sequence) {
    await page.evaluate(id=>{const e=window.lifetimeEngine;e.pause();e.scenario.configureDuel({...e.config,realMapChunk:id});e.restart();},id);
    await page.waitForFunction(id=>{const e=window.lifetimeEngine;return !e.loadingMap&&e.scenario.chunk.id===id;},id,{timeout:90000});
    await page.waitForTimeout(80);
    rows.push(await page.evaluate(()=>{
      const e=window.lifetimeEngine,recording=e.sim.replay.export();e.scenario.replayMap(recording.setup.geometrySha256);
      e.scenario.updateView(e.camera.position);e.scenario.replayMap();
      return {chunk:e.scenario.chunk.id,sceneMaps:e.scenario.scene.children.filter(node=>node===e.scenario.map.scene||node===e.scenario.previous?.scene).length,
        ownedMaps:new Set([e.scenario.map,e.scenario.previous,e.scenario.prepared?.slot?.value].filter(Boolean)).size,
        preparedKey:e.scenario.prepared?.key,preparedReady:e.scenario.prepared?.ready??false,
        rigs:e.viewModels.size,actors:e.models.size,textures:e.renderer.info.memory.textures,geometries:e.renderer.info.memory.geometries,
        heap:performance.memory?.usedJSHeapSize};
    }));
    assert.equal(rows.at(-1).sceneMaps,1);assert(rows.at(-1).ownedMaps<=3);assert(rows.at(-1).rigs<=3);assert.equal(rows.at(-1).actors,3);
    await cdp.send('HeapProfiler.collectGarbage');
    rows.at(-1).collectedHeap=await cdp.send('Runtime.getHeapUsage');
  }
  const pairA=rows.at(-3).collectedHeap,pairB=rows.at(-1).collectedHeap;
  assert(pairB.usedSize<pairA.usedSize+16*1024*1024,'repeating the same two chunks must not retain another scene');
  await page.screenshot({path:'research/fidelity-round-lifetime.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({rows,errors},null,2));
}finally{
  await browser.close();await fs.writeFile('research/fidelity-round-lifetime.json',JSON.stringify({rows,errors},null,2));
}
