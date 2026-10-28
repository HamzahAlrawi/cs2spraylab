import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import fs from 'node:fs/promises';

const rate = Number(process.env.CPU_RATE ?? 4);
const label = (process.env.PROFILE_LABEL ?? '').replace(/[^a-z0-9-]/gi,'');
const output = `research/duel-poi-profile${label ? `-${label}` : ''}`;
const quality = ['auto','high','low','performance'].includes(process.env.PROFILE_QUALITY) ? process.env.PROFILE_QUALITY : 'performance';
const cpuProfile = process.env.PROFILE_CPU === '1';
const server = await createServer({server:{host:'127.0.0.1',port:0,strictPort:true},logLevel:'error'});
await server.listen();
const browser = await chromium.launch({channel:'chromium'});
try {
  await fs.mkdir(output,{recursive:true});
  const page = await browser.newPage({viewport:{width:1440,height:900}}), errors = [];
  page.on('pageerror',error => errors.push(error.message));
  await page.addInitScript(quality => {
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0,quality,frameLimit:60}));
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({generatedMaps:true,botCount:5,skill:5,playerHealth:500,roundSeconds:180}));
  },quality);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.locator('canvas[data-duel]').waitFor();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/duel/DuelEngine.ts')).name;
    const {DuelEngine} = await import(url), tick = DuelEngine.prototype.tick;
    window.duelProfile = {engine:null,collect:false,records:[],stages:{}};
    const instrument = (target,name,key) => {
      const method=target[name];target[name]=function(...args) {
        const start=performance.now();try{return method.apply(this,args);}
        finally{const stages=window.duelProfile.stages;stages[key]=(stages[key]??0)+performance.now()-start;}
      };
    };
    for(const name of ['syncActors','processEvents','syncEnvironment'])instrument(DuelEngine.prototype,name,name);
    let last = 0;
    DuelEngine.prototype.tick = function(time) {
      const p = window.duelProfile; p.engine = this;
      p.stages={};
      if(this.sim!==p.instrumentedSim){p.instrumentedSim=this.sim;instrument(this.sim,'advance','simulation');}
      if(!p.renderer){p.renderer=this.renderer;instrument(this.renderer,'render','render');}
      this.renderer.info.autoReset = false; this.renderer.info.reset();
      const start = performance.now(); tick.call(this,time);
      if (this.renderer.info.render.calls) {
        if (p.collect) p.records.push({cpu:performance.now()-start,frame:time-last,calls:this.renderer.info.render.calls,
          visible:[...this.models.values()].filter(m=>m.visible).length,
          smoke:this.scene.getObjectByName('utility-smoke')?.count??0,fire:this.scene.getObjectByName('utility-fire')?.count??0,...p.stages});
        last = time;
      }
    };
  });
  await page.waitForFunction(() => {
    const e=window.duelProfile?.engine;
    return e?.criticalReady&&!e.loadingMap&&!e.worldLoading.size&&!e.gestureLoading.size;
  });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate',{rate});
  if(cpuProfile){await session.send('Profiler.enable');await session.send('Profiler.start');}
  const results = [];
  for (const [bots,scale,stress,utilities] of [[1,.65,false,false],[5,1,false,false],[5,1,true,false],[5,1,true,true]]) {
    await page.evaluate(({bots,scale}) => {
      const p = window.duelProfile,e = p.engine;
      window.profileCoverClone?.removeFromParent();
      e.seed=431;
      e.setConfig({...e.config,botCount:bots,arenaScale:scale,mapDesign:'Freight yard'});
      e.covers.visible=true;
    },{bots,scale});
    await page.waitForFunction(()=>{
      const e=window.duelProfile.engine;return !e.loadingMap&&!e.worldLoading.size&&!e.gestureLoading.size;
    });
    await page.evaluate(({stress,utilities})=>{
      const e=window.duelProfile.engine;
      if (stress) {
        // Bypass cover culling but retain the frustum; visibleBots reports the
        // actual actor coverage instead of assuming a worst-case rig sample.
        window.profileCoverClone = e.covers.clone(true); e.scene.add(window.profileCoverClone); e.covers.visible = false;
        // Apply only AFTER async restart, which otherwise overwrites this setup.
        e.sim.actors[0].position={x:0,y:1.6256,z:8};e.sim.actors[0].feet=0;e.sim.actors[0].yaw=0;e.sim.actors[0].pitch=0;
        for(const actor of e.sim.actors.slice(1)) {
          actor.position={x:(actor.id-3)*1.2,y:1.6256,z:-4};actor.feet=0;actor.velocity={x:0,z:0};
          e.sim.command(actor.id,{});
        }
      }
      e.sim.start(); e.sim.resume(); e.paused = false; e.sim.actors[0].health = 10000;
      if(utilities)for(const [kind,x]of [['smoke',-2],['molotov',2]])
        e.sim.utilities.throw({actorId:0,side:'player',kind,origin:{x,y:.1,z:2},direction:{x:0,y:-1,z:0},
          velocity:{x:0,y:4.572,z:0},strength:0,time:e.sim.time});
    },{stress,utilities});
    await page.waitForTimeout(1500);
    await page.evaluate(async () => {
      const path='/src/range/performance.ts', {FrameMetrics}=await import(path);
      const e=window.duelProfile.engine;
      e.inputName='Drag aim (automated CPU profile)';e.renderer.domElement.focus();
      e.sim.start();e.sim.resume();e.paused=false;e.sessionStarted=true;e.last=0;
      window.duelProfile.startedAt=e.sim.time;
      e.metrics=new FrameMetrics();
      window.duelProfile.records.length=0;window.duelProfile.collect=true;
    });
    await page.waitForTimeout(4500);
    results.push(await page.evaluate(({bots,scale,stress,utilities,rate}) => {
      const p = window.duelProfile,e = p.engine;p.collect=false;e.pause();
      if(e.sim.time-p.startedAt<1)throw new Error('CPU profile did not advance a live fight; reject paused/loading measurements');
      const quantile = (key,q) => {const values=p.records.map(r=>r[key]).sort((a,b)=>a-b);return +(values[Math.min(values.length-1,Math.floor(values.length*q))]??0).toFixed(2);};
      if(utilities&&(!p.records.some(r=>r.smoke>0)||!p.records.some(r=>r.fire>0)))throw new Error('Utility stress did not render smoke and fire');
      return {bots,scale,stress,utilities,rate,frames:p.records.length,simulatedSeconds:e.sim.time-p.startedAt,
        cpuMs:{p50:quantile('cpu',.5),p95:quantile('cpu',.95),p99:quantile('cpu',.99)},frameMs:{p50:quantile('frame',.5),p95:quantile('frame',.95)},
        stages:Object.fromEntries(['simulation','syncActors','render','processEvents','syncEnvironment'].map(key=>[key,{p50:quantile(key,.5),p95:quantile(key,.95)}])),
        drawCalls:{p50:quantile('calls',.5),p95:quantile('calls',.95)},visibleBots:{p50:quantile('visible',.5),max:quantile('visible',1)},
        utilityInstances:{smoke:quantile('smoke',1),fire:quantile('fire',1)},
        buffer:[e.renderer.domElement.width,e.renderer.domElement.height], performance:e.performanceReport()};
    },{bots,scale,stress,utilities,rate}));
  }
  if(cpuProfile){const {profile}=await session.send('Profiler.stop');
    await fs.writeFile(`${output}/cpu-profile.json`,JSON.stringify(profile));}
  await session.send('Emulation.setCPUThrottlingRate',{rate:1});
  const designs = ['Freight yard','Service lanes','Courtyard','Switchback','Loading bays','Workshop'];
  await page.addStyleTag({content:'.duel-entry{display:none}'});
  for (const design of designs) {
    await page.evaluate(design => {
      const e=window.duelProfile.engine;window.profileCoverClone?.removeFromParent();
      e.setConfig({...e.config,botCount:1,arenaScale:1,mapDesign:design});
      e.covers.visible=true;
      e.sim.pause(); e.sim.actors[0].position={x:0,y:1.6256,z:6.5};
      e.sim.actors[0].pitch=-.06;e.sim.actors[0].yaw=0;
      e.viewRoot.visible=false;
    },design);
    await page.waitForTimeout(180);
    await page.locator('canvas[data-duel]').screenshot({path:`${output}/${design.toLowerCase().replaceAll(' ','-')}.png`});
  }
  const graphics=await page.evaluate(() => {
    const gl=window.duelProfile.engine.renderer.getContext(), info=gl.getExtension('WEBGL_debug_renderer_info');
    return {vendor:info?gl.getParameter(info.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),
      renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
  });
  const report={results,errors,seed:431,quality,graphics,browser:await browser.version(),headless:true,
    note:`${rate}x CPU throttling, live fixed Freight yard fight. Stress bypasses cover culling but retains frustum checks; inspect visibleBots for actual rig coverage. Not an old-CPU/iGPU FPS guarantee; other application load is uncontrolled.`};
  await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,results:results.map(({performance,...row})=>({...row,frameDiagnostics:performance.summary}))},null,2));
  if(errors.length) throw new Error('Duel profile produced page errors');
} finally {await browser.close();await server.close();}
