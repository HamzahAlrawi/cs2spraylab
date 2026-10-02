import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import fs from 'node:fs/promises';

const rate = Number(process.env.CPU_RATE ?? 4);
const output = 'research/duel-poi-profile';
const server = await createServer({server:{host:'127.0.0.1',port:0,strictPort:true},logLevel:'error'});
await server.listen();
const browser = await chromium.launch({channel:'chromium'});
try {
  await fs.mkdir(output,{recursive:true});
  const page = await browser.newPage({viewport:{width:1440,height:900}}), errors = [];
  page.on('pageerror',error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0,quality:'performance',frameLimit:60}));
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({botCount:5,skill:5,playerHealth:500,roundSeconds:180}));
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/duel/DuelEngine.ts')).name;
    const {DuelEngine} = await import(url), tick = DuelEngine.prototype.tick;
    window.duelProfile = {engine:null,collect:false,records:[]};
    let last = 0;
    DuelEngine.prototype.tick = function(time) {
      const p = window.duelProfile; p.engine = this;
      this.renderer.info.autoReset = false; this.renderer.info.reset();
      const start = performance.now(); tick.call(this,time);
      if (this.renderer.info.render.calls) {
        if (p.collect) p.records.push({cpu:performance.now()-start,frame:time-last,calls:this.renderer.info.render.calls,
          visible:[...this.models.values()].filter(m=>m.visible).length});
        last = time;
      }
    };
  });
  await page.waitForFunction(() => window.duelProfile?.engine?.motionReady);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate',{rate});
  const results = [];
  for (const [bots,scale,stress] of [[1,.65,false],[5,1,false],[5,1,true]]) {
    await page.evaluate(({bots,scale,stress}) => {
      const p = window.duelProfile,e = p.engine;
      window.profileCoverClone?.removeFromParent();
      e.setConfig({...e.config,botCount:bots,arenaScale:scale});
      e.covers.visible=true;
      if (stress) {
        // Keep scenery rendered while forcing the worst-case visible-bone cost.
        window.profileCoverClone = e.covers.clone(true); e.scene.add(window.profileCoverClone); e.covers.visible = false;
      }
      e.sim.start(); e.sim.resume(); e.paused = false; e.sim.actors[0].health = 10000;
    },{bots,scale,stress});
    await page.waitForTimeout(1500);
    await page.evaluate(() => {window.duelProfile.records.length=0;window.duelProfile.collect=true;});
    await page.waitForTimeout(4500);
    results.push(await page.evaluate(({bots,scale,stress,rate}) => {
      const p = window.duelProfile,e = p.engine;p.collect=false;e.pause();
      const quantile = (key,q) => {const values=p.records.map(r=>r[key]).sort((a,b)=>a-b);return +(values[Math.min(values.length-1,Math.floor(values.length*q))]??0).toFixed(2);};
      return {bots,scale,stress,rate,frames:p.records.length,
        cpuMs:{p50:quantile('cpu',.5),p95:quantile('cpu',.95)},frameMs:{p50:quantile('frame',.5),p95:quantile('frame',.95)},
        drawCalls:{p50:quantile('calls',.5),p95:quantile('calls',.95)},visibleBots:{p50:quantile('visible',.5),max:quantile('visible',1)},
        buffer:[e.renderer.domElement.width,e.renderer.domElement.height]};
    },{bots,scale,stress,rate}));
  }
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
  const report={results,errors,note:'4x CPU throttling on RTX 4080; synthetic stress forces visible bones, not an old-iGPU FPS guarantee.'};
  await fs.writeFile(`${output}/results.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(errors.length) throw new Error('Duel profile produced page errors');
} finally {await browser.close();await server.close();}
