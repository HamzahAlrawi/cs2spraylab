import {expect,test,type Page} from '@playwright/test';
import sharp from 'sharp';

async function engine(page:Page) {
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(entry=>entry.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(entry=>entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine}=await import(/* @vite-ignore */url),tick=DuelEngine.prototype.tick;
    DuelEngine.prototype.tick=function(time:number){(window as any).realMapDuelEngine=this;return tick.call(this,time);};
  });
  await page.waitForFunction(()=>!!(window as any).realMapDuelEngine,{},{timeout:90000});
}

test('real-map Duel uses the shared native HUD artwork in its production radar', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium'); test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 1, realMapChunk: 'dust2-long-doors', radarEnabled: true}));
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'}));
  });
  await page.goto('/'); await engine(page);
  await page.waitForFunction(() => (window as any).realMapDuelEngine.criticalReady);
  const result = await page.evaluate(() => {
    const e = (window as any).realMapDuelEngine, view = e.scenario.radarOverview(e.sim.actors[0].feet);
    return {width: view?.image.width, height: view?.image.height, bounds: view?.bounds, source: view?.source};
  });
  expect(result.width).toBe(1024); expect(result.height).toBe(1024); expect(result.source).toBeUndefined();
  expect(result.bounds.minX).toBeCloseTo(-2476 * .0254);
  await expect(page.locator('.duel-radar')).toBeVisible();
  await page.locator('.duel-radar').screenshot({path: 'research/native-radar-production.png'});
  expect(errors).toEqual([]);
});

for(const fails of [false,true])test(`a winner can keep playing while the next chunk waits, with failure=${fails}`,async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({botCount:1,realMapChunk:'dust2-mid-ct',feedbackSeconds:1}));
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0}));
  });
  await page.goto('/');await engine(page);await page.getByRole('button',{name:'Enter duel',exact:true}).click();
  const before=await page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine,a={calls:0,release:null as any,reject:null as any},stage=e.scenario.stageRound.bind(e.scenario);
    (window as any).winPreparation=a;e.config={...e.config,realMapChunk:'dust2-a-short'};e.scenario.configureDuel(e.config);
    e.scenario.stageRound=async(...args:any[])=>{
      a.calls++;if(a.calls===1)await new Promise((resolve,reject)=>{a.release=resolve;a.reject=reject;});return stage(...args);
    };
    for(const bot of e.sim.actors.slice(1)){bot.alive=false;bot.health=0;}
    e.sim.step();e.processEvents(e.sim.drainEvents());e.report();
    return {id:e.scenario.chunk.id,review:JSON.stringify(e.sim.coach.review()),frames:e.sim.replay.frameCount,
      shots:e.sim.replay.shotCount,completed:e.sim.completedAt,position:{...e.sim.actors[0].position},yaw:e.sim.actors[0].yaw,ammo:e.sim.actors[0].weapon.ammo};
  });
  await page.waitForFunction(()=>(window as any).winPreparation.calls===1);
  await expect(page.locator('.duel-result')).toContainText('Preparing next round');
  await expect(page.locator('.workflow-loading')).toHaveCount(0);
  await page.mouse.move(700,400);await page.mouse.down();await page.waitForTimeout(120);await page.mouse.up();
  for(const key of ['a','d','w','s']){await page.keyboard.down(key);await page.waitForTimeout(100);await page.keyboard.up(key);}
  const during=await page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine,p=e.sim.actors[0];return {id:e.scenario.chunk.id,review:JSON.stringify(e.sim.coach.review()),
      frames:e.sim.replay.frameCount,shots:e.sim.replay.shotCount,completed:e.sim.completedAt,position:p.position,yaw:p.yaw,
      ammo:p.weapon.ammo,time:e.sim.time,captured:document.pointerLockElement===e.renderer.domElement};
  });
  expect(during).toMatchObject({id:before.id,review:before.review,frames:before.frames,shots:before.shots,completed:before.completed,captured:true});
  expect(during.ammo).toBeLessThan(before.ammo);expect(during.time).toBeGreaterThan(before.completed!+.5);
  expect(during.yaw).not.toBe(before.yaw);expect(during.position).not.toEqual(before.position);
  await page.screenshot({path:info.outputPath('playable-next-chunk.png')});
  await page.keyboard.press('r');await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.sim.actors[0].weapon.reload.active)).toBe(true);
  await page.keyboard.press('3');await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.sim.actors[0].weapon.id)).toBe('knife');
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Resume duel',exact:true})).toBeVisible();
  const paused=await page.evaluate(()=>(window as any).realMapDuelEngine.sim.time);await page.waitForTimeout(200);
  expect(await page.evaluate(()=>(window as any).realMapDuelEngine.sim.time)).toBe(paused);
  if(fails) {
    await page.evaluate(()=>(window as any).winPreparation.reject(Error('Test unavailable chunk')));
    await expect(page.getByRole('button',{name:'Retry next round',exact:true})).toBeVisible();
    await page.evaluate(()=>{
      const e=(window as any).realMapDuelEngine,a=(window as any).winPreparation;a.prefetchCalls=0;
      const prefetch=e.scenario.prefetchRound.bind(e.scenario);e.scenario.prefetchRound=(...args:any[])=>{a.prefetchCalls++;return prefetch(...args);};
      e.prefetchAt=-Infinity;
    });
    await page.waitForTimeout(300);expect(await page.evaluate(()=>(window as any).winPreparation.calls)).toBe(1);
    expect(await page.evaluate(()=>(window as any).winPreparation.prefetchCalls)).toBe(0);
    await page.getByRole('button',{name:'Retry next round',exact:true}).click();
  }else {
    await page.getByRole('button',{name:'Resume duel',exact:true}).click();
    await page.evaluate(()=>(window as any).winPreparation.release());
  }
  await expect.poll(()=>page.evaluate(()=>{const e=(window as any).realMapDuelEngine;return {id:e.scenario.chunk.id,loading:e.loadingMap};}),{timeout:90000})
    .toEqual({id:'dust2-a-short',loading:false});
  if(fails)await expect(page.getByRole('button',{name:'Resume duel',exact:true})).toBeVisible();
  else expect(await page.evaluate(()=>!!document.pointerLockElement)).toBe(true);
  expect(errors).toEqual([]);
});

