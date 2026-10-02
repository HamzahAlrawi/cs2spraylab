import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';
import {readFileSync} from 'node:fs';
import {canvasColors} from './render-frame';
const desktopProjects=['chromium','brave','opera-gx'];

async function duelEngine(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ url);
    const tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {
      (window as any).arsenalEngine = this; tick.call(this, time);
    };
  });
  await page.waitForFunction(() => (window as any).arsenalEngine?.viewRoot.children.length);
}

async function nonblank(page: Page) {
  const colors = await canvasColors(page,'canvas[data-duel]');
  expect(colors).toBeGreaterThan(8);
}

test('stock knife, locked cosmetics and armory fit small screens without hiding Settings', async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium'].includes(info.project.name));
  await page.goto('/');
  for (const width of [390, 320, 844]) {
    await page.setViewportSize({width, height: width === 844 ? 390 : 844});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', {name: /Open armory/}).click();
    const dialog = page.getByRole('dialog', {name: 'Armory'});
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button',{name:'Unlocks',exact:true}).click();
    await dialog.getByRole('tab',{name:'Knives',exact:true}).click();
    const emerald = dialog.getByRole('button', {name: /Butterfly.*locked until level 75/});
    await expect(emerald).toHaveAttribute('aria-disabled', 'true');
    await emerald.dispatchEvent('click');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.progression.v1') || '{}').equipped?.knife)).not.toBe('knife-butterfly-emerald');
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({path: `test-results/${info.project.name}-armory-${width}.png`});
    await page.getByRole('button', {name: 'Close armory'}).click();
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    await expect(page.getByRole('dialog', {name: 'Settings'})).toBeVisible();
    await page.getByRole('button', {name: 'Done', exact: true}).click();
  }
  await expect(page.getByRole('button', {name: 'Equip Default knife', exact: true})).toBeVisible();
});

test('all native weapon assemblies render and have moving inspect/reload clips', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium'); test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {if (msg.type() === 'error') errors.push(msg.text());});
  await duelEngine(page);
  const ids = await page.evaluate(async () => {
    const module = await import(/* @vite-ignore */ '/src/range/config.ts'); return module.weaponIds as string[];
  });
  for (const id of ids) {
    await page.evaluate(id => {
      const e = (window as any).arsenalEngine;
      e.setSettings({...e.settings, weapon: id});
    }, id);
    await page.waitForFunction(id => {
      const e = (window as any).arsenalEngine;
      let loaded = false;
      e.viewRoot.traverse((node: any) => {if (node.userData.native_view_weapon === id) loaded = true;});
      return e.renderedEquipment === id && loaded && e.viewAnimation?.has('inspect');
    }, id);
    await nonblank(page);
    await expect.poll(()=>page.evaluate(()=>{
      const e=(window as any).arsenalEngine;return e.crosshair.style.visibility;
    })).toBe(['awp','ssg08','g3sg1','scar20'].includes(id)?'hidden':'');
    const movement = await page.evaluate(() => {
      const e = (window as any).arsenalEngine, hand = e.viewRoot.getObjectByName('hand_R');
      e.viewAnimation.cancel(); e.viewRoot.updateMatrixWorld(true);
      const initial = hand.matrixWorld.elements.slice(12, 15);
      e.viewAnimation.playInspect(); e.viewAnimation.update(0, 1, .8); e.viewRoot.updateMatrixWorld(true);
      const travel = Math.hypot(...hand.matrixWorld.elements.slice(12, 15).map((v: number, i: number) => v - initial[i]));
      e.viewAnimation.cancel(); return travel;
    });
    expect(movement, `${id} inspect motion`).toBeGreaterThan(.002);
    if (['elite', 'awp', 'revolver', 'usp'].includes(id)) await page.screenshot({path: `test-results/native-${id}.png`});
  }
  expect(errors).toEqual([]);
});

