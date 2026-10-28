import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';

const browser=await chromium.launch({channel:'chromium'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  const quality=process.env.QUALITY??'auto',count=Number(process.env.BOTS??5),sampleMs=Number(process.env.SAMPLE_MS??6000);
  await page.addInitScript(({quality,count})=>{
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0,quality,frameLimit:60}));
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({botCount:count,skill:8,realMapChunk:'dust2-mid-ct',roundSeconds:180}));
    window.mapProfile={frames:[],collecting:false,engine:null,longTasks:[],parts:{}};
    new PerformanceObserver(list=>window.mapProfile.longTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,ms:entry.duration})))).observe({type:'longtask',buffered:true});
  },{quality,count});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.CPU_RATE??1)});
  const start=performance.now();
  await page.goto(process.env.DUEL_URL??'http://127.0.0.1:5176/');
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(entry=>entry.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(entry=>entry.name.includes('/duel/DuelEngine.ts')).name;
    const {DuelEngine}=await import(url),tick=DuelEngine.prototype.tick;
    for(const name of ['syncActors','report','processEvents']) {
      const original=DuelEngine.prototype[name];
      DuelEngine.prototype[name]=function(...args){
        const start=performance.now();try{return original.apply(this,args);}
        finally{if(window.mapProfile.collecting)window.mapProfile.parts[name]=(window.mapProfile.parts[name]??0)+performance.now()-start;}
      };
    }
    DuelEngine.prototype.tick=function(time){
      const p=window.mapProfile;p.engine=this;this.renderer.info.autoReset=false;this.renderer.info.reset();
      const start=performance.now();tick.call(this,time);
      if(p.collecting && this.renderer.info.render.calls)p.frames.push({cpu:performance.now()-start,
        calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,time});
    };
  });
  await page.getByRole('button',{name:'Enter duel',exact:true}).waitFor({timeout:120000});
  await page.waitForFunction(()=>!!window.mapProfile.engine);
  const readyMs=performance.now()-start;
  const assets=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/maps/')).map(entry=>({url:new URL(entry.name).pathname,bytes:entry.decodedBodySize,ms:entry.duration})));
  await page.getByRole('button',{name:'Enter duel',exact:true}).click();
  await page.evaluate(()=>{
    const e=window.mapProfile.engine,actor=e.sim.actors[0],watch=e.sim.arena.lanes[0].watch;
    actor.position={...watch};actor.feet=watch.y-1.6256;actor.health=1e6;
    const advance=e.sim.advance.bind(e.sim);
    e.sim.advance=function(...args){const start=performance.now();try{return advance(...args);}
      finally{if(window.mapProfile.collecting)window.mapProfile.parts.simulation=(window.mapProfile.parts.simulation??0)+performance.now()-start;}};
  });
  await page.waitForTimeout(1500);
  if(process.env.JS_PROFILE){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  if(process.env.TRACE_TIMELINE)await cdp.send('Tracing.start',{
    categories:'devtools.timeline,blink.user_timing,v8,disabled-by-default-devtools.timeline',transferMode:'ReturnAsStream'});
  await page.evaluate(nextChunk=>{
    const p=window.mapProfile;p.frames=[];p.parts={};p.collecting=true;p.sampleAt=performance.now();
    if(nextChunk){const e=p.engine;e.config={...e.config,realMapChunk:nextChunk};
      e.scenario.configureDuel(e.config);e.prefetchedSeed=undefined;e.prefetchAt=-Infinity;}
  },process.env.PRELOAD_CHUNK);
  await page.waitForTimeout(sampleMs);
  if(process.env.TRACE_TIMELINE){
    const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
    await cdp.send('Tracing.end');const {stream}=await complete,parts=[];
    try{while(true){const row=await cdp.send('IO.read',{handle:stream});
      parts.push(Buffer.from(row.data,row.base64Encoded?'base64':'utf8'));if(row.eof)break;}}
    finally{await cdp.send('IO.close',{handle:stream});}
    await fs.writeFile(`${process.env.REPORT??'research/real-map-performance'}.trace.json`,Buffer.concat(parts));
  }
  if(process.env.JS_PROFILE){const {profile}=await cdp.send('Profiler.stop');await fs.writeFile(`${process.env.REPORT??'research/real-map-performance'}.cpuprofile`,JSON.stringify(profile));}
  const report=await page.evaluate(()=>{
    const p=window.mapProfile;p.collecting=false;const e=p.engine;
    const q=(name,quantile)=>{const values=p.frames.map(row=>row[name]).sort((a,b)=>a-b);return +(values[Math.floor((values.length-1)*quantile)]??0).toFixed(2);};
    const gl=e.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    return {frames:p.frames.length,cpu50:q('cpu',.5),cpu95:q('cpu',.95),drawCalls:q('calls',.5),triangles:q('triangles',.5),
      parts:p.parts,textures:e.renderer.info.memory.textures,longTasks:p.longTasks,
      combatLongTasks:p.longTasks.filter(task=>task.start>=p.sampleAt),
      nextMap:{key:e.scenario?.prepared?.key,ready:e.scenario?.prepared?.ready??false},
      graphics:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unavailable',performance:e.performanceReport()};
  });
  const path=process.env.REPORT??'research/real-map-performance';
  await page.screenshot({path:path+'.png'});
  const result={readyMs,quality,count,sampleMs,cpuRate:Number(process.env.CPU_RATE??1),hardware:os.cpus()[0]?.model,
    note:'Automated local browser; competing workloads are not controlled. CPU throttling is not old-PC validation.',
    assets:{files:assets.length,bytes:assets.reduce((sum,asset)=>sum+asset.bytes,0)},report,errors};
  await fs.writeFile(path+'.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));if(errors.length)process.exitCode=1;
}finally{await browser.close();}