test('mobile winners can tap to shoot while the next chunk is preparing',async({page},info)=>{
  test.skip(info.project.name!=='mobile-chromium');test.setTimeout(120000);
  await page.addInitScript(()=>localStorage.setItem('spraylab.duel.v1',JSON.stringify({botCount:1,realMapChunk:'dust2-mid-ct',feedbackSeconds:1})));
  await page.goto('/');await engine(page);await page.getByRole('button',{name:'Enter duel',exact:true}).click();
  const ammo=await page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine;
    e.scenario.stageRound=()=>new Promise(()=>{});
    for(const bot of e.sim.actors.slice(1)){bot.alive=false;bot.health=0;}
    e.sim.step();e.processEvents(e.sim.drainEvents());e.report();return e.sim.actors[0].weapon.ammo;
  });
  await expect(page.locator('.duel-result')).toContainText('Preparing next round');
  await expect(page.locator('.workflow-loading')).toHaveCount(0);
  const canvas=page.locator('canvas[data-duel]'),box=(await canvas.boundingBox())!;
  await canvas.tap({position:{x:box.width/2,y:box.height/2}});
  await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.sim.actors[0].weapon.ammo)).toBeLessThan(ammo);
});

for(const pauseDuringPreparation of [false,true])test(`prepared rounds stage actors across frames and preserve pause=${pauseDuringPreparation}`,async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'deviceMemory',{value:8,configurable:true});
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({botCount:5,realMapChunk:'dust2-mid-ct',playerHealth:10000}));
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0}));
  });
  await page.goto('/');await engine(page);
  await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeVisible();
  await page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine;
    e.config={...e.config,realMapChunk:'dust2-a-short'};e.scenario.configureDuel(e.config);
    e.scenario.prefetchRound(e.seed);
  });
  await page.waitForFunction(()=>(window as any).realMapDuelEngine.scenario.prepared.ready,null,{timeout:90000});
  await page.evaluate(pauseDuringPreparation=>{
    const e=(window as any).realMapDuelEngine,a={builds:[] as number[],frame:0,warm:false,advances:0,started:null as any};
    (window as any).roundWarmAudit=a;
    const frame=()=>{a.frame++;if(!a.started)requestAnimationFrame(frame);};requestAnimationFrame(frame);
    const build=e.buildActor.bind(e);e.buildActor=(actor:any)=>{
      a.builds.push(a.frame);if(pauseDuringPreparation&&a.builds.length===1)e.pause();return build(actor);
    };
    const advance=e.sim.constructor.prototype.advance,start=e.sim.constructor.prototype.start;
    e.sim.constructor.prototype.advance=function(dt:number){if(e.loadingMap)a.advances++;return advance.call(this,dt);};
    e.sim.constructor.prototype.start=function(){a.started={actors:e.models.size,warm:a.warm,time:this.time,loading:e.loadingMap};return start.call(this);};
    const render=e.renderer.render.bind(e.renderer);
    e.renderer.render=(scene:any,camera:any)=>{
      if(e.loadingMap&&scene===e.scene&&e.models.size===5&&e.renderer.getScissorTest())a.warm=true;
      return render(scene,camera);
    };
    e.restart(true);
  },pauseDuringPreparation);
  await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.loadingMap),{timeout:90000}).toBe(false);
  const result=await page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine,a=(window as any).roundWarmAudit;
    return {builds:a.builds,advances:a.advances,started:a.started,paused:e.paused,simulationPaused:e.sim.paused};
  });
  expect(result.builds).toHaveLength(5);expect(new Set(result.builds).size).toBe(5);
  expect(result.advances).toBe(0);expect(result.started).toEqual({actors:5,warm:true,time:0,loading:false});
  expect(result.paused).toBe(pauseDuringPreparation);expect(result.simulationPaused).toBe(pauseDuringPreparation);
  expect(errors).toEqual([]);
});

