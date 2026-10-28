import {expect, test, type Page} from '@playwright/test';

async function hookEngine(page: Page, kind: 'range' | 'duel') {
  await page.evaluate(async kind => {
    const name = kind === 'range' ? '/range/engine.ts' : '/duel/DuelEngine.ts';
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes(name))!.name;
    const module = await import(/* @vite-ignore */ url);
    const Class = kind === 'range' ? module.RangeEngine : module.DuelEngine;
    const tick = Class.prototype.tick;
    Class.prototype.tick = function(t: number) {(window as any).inputQA = this; return tick.call(this,t);};
  }, kind);
  await page.waitForFunction(() => !!(window as any).inputQA);
}

test('keyboard binding capture, conflicts, persistence and reset work without moving the player', async ({page}, info) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror',e => errors.push(e.message));
  await page.addInitScript(() => {if (!localStorage.getItem('spraylab.range.v2'))
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode:'guided',quality:'performance',volume:0}));});
  await page.goto('/'); await expect(page.locator('canvas[data-range]')).toBeVisible();
  await hookEngine(page,'range');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByLabel('Sensitivity',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Mouse settings')).toContainText('51.95 cm');
  await page.getByRole('tab',{name:'Controls',exact:true}).click();
  const original = await page.evaluate(() => ({...(window as any).inputQA.sim.position}));
  await page.getByRole('button',{name:'Bind move forward',exact:true}).click();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button',{name:'Bind move forward',exact:true})).toContainText('Arrow Up');
  await page.getByRole('button',{name:'Bind reload',exact:true}).click(); await page.keyboard.press('ArrowUp');
  await expect(page.locator('.controls-message')).toContainText('Already assigned');
  await page.keyboard.press('KeyT');
  await expect(page.getByRole('button',{name:'Bind reload',exact:true})).toContainText('T');
  expect(await page.evaluate(() => ({...(window as any).inputQA.sim.position}))).toEqual(original);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!).controls.forward)).toBe('ArrowUp');
  await page.screenshot({path:`test-results/controls-${info.project.name}.png`});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Controls',exact:true}).click();
  await expect(page.getByRole('button',{name:'Bind move forward',exact:true})).toContainText('Arrow Up');
  await page.getByRole('button',{name:'Reset all controls',exact:true}).click();
  await expect(page.getByRole('button',{name:'Bind move forward',exact:true})).toContainText('W');
  expect(errors).toEqual([]);
});

