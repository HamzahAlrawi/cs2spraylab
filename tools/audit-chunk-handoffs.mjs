import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'chromium'}),results=[],errors=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const cpuRate=Number(process.argv.find(arg=>arg.startsWith('--cpu-rate='))?.slice(11)??process.env.CPU_RATE??1);
  if(cpuRate!==1){const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});}
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(quality=>{
    performance.setResourceTimingBufferSize(10000);
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0,quality,frameLimit:60}));
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({botCount:5,skill:3,playerHealth:10000,realMapChunk:'dust2-mid-ct',feedbackSeconds:2}));
    window.handoffAudit={frames:[],parts:{},collect:false,engine:null};
  },process.env.QUALITY??'auto');
  await page.goto(process.env.DUEL_URL??'http://127.0.0.1:5176/');
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(row=>row.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(row=>row.name.includes('/duel/DuelEngine.ts')).name;
    const {DuelEngine}=await import(url),tick=DuelEngine.prototype.tick;
    for(const name of ['createSimulation','finishRestart','rebuildCovers','rebuildActors']){
      const original=DuelEngine.prototype[name];
      DuelEngine.prototype[name]=function(...args){const start=performance.now();try{return original.apply(this,args);}
        finally{if(window.handoffAudit.collect)(window.handoffAudit.parts[name]??=[]).push(performance.now()-start);}};
    }
    const restart=DuelEngine.prototype.restart;
    DuelEngine.prototype.restart=function(...args){if(window.handoffAudit.collect)window.handoffAudit.started=performance.now();return restart.apply(this,args);};
    DuelEngine.prototype.tick=function(time){const audit=window.handoffAudit;audit.engine=this;const start=performance.now();tick.call(this,time);
      if(audit.collect)audit.frames.push({at:start,ms:performance.now()-start,loading:this.loadingMap,map:this.scenario.chunk.id});};
  });
  await page.getByRole('button',{name:'Enter duel',exact:true}).waitFor({timeout:120000});
  await page.getByRole('button',{name:'Enter duel',exact:true}).click();
  for(const id of ['dust2-a-short','dust2-b-entry']){
    await page.evaluate(async id=>{
      const e=window.handoffAudit.engine;e.config={...e.config,realMapChunk:id};e.scenario.configureDuel(e.config);
      e.sim.actors[0].health=1e9;e.sim.config.roundSeconds=10000;
      const path='/src/range/duel/scene-preparation.ts',{prepareSceneGpu}=await import(path);
      e.scenario.prefetchRound(e.seed,(scene,signal)=>prepareSceneGpu(e.renderer,scene,e.scene,e.camera,signal,e.settings.quality));
    },id);
    await page.waitForFunction(()=>window.handoffAudit.engine.scenario.prepared.ready,null,{timeout:90000});
    await page.evaluate(()=>{
      const a=window.handoffAudit,e=a.engine;a.frames=[];a.parts={};a.collect=true;a.begin=performance.now();
      e.sim.phase='result';e.sim.outcome='won';e.roundFlow.finish();
    });
    await page.waitForFunction(id=>{const e=window.handoffAudit.engine;return e.scenario.chunk.id===id&&!e.loadingMap&&e.sim.phase==='fighting';},id,{timeout:90000});
    await page.waitForTimeout(3000);
    const row=await page.evaluate(id=>{
      const a=window.handoffAudit;a.collect=false;const start=a.started,frames=a.frames.filter(frame=>frame.at>=start);
      const ready=frames.find(frame=>!frame.loading&&frame.map===id);
      const live=frames.filter(frame=>!frame.loading&&frame.map===id&&frame.at>=ready.at&&frame.at<ready.at+3000);
      return {map:a.engine.scenario.chunk.id,handoffMs:ready.at-start,
        firstFrames:frames.slice(0,20),parts:a.parts,maxFrameMs:Math.max(...live.map(frame=>frame.ms)),sampleSeconds:3};
    },id);
    results.push(row);console.log(JSON.stringify(row));
    assert.ok(row.handoffMs<500,`Prepared ${id} handoff exceeded 500 ms: ${row.handoffMs}`);
    await page.screenshot({path:`research/handoff-${id}.png`});
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();await fs.writeFile(process.env.REPORT??(process.argv.includes('--cpu-rate=4')?'research/chunk-handoffs-cpu4.json':'research/chunk-handoffs.json'),JSON.stringify({results,errors},null,2));}