test('setup changes during staged same-map restart reach the final lineup without changing chunks',async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await engine(page);
  await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeVisible();
  const original=await page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine,chunk=e.scenario.chunk.id,build=e.buildActor.bind(e);let edited=false;
    e.buildActor=(actor:any)=>{
      if(!edited){edited=true;e.setConfig({...e.config,skill:7,botCount:3});}
      return build(actor);
    };
    e.setConfig({...e.config,skill:4});return chunk;
  });
  await expect.poll(()=>page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine;
    return {loading:e.loadingMap,skill:e.sim.config.skill,bots:e.models.size,chunk:e.scenario.chunk.id};
  }),{timeout:90000}).toEqual({loading:false,skill:7,bots:3,chunk:original});
  expect(errors).toEqual([]);
});

test('real chunks are the first-visit default, with native holds, arrows and opt-in generated arenas',async({page},info)=>{
  test.skip(!['chromium','mobile-chromium'].includes(info.project.name));test.setTimeout(180000);
  const errors:string[]=[],missing:string[]=[],requests:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)missing.push(response.url());});
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.goto('/');await engine(page);
  const canvas=page.locator('canvas[data-duel]');await expect(canvas).toBeVisible();
  const radar=page.locator('canvas.duel-radar');await expect(radar).toBeVisible();
  await expect.poll(()=>radar.evaluate((canvas:HTMLCanvasElement)=>{
    const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data,colors=new Set<number>();
    for(let i=0;i<pixels.length;i+=4)colors.add(pixels[i]*65536+pixels[i+1]*256+pixels[i+2]);
    return colors.size;
  })).toBeGreaterThan(12);
  await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeVisible();
  const data=await page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine,a=e.sim.arena;
    return {native:!!a.native,solids:a.solids.length,scale:e.shell.scale.x,design:a.design,
      feet:e.sim.actors.map((p:any)=>p.feet),arrows:e.scene.getObjectByName('duel-route-arrows')?.visible,
      source:e.config.generatedMaps,modelLabel:e.renderer.domElement.getAttribute('aria-label'),
      overview:!!e.scenario.radarOverview(e.sim.actors[0].feet),fallbackBake:!!e.radar.nativeMaps.get(a.native),
      roundSetup:a.roundSetup};
  });
  expect(data).toMatchObject({native:true,solids:0,scale:1,arrows:true,source:false,modelLabel:'Dust 2 Duel map chunk'});
  expect(data.design).toContain('Dust 2');expect(data.feet.every(Number.isFinite)).toBe(true);
  expect(data).toMatchObject({overview:true,fallbackBake:false});
  expect(data.roundSetup.holds.length).toBeGreaterThan(0);
  expect(requests.filter(path=>/^\/maps\/dust2\/duel\/objects\/[a-f0-9]{64}\.bin$/.test(path)).length).toBeGreaterThan(5);
  expect(requests.filter(path=>/^\/maps\/dust2\/duel\/[^/]+\/(navigation.json|textures.bin)$/.test(path))).toEqual([]);
  expect(requests.filter(path=>path.includes('/maps/dust2/duel/') && path.endsWith('.webp')),
    'packed textures must not create hundreds of individual image requests').toEqual([]);
  expect(requests.some(path=>/^\/maps\/dust2\/(collision|visibility|visual)/.test(path))).toBe(false);
  const pixels=await sharp(await canvas.screenshot()).stats();
  expect(pixels.channels.slice(0,3).every(channel=>channel.stdev>10)).toBe(true);
  await page.screenshot({path:`research/real-map-duel-${info.project.name}.png`,fullPage:true});
  const show=page.getByRole('button',{name:'Show drill panel',exact:true});if(await show.isVisible())await show.click();
  await page.locator('summary').filter({hasText:/^Arena$/}).click();
  await expect(page.getByLabel('Use generated arenas')).not.toBeChecked();
  await expect(page.getByLabel('Duel route arrows')).toBeChecked();
  await page.getByLabel('Duel route arrows').uncheck();
  await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.scene.getObjectByName('duel-route-arrows')?.visible)).toBe(false);
  await page.getByLabel('Use generated arenas').check();
  await expect(page.getByRole('slider',{name:'Arena size',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>!!(window as any).realMapDuelEngine.sim.arena.native)).toBe(false);
  expect(errors).toEqual([]);expect(missing).toEqual([]);
});

