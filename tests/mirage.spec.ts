import {expect,test,type Page} from '@playwright/test';
import {canvasColors} from './render-frame';

async function capture(page:Page){
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(e=>e.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine}=await import(/* @vite-ignore */url),tick=DuelEngine.prototype.tick;
    DuelEngine.prototype.tick=function(time:number){(window as any).mirageEngine=this;return tick.call(this,time);};
  });
  await page.waitForFunction(()=>!!(window as any).mirageEngine);
}
async function panel(page:Page){const show=page.getByRole('button',{name:'Show drill panel',exact:true});if(await show.isVisible())await show.click();}

test('Mirage beta plays six Prefire routes, uses native Duel chunks and retains Dust 2',async({page},info)=>{
  test.skip(!['chromium','mobile-chromium'].includes(info.project.name));test.setTimeout(240000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const failed:string[]=[];page.on('response',r=>{if(r.status()>=400&&r.url().includes('/maps/mirage/'))failed.push(`${r.status()} ${r.url()}`);});
  await page.addInitScript(()=>{
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'prefire',volume:0,quality:'performance',frameLimit:60,protectShortcuts:false}));
    localStorage.setItem('spraylab.prefire.v1',JSON.stringify({mapId:'de_mirage',routeId:'a-ramp',population:'all',returnFire:false,routeGuide:true}));
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({mapId:'de_mirage',realMapChunk:'mirage-a',botCount:3,skill:1,generatedMaps:false}));
  });
  await page.goto('/');await capture(page);await panel(page);
  await expect(page.getByRole('button',{name:'Enter prefire',exact:true})).toBeEnabled({timeout:120000});
  await expect(page.getByLabel('Prefire map',{exact:true})).toHaveValue('de_mirage');
  await expect(page.locator('.map-beta-notice')).toContainText('Mirage (Beta)');
  expect(await canvasColors(page,'canvas[data-duel]')).toBeGreaterThan(8);
  const routes=await page.getByLabel('Prefire route').locator('option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value));
  expect(routes).toHaveLength(6);
  for(const route of routes){
    await page.getByLabel('Prefire route').selectOption(route);
    await expect.poll(()=>page.evaluate(()=>(window as any).mirageEngine.sim.route.id)).toBe(route);
    const state=await page.evaluate(()=>{const s=(window as any).mirageEngine.sim,p=s.actors[0];return {
      map:s.config.mapId,bots:s.actors.length-1,fits:s.arena.native.fits(p.position,p.feet,72*.0254),
      source:s.route.angles.every((a:any)=>a.id.startsWith('de_mirage:')),native:s.arena.native.collisionSha256};});
    expect(state).toMatchObject({map:'de_mirage',bots:5,fits:true,source:true,native:'6253487f363acf4b1b5bd2e8af0468a8fc29814ec36e564a8643f4645da88352'});
  }
  await page.getByLabel('Prefire route').selectOption('a-ramp');
  await page.screenshot({path:info.outputPath('mirage-ramp.png'),fullPage:true});
  if(info.project.name==='chromium'){
    await page.getByRole('button',{name:'Enter prefire',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>!!document.pointerLockElement)).toBe(true);
    await page.keyboard.down('w');await page.waitForTimeout(800);await page.keyboard.up('w');
    await page.mouse.down();await page.waitForTimeout(150);await page.mouse.up();
    await expect.poll(()=>page.evaluate(()=>(window as any).mirageEngine.sim.coach.review().shots)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');await panel(page);
  }
  await page.getByLabel('Training mode').selectOption('duel');await panel(page);
  await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeEnabled({timeout:120000});
  await expect(page.getByLabel('Play Mirage (Beta)',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Play Dust 2',{exact:true})).not.toBeChecked();
  const duel=await page.evaluate(()=>{const e=(window as any).mirageEngine;return {map:e.sim.config.mapId,bots:e.sim.actors.length-1,
    native:!!e.sim.arena.native,geometry:e.map?.collision?.collisionSha256??e.sim.arena.native.collisionSha256};});
  expect(duel).toMatchObject({map:'de_mirage',bots:3,native:true});
  expect(await canvasColors(page,'canvas[data-duel]')).toBeGreaterThan(8);
  await page.screenshot({path:info.outputPath('mirage-duel.png'),fullPage:true});
  await page.locator('.duel-setup-section').filter({has:page.getByLabel('Real map chunk',{exact:true})}).locator('summary').click();
  for(const chunk of ['mirage-palace','mirage-apartments','mirage-underpass']){
    await page.getByLabel('Real map chunk',{exact:true}).selectOption(chunk);
    await expect.poll(()=>page.evaluate(()=>(window as any).mirageEngine.scenario.chunk.id),{timeout:120000}).toBe(chunk);
    await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeEnabled({timeout:120000});
    const state=await page.evaluate(()=>{const e=(window as any).mirageEngine;return {map:e.sim.config.mapId,
      grenade:!!e.sim.arena.native.grenadeQuery,bots:e.sim.actors.length-1,route:e.sim.arena.roundSetup.course};});
    expect(state.map).toBe('de_mirage');expect(state.grenade).toBe(true);expect(state.bots).toBe(3);
    expect(state.route).toBe({'mirage-palace':'a-palace','mirage-apartments':'b-apartments','mirage-underpass':'underpass-connector'}[chunk]);
    expect(await canvasColors(page,'canvas[data-duel]')).toBeGreaterThan(8);
    await page.screenshot({path:info.outputPath(`${chunk}.png`),fullPage:true});
  }
  await page.getByLabel('Play Dust 2',{exact:true}).check();
  await expect(page.getByLabel('Real map chunk',{exact:true})).toBeDisabled();
  await page.getByLabel('Play Mirage (Beta)',{exact:true}).uncheck();
  await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeEnabled({timeout:120000});
  await expect.poll(()=>page.evaluate(()=>(window as any).mirageEngine.sim.config.mapId)).toBe('de_dust2');
  expect(failed).toEqual([]);expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('new Duel users get every available map checked and maps rotate without replacing the session',async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(240000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0,quality:'performance',frameLimit:60,protectShortcuts:false})));
  await page.goto('/');await capture(page);await panel(page);
  await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeEnabled({timeout:120000});
  await expect(page.getByLabel('Play Dust 2',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Play Mirage (Beta)',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Real map chunk',{exact:true})).toBeDisabled();
  const first=await page.evaluate(async()=>{
    const e=(window as any).mirageEngine;(window as any).firstDuelSession=e.scenario;
    const url='/src/range/duel/real-map.ts',api=await import(/* @vite-ignore */url),current=e.scenario.chunk;
    let seed=1;while(api.chooseDuelMapChunk(e.config,seed,current).mapId===current.mapId)seed++;
    const next=api.chooseDuelMapChunk(e.config,seed,current);e.seed=seed;e.restart(false,true);
    return {map:current.mapId,next:next.mapId,chunk:next.id};
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).mirageEngine.sim.config.mapId),{timeout:120000}).toBe(first.next);
  await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeEnabled({timeout:120000});
  expect(await page.evaluate(()=>(window as any).mirageEngine.scenario===(window as any).firstDuelSession)).toBe(true);
  expect(await page.evaluate(()=>(window as any).mirageEngine.scenario.chunk.id)).toBe(first.chunk);
  expect(await canvasColors(page,'canvas[data-duel]')).toBeGreaterThan(8);
  expect(errors).toEqual([]);
});

