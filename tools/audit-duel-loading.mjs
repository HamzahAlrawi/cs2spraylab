import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chromium, expect} from '@playwright/test';
import sharp from 'sharp';

// Audit only: fresh browser storage, production assets, no application changes.
const base = process.env.DUEL_URL ?? 'https://spraylab.pages.dev/';
const output = process.env.REPORT ?? 'research/duel-loading-audit-2026-10-22.json';
const root = 'public/revamp/maps/dust2/duel';
const catalog = JSON.parse(await fs.readFile('src/range/duel/real-map-catalog.json', 'utf8'));
const inventory = [];
const uniqueImages = new Map();
for (const chunk of catalog.chunks) {
  const folder = path.join(root, chunk.id);
  const manifest = JSON.parse(await fs.readFile(path.join(folder, 'chunk.json'), 'utf8'));
  const visual = JSON.parse(await fs.readFile(path.join(folder, 'visual.json'), 'utf8'));
  const files = new Set(['chunk.json', 'navigation.json', 'collision.json', 'collision.bin', 'visual.json', ...visual.files]);
  if (manifest.radar) {files.add('radar.json'); files.add('radar.png');}
  const packed = new Set(visual.texturePack?.images.map(image => image.name));
  if (visual.texturePack) files.add(visual.texturePack.name);
  for (const resource of visual.resources) {
    if (!packed.has(resource.name)) files.add(resource.name);
    if (resource.name.endsWith('.webp')) uniqueImages.set(resource.sha256, resource.bytes);
  }
  const sizes = {};
  for (const file of files) sizes[file] = (await fs.stat(path.join(folder, file))).size;
  inventory.push({id:chunk.id, sourceBuild:manifest.build, files:sizes,
    mapBytes:Object.values(sizes).reduce((a,b)=>a+b,0),
    textureBytes:manifest.visualOptimization.after.textureBytes,
    decodedImageBytes:manifest.visualOptimization.after.decodedRGBABytes,
    triangles:manifest.visualOptimization.after.triangles,
    primitives:manifest.visualOptimization.after.primitives});
}
const summary = {
  sumTextureBytes:inventory.reduce((sum,row)=>sum+row.textureBytes,0),
  uniqueImageBytes:[...uniqueImages.values()].reduce((sum,bytes)=>sum+bytes,0),
  uniqueImages:uniqueImages.size,
};
const results = [], browser = await chromium.launch({channel:'chromium'});
async function measure(page, label, reload=false) {
  const errors = [], failed = [];
  const onError = error => errors.push(error.message);
  const onResponse = response => {
    if (response.status() >= 400 && new URL(response.url()).origin === new URL(base).origin)
      failed.push({url:response.url(),status:response.status()});
  };
  page.on('pageerror',onError); page.on('response',onResponse);
  const started = performance.now();
  if (reload) await page.reload({waitUntil:'domcontentloaded'});
  else await page.goto(base,{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeEnabled({timeout:180000});
  const controlsReadyMs = performance.now()-started;
  const canvas = page.locator('canvas[data-duel]');
  await expect.poll(async()=>{
    const stats=await sharp(await canvas.screenshot()).stats();
    return stats.channels.slice(0,3).every(channel=>channel.stdev>10);
  },{timeout:45000}).toBe(true);
  const texturedFrameMs=performance.now()-started;
  await page.waitForTimeout(1200);
  const report = await page.evaluate(()=>({
    resources:performance.getEntriesByType('resource').filter(row=>/^https?:/.test(row.name)).map(row=>({
      path:new URL(row.name).pathname,start:row.startTime,end:row.responseEnd,ms:row.duration,
      transferred:row.transferSize,encoded:row.encodedBodySize,decoded:row.decodedBodySize})),
    longTasks:window.loadingAudit.longTasks,
    images:window.loadingAudit.images,
    memory:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:undefined,
  }));
  const mapResources=report.resources.filter(row=>row.path.startsWith('/maps/'));
  const row={label,controlsReadyMs,texturedFrameMs,mapFiles:mapResources.length,
    mapTransferredBytes:mapResources.reduce((sum,r)=>sum+r.transferred,0),
    mapDecodedBytes:mapResources.reduce((sum,r)=>sum+r.decoded,0),
    lastMapResponseMs:Math.max(0,...mapResources.map(r=>r.end)),
    longestTaskMs:Math.max(0,...report.longTasks.map(r=>r.ms)),errors,failed,...report};
  results.push(row);
  console.log(JSON.stringify({label,controlsReadyMs:Math.round(controlsReadyMs),texturedFrameMs:Math.round(texturedFrameMs),
    mapTransferredMB:+(row.mapTransferredBytes/1e6).toFixed(2),longestTaskMs:row.longestTaskMs,errors,failed}));
  page.off('pageerror',onError);page.off('response',onResponse);
  if(errors.length||failed.length)throw new Error('Live loading audit found browser/asset errors');
}
try {
  for (const scenario of [
    {label:'mid-cold',chunk:'dust2-mid-ct',cpu:1,warm:true},
    {label:'catwalk-20mbps-50ms',chunk:'dust2-a-short',cpu:1,mbps:20,latency:50},
    {label:'mid-4x-cpu',chunk:'dust2-mid-ct',cpu:4},
  ]) {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    try {
      await context.addInitScript(({chunk})=>{
        localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0,quality:'performance',frameLimit:60}));
        localStorage.setItem('spraylab.duel.v1',JSON.stringify({botCount:3,skill:3,realMapChunk:chunk}));
        performance.setResourceTimingBufferSize(10000);
        window.loadingAudit={longTasks:[],images:[]};
        new PerformanceObserver(list=>window.loadingAudit.longTasks.push(...list.getEntries().map(row=>({start:row.startTime,ms:row.duration})))).observe({type:'longtask',buffered:true});
        const original=createImageBitmap.bind(window);
        window.createImageBitmap=async(...args)=>{
          const start=performance.now(),image=await original(...args);
          window.loadingAudit.images.push({start,ms:performance.now()-start,width:image.width,height:image.height});
          return image;
        };
      },scenario);
      const page=await context.newPage(),cdp=await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:scenario.cpu});
      if(scenario.mbps)await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:scenario.latency,
        downloadThroughput:scenario.mbps*1e6/8,uploadThroughput:scenario.mbps*1e6/8,connectionType:'wifi'});
      await measure(page,scenario.label);
      if(scenario.warm)await measure(page,'mid-browser-cache-reload',true);
    }finally{await context.close();}
  }
}finally{
  await browser.close();
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify({date:new Date().toISOString(),base,hardware:os.cpus()[0]?.model,
    note:'Headless Chromium on this PC. Network/CPU throttling are synthetic; controls-ready is not proof every model/audio asset is ready. Browser cache reload discards the JS scene cache. Screenshot readiness includes readback overhead. No application code changed.',
    inventory,summary,results},null,2));
}