test('round transitions retain capture, use another real chunk, and preserve the previous fight for review',async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('spraylab.duel.v1',JSON.stringify({botCount:2,skill:3,feedbackSeconds:1})));
  await page.goto('/');await engine(page);
  await page.getByRole('button',{name:'Enter duel',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!!document.pointerLockElement)).toBe(true);
  const before=await page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine;
    (window as any).realMapCanvas=e.renderer.domElement;
    return {hash:e.sim.arena.native.collisionSha256,design:e.sim.arena.design};
  });
  await page.waitForTimeout(600);
  await page.evaluate(()=>{const e=(window as any).realMapDuelEngine;e.sim.phase='result';e.sim.outcome='won';e.roundFlow.finish();});
  await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.sim.arena.design),{timeout:90000}).not.toBe(before.design);
  await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.sim.phase)).toBe('fighting');
  const after=await page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine;
    const same=e.renderer.domElement===(window as any).realMapCanvas;
    const captured=document.pointerLockElement===e.renderer.domElement;
    const current=e.sim.arena.native.collisionSha256;
    e.pause();const recording=e.previousRecording;e.showReplay(recording,undefined,recording.frames[0].time,false);
    const previous=e.scenario.previous;
    const oldVisible=!!previous && e.scenario.scene.children.includes(previous.scene);
    const currentDetached=!e.scenario.scene.children.includes(e.scenario.map.scene);
    e.closeReplay();return {same,captured,current,oldHash:recording.setup.geometrySha256,oldVisible,currentDetached,
      restored:e.scenario.scene.children.includes(e.scenario.map.scene)};
  });
  expect(after).toMatchObject({same:true,captured:true,oldHash:before.hash,oldVisible:true,currentDetached:true,restored:true});
  expect(after.current).not.toBe(before.hash);expect(errors).toEqual([]);
});