test('Mirage sound awareness loads the whole map with native radar and supported continuous sources',async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'awareness',volume:.2,quality:'performance',frameLimit:60,protectShortcuts:false}));
    localStorage.setItem('spraylab.awareness.v1',JSON.stringify({mapId:'de_mirage',stage:'reveal',cues:'shots',autoNext:false}));
  });
  await page.goto('/');await capture(page);
  await expect(page.getByRole('button',{name:'Start sound practice',exact:true})).toBeEnabled({timeout:120000});
  await expect(page.getByLabel('Awareness map',{exact:true})).toHaveValue('de_mirage');
  const world=await page.evaluate(()=>{const e=(window as any).mirageEngine;return {map:e.sim.config.mapId,sha:e.sim.arena.native.collisionSha256};});
  expect(world).toEqual({map:'de_mirage',sha:'6253487f363acf4b1b5bd2e8af0468a8fc29814ec36e564a8643f4645da88352'});
  expect(await canvasColors(page,'canvas[data-duel]')).toBeGreaterThan(8);
  await page.screenshot({path:info.outputPath('mirage-awareness.png'),fullPage:true});
  expect(errors).toEqual([]);
});

test('Mirage chunk revisits use persistent local bytes without map HTTP requests',async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(180000);
  await page.addInitScript(()=>{
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0,quality:'performance',protectShortcuts:false}));
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({mapId:'de_mirage',realMapChunk:'mirage-mid',botCount:1,skill:1,generatedMaps:false}));
  });
  await page.goto('/');await capture(page);
  await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeEnabled({timeout:120000});
  const identity=await page.evaluate(()=>(window as any).mirageEngine.sim.arena.native.collisionSha256);
  await page.evaluate(async()=>{
    const url='/src/range/prefire/asset-delivery.ts',queries='/src/range/prefire/query-cache.ts';
    await (await import(/* @vite-ignore */url)).settleAssetCache();
    await (await import(/* @vite-ignore */queries)).settleQueryCache();
  });
  const requests:string[]=[];
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/maps/mirage/'))requests.push(r.url());});
  await page.reload();await capture(page);
  await expect(page.getByRole('button',{name:'Enter duel',exact:true})).toBeEnabled({timeout:120000});
  expect(await page.evaluate(()=>(window as any).mirageEngine.sim.arena.native.collisionSha256)).toBe(identity);
  expect(requests).toEqual([]);
});