test('unlocked emerald uses its native model, compiles its shader and persists equip choices', async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium'].includes(info.project.name));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {if (msg.type() === 'error') errors.push(msg.text());});
  await page.addInitScript(() => localStorage.setItem('spraylab.progression.v1', JSON.stringify({version: 1, xp: 15485, equipped: {knife: 'knife-butterfly-emerald'}})));
  await duelEngine(page);
  await page.getByRole('button', {name: /Equip .*knife|Equip Default knife/}).click();
  await page.waitForFunction(() => {
    const e = (window as any).arsenalEngine;
    return e.renderedEquipment === 'knife' && !!e.viewRoot.children[0]?.userData.cosmeticTexture;
  });
  await nonblank(page);
  await expect(page.locator('.duel-ammo small')).toContainText('Butterfly');
  await expect(page.getByRole('button', {name: 'Equip Default knife', exact: true}).locator('img')).toHaveAttribute('src', '/models/knife-butterfly.png');
  const stats = await sharp(await page.locator('canvas[data-duel]').screenshot()).stats();
  expect(stats.channels[1].stdev).toBeGreaterThan(15);
  await page.screenshot({path: `test-results/${info.project.name}-unlocked-emerald.png`});
  await page.getByRole('button', {name: /Open armory/}).click();
  await page.getByRole('tab',{name:'Weapons',exact:true}).click();
  await page.getByLabel('Equipment', {exact: true}).selectOption('ak47');
  await page.getByRole('button', {name: /B the Monster, AK-47, equip/}).click();
  await page.getByRole('button', {name: 'Close armory'}).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.progression.v1')!).equipped.ak47)).toBe('ak47-cu_overpass_monster_ak47');
  expect(errors).toEqual([]);
});

test('completed combat awards XP once and keeps the score reward visible through round review', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  await duelEngine(page);
  const result = await page.evaluate(() => {
    const e = (window as any).arsenalEngine, sim = e.sim;
    sim.arena.solids.length = 0;
    const player = sim.actors[0], bot = sim.actors[1];
    player.position = {x: 0, y: 1.6256, z: 3}; player.yaw = player.pitch = 0;
    bot.position = {x: 0, y: 1.6256, z: 0};
    sim.command(1, {side: 0, forward: 0, fireHeld: false});
    sim.start(); e.beginProgression();
    sim.command(0, {firePressed: true, fireHeld: true});
    for (let tick = 0; tick < 384 && sim.phase === 'fighting'; tick++) sim.step();
    const events = sim.drainEvents(); e.processEvents(events);
    const once = e.progression.getSnapshot().profile.xp;
    e.processEvents(events.filter((event: any) => event.kind === 'round'));
    e.report(); e.paused = true; sim.pause();
    return {phase: sim.phase, outcome: sim.outcome, once, twice: e.progression.getSnapshot().profile.xp};
  });
  expect(result.outcome).toBe('won'); expect(result.once).toBeGreaterThan(16);
  expect(result.twice).toBe(result.once);
  await expect(page.locator('.progression-notification')).toContainText('XP');
  await expect(page.locator('.progression-notification')).toContainText('Achievement earned: First blood, First victory');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.progression.v1')!).xp)).toBe(result.once);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.progression.v1')!).achievements.stats.duelWins)).toBe(1);
  await page.getByRole('button', {name: 'View achievements', exact: true}).click();
  await expect(page.getByRole('button', {name: /^Achievements/})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-achievement="first-blood"]')).toContainText('Earned');
});

test('pistol and sniper bot poses render with their native mounts and no missing bone bindings', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  const warnings: string[] = [];
  page.on('console', msg => {if (msg.text().includes('PropertyBinding')) warnings.push(msg.text());});
  await duelEngine(page);
  await page.waitForFunction(() => (window as any).arsenalEngine.motionReady);
  for (const id of ['usp', 'elite', 'awp']) {
    await page.evaluate(id => {
      const e = (window as any).arsenalEngine;
      e.setConfig({...e.config, weapons: [id], botCount: 1});
      e.covers.visible = false;
      e.sim.actors[0].position = {x: 0, y: 1.6256, z: 4}; e.sim.actors[0].yaw = e.sim.actors[0].pitch = 0;
      e.sim.actors[1].position = {x: 0, y: 1.6256, z: 0}; e.sim.actors[1].yaw = Math.PI;
    }, id);
    await page.waitForFunction(id => (window as any).arsenalEngine.heldWeapons.get(1)?.name === `held_${id}`, id);
    await nonblank(page);
    await page.addStyleTag({content: '.duel-entry {display:none}'});
    await page.locator('canvas[data-duel]').screenshot({path: `test-results/world-${id}.png`});
  }
  expect(warnings).toEqual([]);
});