test('setup edits during initial chunk loading reach the first round',async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(120000);
  await page.route('**/maps/dust2/duel/*/chunk.json',async route=>{
    await new Promise(resolve=>setTimeout(resolve,700));await route.continue();
  });
  await page.goto('/');
  const show=page.getByRole('button',{name:'Show drill panel',exact:true});if(await show.isVisible())await show.click();
  await expect(page.getByLabel('Number of bots')).toBeVisible();
  await page.getByLabel('Number of bots').press('End');
  await page.getByLabel('Bot skill level').selectOption('6');
  await engine(page);
  await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine;
    return {bots:e.sim.actors.length-1,skill:e.sim.config.skill};
  })).toEqual({bots:5,skill:6});
});

test('opponent edits keep the map and returning to the previous chunk does not reload assets',async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(180000);
  const errors:string[]=[],requests:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/maps/dust2/duel/'))requests.push(request.url());});
  await page.goto('/');await engine(page);
  const initial=await page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine;
    (window as any).initialActiveMap=e.scenario.map;
    return {id:e.scenario.chunk.id,hash:e.sim.arena.native.collisionSha256};
  });
  const initialObjectUrls=new Set(requests.filter(url=>url.includes('/objects/')));
  const show=page.getByRole('button',{name:'Show drill panel',exact:true});if(await show.isVisible())await show.click();
  const count=requests.length;
  await page.getByLabel('Bot skill level').selectOption('6');
  await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.sim.config.skill)).toBe(6);
  expect(await page.evaluate(()=>(window as any).realMapDuelEngine.scenario.map===(window as any).initialActiveMap)).toBe(true);
  expect(requests.slice(count).filter(url=>url.includes(`/${initial.id}/`)||initialObjectUrls.has(url))).toEqual([]);
  expect(await page.evaluate(()=>(window as any).realMapDuelEngine.sim.arena.native.collisionSha256)).toBe(initial.hash);
  await page.evaluate(()=>{const e=(window as any).realMapDuelEngine;e.restart();});
  await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.scenario.chunk.id),{timeout:90000}).not.toBe(initial.id);
  await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.loadingMap)).toBe(false);
  const common=await page.evaluate(()=>{
    const e=(window as any).realMapDuelEngine;
    const sources=(root:any)=>{const ids=new Set<string>();root.traverse((node:any)=>{
      for(const material of Array.isArray(node.material)?node.material:[node.material])if(material)
        for(const value of Object.values(material))if((value as any)?.isTexture)ids.add((value as any).source.uuid);
    });return ids;};
    const current=sources(e.scenario.map.scene),previous=sources(e.scenario.previous.scene);
    return [...current].filter(id=>previous.has(id)).length;
  });
  expect(common,'active chunks should share decoded texture sources').toBeGreaterThan(5);
  const beforeReuse=requests.length;
  await page.evaluate(id=>{
    const e=(window as any).realMapDuelEngine;(window as any).retainedPreviousMap=e.scenario.previous;
    e.scenario.configureDuel({...e.config,realMapChunk:id});e.restart();
  },initial.id);
  await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.scenario.chunk.id)).toBe(initial.id);
  await expect.poll(()=>page.evaluate(()=>(window as any).realMapDuelEngine.loadingMap)).toBe(false);
  expect(await page.evaluate(()=>(window as any).realMapDuelEngine.scenario.map===(window as any).retainedPreviousMap)).toBe(true);
  // An unrelated next-chunk prefetch may still be draining cancellation. The
  // retained active map must not be downloaded or decoded again.
  expect(requests.slice(beforeReuse).filter(url=>url.includes(`/${initial.id}/`)||initialObjectUrls.has(url))).toEqual([]);
  expect(errors).toEqual([]);
});