test('Prefire route directions and lower feedback render without covering the aiming area', async ({page},info) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror',e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',quality:'performance',volume:0}));
    localStorage.setItem('spraylab.prefire.v1',JSON.stringify({routeGuide:true,navigationHints:true}));
  });
  await page.goto('/'); await expect(page.locator('canvas[data-duel]')).toBeVisible(); await hookEngine(page,'duel');
  await page.getByLabel('Training mode').selectOption('prefire');
  const showPanel = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await showPanel.isVisible()) await showPanel.click();
  await expect(page.getByLabel('Prefire route')).toBeVisible({timeout:90000});
  await page.waitForFunction(() => !!(window as any).inputQA?.scenario);
  await page.getByRole('button',{name:'Enter prefire',exact:true}).click();
  await expect(page.locator('.prefire-navigation')).toBeVisible();
  await expect(page.locator('.prefire-navigation')).toContainText('Waypoint');
  await page.evaluate(() => {
    const e = (window as any).inputQA; e.sim.pause();
    e.caption='HEADSHOT';e.captionUntil=e.animationClock+20;
    const report = e.scenario.report.bind(e.scenario);
    e.scenario.report = (sim:any) => ({...report(sim),feedback:{angle:'Long',message:'Settle before firing',tip:'Release or counter-strafe, then fire.'}});
    e.report();
  });
  await expect(page.locator('.duel-caption')).toBeVisible();
  await expect(page.locator('.prefire-live-feedback')).toBeVisible();
  const geometry = await page.evaluate(() => {
    const view = document.querySelector('.duel-view')!.getBoundingClientRect();
    const caption = document.querySelector('.duel-caption')!.getBoundingClientRect();
    const guide = document.querySelector('.prefire-navigation')!.getBoundingClientRect();
    const feedback = document.querySelector('.prefire-live-feedback')!.getBoundingClientRect();
    const overlap = (a:DOMRect,b:DOMRect) => a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    return {view:{top:view.top,bottom:view.bottom,height:view.height,width:view.width},caption:{top:caption.top,bottom:caption.bottom},guide:{right:guide.right,left:guide.left},
      feedbackOverlaps: [caption,...document.querySelectorAll('.duel-health strong,.duel-ammo strong')].some(node => overlap(feedback,node instanceof DOMRect ? node : node.getBoundingClientRect())),
      arrows:(window as any).inputQA.scenario.guide.children.some((child:any)=>child.isInstancedMesh&&child.count>0)};
  });
  expect(geometry.caption.top).toBeGreaterThan(geometry.view.top+geometry.view.height*.6);
  expect(geometry.caption.bottom).toBeLessThan(geometry.view.bottom);
  expect(geometry.arrows).toBe(true);
  expect(geometry.feedbackOverlaps).toBe(false);
  if (info.project.name.startsWith('mobile')) {
    await page.evaluate(() => {const e=(window as any).inputQA; e.sim.actors[0].weapon.ammo--; e.report();});
    await page.getByRole('button',{name:'Reload',exact:true}).click();
    expect(await page.evaluate(() => (window as any).inputQA.paused)).toBe(false);
  }
  await page.screenshot({path:`test-results/prefire-navigation-${info.project.name}.png`});
  await page.evaluate(() => (window as any).inputQA.pause());
  await page.locator('summary').filter({hasText: /^Guidance & run options/}).click();
  await page.getByLabel('Route directions',{exact:true}).uncheck();
  await expect(page.locator('.prefire-navigation')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.prefire.v1')!).navigationHints)).toBe(false);
  expect(errors).toEqual([]);
});

test('native weapon inspection starts during deployment in Range and Duel',async ({page},info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Native model/input lifecycle desktop regression');
  test.setTimeout(120000);
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'guided',quality:'performance',volume:0})));
  await page.goto('/'); await expect(page.locator('canvas[data-range]')).toBeVisible(); await hookEngine(page,'range');
  await page.waitForFunction(() => (window as any).inputQA.modelCache.has('ak47'));
  const range = await page.evaluate(async () => {
    const e=(window as any).inputQA; e.sim.active=true;
    const pending=e.equip(2); e.inspect(); await pending;
    return {action:e.viewAnimations.get(e.sim.equipped).activeAction,equipped:e.sim.equipped,
      remaining:e.sim.equipReadyAt-e.sim.time,fired:e.sim.start()};
  });
  expect(range.equipped).toBe('usp'); expect(range.action).toBe('inspect');
  expect(range.remaining).toBeGreaterThan(0); expect(range.fired).toBe(false);
  await page.evaluate(() => (window as any).inputQA.pause());
  await page.getByLabel('Training mode').selectOption('duel');
  await expect(page.locator('canvas[data-duel]')).toBeVisible(); await hookEngine(page,'duel');
  await page.waitForFunction(() => (window as any).inputQA.loadedViewEquipment==='ak47');
  const duel=await page.evaluate(async () => {
    const e=(window as any).inputQA; e.sim.start(); e.equip(2); e.inspect(); e.sim.step();
    const pending=e.loadViewModel('usp'); await pending;
    return {action:e.viewAnimation.activeAction,remaining:e.sim.actors[0].equipReadyAt-e.sim.time,
      weapon:e.loadedViewEquipment};
  });
  expect(duel.weapon).toBe('usp'); expect(duel.action).toBe('inspect'); expect(duel.remaining).toBeGreaterThan(0);
});