test('changing bot arsenals bounds the world-model cache without retiring an active weapon', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await duelEngine(page);
  for (const id of ['ak47', 'mp9', 'mp7', 'mp5sd', 'mac10', 'ump45', 'p90', 'bizon', 'm249', 'negev']) {
    await page.evaluate(id => {
      const e = (window as any).arsenalEngine; e.setConfig({...e.config, weapons: [id], botCount: 1});
    }, id);
    await page.waitForFunction(id => (window as any).arsenalEngine.heldWeapons.get(1)?.name === `held_${id}`, id);
    const cache = await page.evaluate(id => {
      const e = (window as any).arsenalEngine; return {size: e.worldWeapons.size, active: e.worldWeapons.has(id)};
    }, id);
    expect(cache.size).toBeLessThanOrEqual(8); expect(cache.active).toBe(true);
    await nonblank(page);
  }
  expect(errors).toEqual([]);
});

test('loadout previews skins, purchases spend once, and sidearm-only hides slot one',async({page},info)=>{
  test.skip(![...desktopProjects,'mobile-chromium'].includes(info.project.name));
  await page.addInitScript(()=>{if(!localStorage.getItem('spraylab.progression.v1'))localStorage.setItem('spraylab.progression.v1',JSON.stringify({version:2,xp:1000,balance:1000,owned:[],equipped:{}}));});
  await page.goto('/');
  await page.locator('.weapon-select').click();
  const loadout=page.getByRole('dialog',{name:'Loadout'});
  await loadout.getByRole('switch',{name:'Carry a primary weapon'}).uncheck();
  await loadout.getByLabel('Sidearm',{exact:true}).selectOption('deagle');
  await expect(loadout.locator('.loadout-finishes > div > button')).toHaveCount(1);
  await expect(loadout.locator('.loadout-finishes img')).toHaveCount(1);
  await loadout.getByRole('button',{name:'Browse Desert Eagle unlocks'}).click();
  const armory=page.getByRole('dialog',{name:'Armory'});
  await expect(armory.getByLabel('Equipment',{exact:true})).toHaveValue('deagle');
  const buy=armory.getByRole('button',{name:/buy for 350 credits/});
  await buy.click();
  await expect(armory.locator('.progression-wallet strong')).toHaveText('650');
  const equip=armory.getByRole('button',{name:/Desert Eagle, equip$/}).filter({hasText:'Equip'});
  await equip.click();
  await page.getByRole('button',{name:'Close armory'}).click();
  await page.locator('.weapon-select').click();
  await expect(loadout.locator('.loadout-finishes > div > button')).toHaveCount(2);
  await page.getByRole('button',{name:'Close panel'}).click();
  await expect(page.getByRole('button',{name:'Equip AK-47',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Equip Desert Eagle',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:'Equip AK-47',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Equip Desert Eagle',exact:true}).locator('img')).toHaveAttribute('src',/cosmetics/);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('spraylab.progression.v1')!).balance)).toBe(650);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/${info.project.name}-sidearm-purchased.png`});
});

test('native gloves and bot agents animate without missing bones or shader errors',async({page},info)=>{
  test.skip(!desktopProjects.includes(info.project.name));test.setTimeout(180000);
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'||m.text().includes('PropertyBinding')) errors.push(m.text());});
  await page.addInitScript(()=>localStorage.setItem('spraylab.progression.v1',JSON.stringify({version:2,xp:357885,balance:500000,owned:[],equipped:{}})));
  await duelEngine(page);
  const ids=await page.evaluate(()=>{
    const e=(window as any).arsenalEngine;
    return e.progression.catalog.filter((item:any)=>['agent','gloves'].includes(item.category)&&!item.isDefault).map((item:any)=>({id:item.id,equipment:item.equipment}));
  });
  await page.addStyleTag({content:'.duel-entry{display:none}'});
  for(const item of ids) {
    await page.evaluate(item=>{
      const e=(window as any).arsenalEngine;
      e.progression.purchase(item.id);e.progression.equip(item.equipment,item.id);
    },item);
    await page.waitForFunction(item=>{
      const e=(window as any).arsenalEngine;
      if(item.equipment==='agent') {
        let chosen=false;e.targetScene?.traverse((n:any)=>{if(n.userData.actor_cosmetic===item.id)chosen=true;});
        return e.agentInstance?.scene===e.targetScene&&chosen;
      }
      let worn=false;e.viewRoot.traverse((n:any)=>{if(n.userData.actor_cosmetic===item.id) worn=true;});return worn;
    },item);
    await page.evaluate(()=>{
      const e=(window as any).arsenalEngine;
      e.covers.visible=false;e.sim.actors[0].position={x:0,y:1.6256,z:4};e.sim.actors[0].yaw=e.sim.actors[0].pitch=0;
      e.sim.actors[1].position={x:0,y:1.6256,z:0};e.sim.actors[1].yaw=Math.PI;
    });
    await nonblank(page);
    await page.screenshot({path:`test-results/${item.id}.png`});
  }
  await page.evaluate(()=>{
    const e=(window as any).arsenalEngine;e.progression.equip('gloves','gloves-standard');e.progression.equip('agent','agent-standard');
  });
  await page.waitForFunction(()=>{
    const e=(window as any).arsenalEngine;let worn=false;
    e.viewRoot.traverse((n:any)=>{if(n.userData.actor_cosmetic) worn=true;});return !worn&&!e.agentInstance;
  });
  expect(errors).toEqual([]);
});

test('Deagle hands and Dualies remain visible at mobile, square and wide aspect ratios',async({page},info)=>{
  test.skip(!desktopProjects.includes(info.project.name));test.setTimeout(120000);
  await duelEngine(page);await page.addStyleTag({content:'.duel-entry{display:none}'});
  for(const id of ['deagle','elite','awp','revolver']) for(const width of [390,1000,1920]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(id=>{const e=(window as any).arsenalEngine;e.setSettings({...e.settings,weapon:id});},id);
    await page.waitForFunction(id=>{
      const e=(window as any).arsenalEngine;let loaded=false;
      e.viewRoot.traverse((n:any)=>{if(n.userData.native_view_weapon===id)loaded=true;});return loaded;
    },id);
    const hands=await page.evaluate(()=>{
      const e=(window as any).arsenalEngine,found:any[]=[];
      e.viewRoot.traverse((n:any)=>{if(n.isSkinnedMesh&&/firstperson_default_gloves/.test(n.name))found.push({visible:n.visible,culled:n.frustumCulled});});return found;
    });
    expect(hands.length).toBeGreaterThan(0);expect(hands.every((h:any)=>h.visible&&!h.culled)).toBe(true);
    await nonblank(page);await page.screenshot({path:`test-results/view-${id}-${width}.png`});
  }
});

test('legacy UV assemblies and native procedural finish styles render with their animations intact',async({page},info)=>{
  test.skip(!desktopProjects.includes(info.project.name));test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'||m.text().includes('PropertyBinding'))errors.push(m.text());});
  const owned=JSON.parse(readFileSync('src/range/cosmetics-data.json','utf8')).cosmetics.map((item:any)=>item.id);
  await page.addInitScript(owned=>localStorage.setItem('spraylab.progression.v1',JSON.stringify({version:2,xp:357885,balance:0,owned,equipped:{}})),owned);
  await duelEngine(page);
  const items=await page.evaluate(async()=>{
    const data=await fetch('/src/range/cosmetics-data.json').then(r=>r.json()),seen=new Set<string>();
    return data.cosmetics.filter((item:any)=>{
      const key=item.assetKey.endsWith('-legacy')?item.assetKey:`style-${item.style}`;
      if(seen.has(key))return false;seen.add(key);return true;
    }).map((item:any)=>({id:item.id,equipment:item.equipment,asset:item.assetKey}));
  });
  for(const item of items) {
    await page.evaluate(item=>{
      const e=(window as any).arsenalEngine;
      e.progression.equip(item.equipment,item.id);
      if(item.equipment==='knife')e.equip(3);else e.setSettings({...e.settings,primaryEnabled:true,weapon:item.equipment});
    },item);
    await page.waitForFunction(item=>{
      const e=(window as any).arsenalEngine;let loaded=false;e.viewRoot.traverse((n:any)=>{if(n.userData.cosmeticFinish===item.id)loaded=true;});return loaded;
    },item,{timeout:15000});
    await nonblank(page);
    expect(await page.evaluate(()=>!!(window as any).arsenalEngine.viewAnimation.has('inspect'))).toBe(true);
  }
  expect(errors).toEqual([]);
});
