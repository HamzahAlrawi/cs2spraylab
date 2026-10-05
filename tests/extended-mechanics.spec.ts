import {expect,test} from '@playwright/test';
import {canvasColors} from './render-frame';

test('native new weapons fire, reload and recharge inside the app on desktop and mobile',async({page},info)=>{
  test.setTimeout(90000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('spraylab.range.v2',JSON.stringify({volume:0,protectShortcuts:false,quality:'performance'})));
  await page.goto('/');
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(entry=>entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine}=await import(/* @vite-ignore */url),original=DuelEngine.prototype.tick;
    DuelEngine.prototype.tick=function(time:number){(window as any).mechanicsEngine=this;return original.call(this,time);};
  });
  await page.waitForFunction(()=>(window as any).mechanicsEngine?.motionReady);
  const radar=await page.locator('.duel-radar').boundingBox();
  expect(radar?.width).toBeLessThanOrEqual(144);expect(radar?.height).toBeLessThanOrEqual(144);
  for(const id of ['nova','xm1014','mag7','sawedoff','zeus']) {
    await page.evaluate(id=>{const e=(window as any).mechanicsEngine;e.setSettings({...e.settings,weapon:id});},id);
    await page.waitForFunction(id=>{const e=(window as any).mechanicsEngine;return e.renderedEquipment===id&&e.viewAnimation;},id);
    expect(await canvasColors(page,'canvas[data-duel]')).toBeGreaterThan(8);
    const before=await page.evaluate(()=>{const e=(window as any).mechanicsEngine;for(const actor of e.sim.actors.slice(1))e.sim.command(actor.id,{});
      e.sim.start();e.paused=false;e.sim.actors[0].health=10000;const ammo=e.sim.actors[0].weapon.ammo;e.sim.command(0,{firePressed:true});return ammo;});
    await expect.poll(()=>page.evaluate(()=>{const e=(window as any).mechanicsEngine;return {
      equipment:e.sim.actors[0].weapon.id,ammo:e.sim.actors[0].weapon.ammo,phase:e.sim.phase,paused:e.paused||e.sim.paused};
    }),{message:`${id} must discharge in the active simulation`}).toEqual({equipment:id,ammo:before-1,phase:'fighting',paused:false});
    if(id!=='zeus') {
      await page.evaluate(()=>(window as any).mechanicsEngine.sim.command(0,{reloadPressed:true,reloadHeld:false}));
      await expect.poll(()=>page.evaluate(()=>(window as any).mechanicsEngine.sim.actors[0].weapon.reload.active)).toBe(true);
      await expect.poll(()=>page.evaluate(()=>(window as any).mechanicsEngine.sim.actors[0].weapon.ammo),{timeout:10000}).toBe(before);
    } else {
      expect(await page.evaluate(()=>{const e=(window as any).mechanicsEngine;return e.sim.actors[0].weapon.rechargeUntil-e.sim.time;})).toBeGreaterThan(28);
    }
    await page.screenshot({path:`test-results/${info.project.name}-combat-${id}.png`});
  }
  expect(errors).toEqual([]);
});

test('lazy world gestures preserve physical standing head height for rifles, pistols and knife',async({page},info)=>{
  test.skip(info.project.name!=='chromium');
  await page.goto('/');
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(entry=>entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine}=await import(/* @vite-ignore */url),original=DuelEngine.prototype.tick;
    DuelEngine.prototype.tick=function(time:number){(window as any).headEngine=this;return original.call(this,time);};
  });
  await page.waitForFunction(()=>(window as any).headEngine?.motionReady);
  for(const id of ['ak47','usp','nova','knife']) {
    await page.evaluate(id=>{const e=(window as any).headEngine;e.setConfig({...e.config,weapons:[id]});},id);
    await page.waitForFunction(id=>{const e=(window as any).headEngine;return e.gestureClips.has(id)&&e.worldWeapons.has(id);},id);
    const height=await page.evaluate(()=>{const e=(window as any).headEngine;e.covers.visible=false;
      e.syncActors(e.sim.snapshot(),0);const model=e.models.get(1);model.updateMatrixWorld(true);
      return model.getObjectByName('head_0').matrixWorld.elements[13]-e.sim.actors[1].feet;});
    expect(height,`${id}: ${height}`).toBeGreaterThan(1.45);expect(height,`${id}: ${height}`).toBeLessThan(1.85);
  }
});

test('armor and radar persist while legacy latency preferences and controls are removed',async({page},info)=>{
  test.skip(info.project.name!=='chromium','Detailed configuration integration runs once');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    if(!localStorage.getItem('spraylab.duel.v1'))localStorage.setItem('spraylab.duel.v1',JSON.stringify({
      playerPing:300,botPing:300,interpolationMs:62.5,overrides:[{ping:300}],
    }));
  });
  await page.goto('/');
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(entry=>entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine}=await import(/* @vite-ignore */url),original=DuelEngine.prototype.tick;
    DuelEngine.prototype.tick=function(time:number){(window as any).configEngine=this;return original.call(this,time);};
  });
  await page.waitForFunction(()=>(window as any).configEngine?.motionReady);
  await page.getByLabel('Player armor points',{exact:true}).fill('35');
  await page.getByLabel('Player helmet',{exact:true}).uncheck();
  await page.getByLabel('Bot armor points',{exact:true}).fill('50');
  await page.getByLabel('Bot helmet',{exact:true}).uncheck();
  await expect(page.getByLabel('Player ping',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Bot ping',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Snapshot buffer',{exact:true})).toHaveCount(0);
  await page.locator('.duel-bot-details > summary').filter({hasText:/^Radar$/}).click();
  await page.getByLabel('Show radar',{exact:true}).uncheck();
  await expect(page.locator('.duel-radar')).toBeHidden();
  await page.locator('.duel-roster summary').first().click();
  await page.getByLabel('Customize bot 1',{exact:true}).check();
  await expect(page.getByLabel('Bot 1 ping',{exact:true})).toHaveCount(0);
  await page.getByLabel('Bot 1 armor points',{exact:true}).fill('27');
  await page.getByLabel('Bot 1 weapon',{exact:true}).selectOption('mag7');
  await expect.poll(()=>page.evaluate(()=>{
    const e=(window as any).configEngine;
    return {armor:e.sim.actors.map((actor:any)=>actor.armor),helmets:e.sim.actors.map((actor:any)=>actor.helmet),
      weapon:e.sim.actors[1].weapon.id};
  })).toEqual({armor:[35,27],helmets:[false,false],weapon:'mag7'});
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('spraylab.duel.v1')!));
  for(const key of ['playerPing','botPing','interpolationMs'])expect(saved).not.toHaveProperty(key);
  expect(saved.overrides[0]).not.toHaveProperty('ping');
  expect(await page.evaluate(()=>(window as any).configEngine.xpSetup().bots[0])).toMatchObject({armor:true,helmet:false,armorPoints:27});
  await page.reload();
  await expect(page.getByLabel('Player armor points',{exact:true})).toHaveValue('35');
  await expect(page.getByLabel('Player helmet',{exact:true})).not.toBeChecked();
  await page.locator('.duel-bot-details > summary').filter({hasText:/^Radar$/}).click();
  await expect(page.getByLabel('Show radar',{exact:true})).not.toBeChecked();
  await page.getByLabel('Show radar',{exact:true}).check();
  await expect(page.locator('.duel-radar')).toBeVisible();
  const radar=await page.locator('.duel-radar').boundingBox();
  expect(radar!.width).toBeLessThanOrEqual(144);expect(radar!.height).toBeLessThanOrEqual(144);
  expect(errors).toEqual([]);
});
