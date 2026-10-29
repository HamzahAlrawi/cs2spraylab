import {expect, test} from '@playwright/test';
import {canvasColors} from './render-frame';
import type {Page} from '@playwright/test';

async function captureEngine(page: Page) {
  await page.locator('canvas[data-duel]').waitFor({state: 'attached', timeout: 90000});
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/range/duel/DuelEngine.ts'))?.name;
    if (!path) throw new Error('Duel module was not loaded');
    const {DuelEngine} = await import(/* @vite-ignore */ path), original = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function (time: number) {(window as any).compactArenaEngine = this; return original.call(this, time);};
  });
  await page.waitForFunction(() => (window as any).compactArenaEngine?.criticalReady, undefined, {timeout: 90000});
}

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, showTips: false}));
    if (!localStorage.getItem('spraylab.duel.v1')) localStorage.setItem('spraylab.duel.v1', JSON.stringify({generatedMaps: true, botCount: 1,
      skill: 1, botUtilities: false, playerHealth: 500, health: 500, shortcutProtection: false}));
    localStorage.setItem('spraylab.duel.hint.v1', 'seen');
    localStorage.setItem('spraylab.settingsHint.v1', 'seen');
  });
});

test('real browser mouse chords produce overhand, underhand and combined throws without pointer motion', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium'); test.setTimeout(120000);
  await page.goto('/'); await captureEngine(page);
  const canvas = page.locator('canvas[data-duel]');
  const bounds = (await canvas.boundingBox())!;
  for (const [buttons, strength] of [[['left'], 1], [['right'], 0], [['left', 'right'], .5], [['right', 'left'], .5]] as const) {
    await page.evaluate(() => (window as any).compactArenaEngine.restart(false, false));
    await page.waitForFunction(() => !(window as any).compactArenaEngine.loadingMap);
    await page.evaluate(() => {
      const engine = (window as any).compactArenaEngine;
      engine.sim.configureUtilities({utilitiesEnabled: true, botUtilities: false, utilityLoadout: ['he']});
      engine.sim.selectUtility('he');
      engine.sim.command(1, {}); engine.sim.start(); engine.sim.resume(); engine.sessionStarted = true;
      engine.paused = false; engine.inputName = 'Drag aim (browser test)';
      engine.report();
    });
    await page.waitForFunction(() => {const sim = (window as any).compactArenaEngine.sim; return sim.utilityPresentation()?.readyAt <= sim.time;});
    await expect(page.getByRole('button', {name: 'Enter duel', exact: true})).not.toBeVisible();
    await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .7);
    for (const button of buttons) await page.mouse.down({button});
    try {await page.waitForFunction(() => {const sim = (window as any).compactArenaEngine.sim, held = sim.utilityPresentation();
      return held?.primedAt !== undefined && sim.time - held.primedAt > 1;}, undefined, {timeout: 8000});}
    catch (error) {
      const state = await page.evaluate(() => {const e = (window as any).compactArenaEngine;
        return {phase:e.sim.phase, paused:e.paused, entering:e.entering, command:e.sim.actors[0].command,
          held:e.sim.utilityPresentation(), time:e.sim.time, loading:e.loadingMap};});
      throw new Error(`${buttons.join('+')}: ${JSON.stringify(state)}; ${error}`);
    }
    expect(await page.evaluate(() => (window as any).compactArenaEngine.sim.utilityPresentation().strength)).toBeCloseTo(strength, 2);
    if (buttons.length === 2) {
      await page.mouse.up({button: buttons[0]});
      expect(await page.evaluate(() => (window as any).compactArenaEngine.sim.utilityPresentation()?.releaseAt)).toBeUndefined();
    }
    await page.mouse.up({button: buttons[buttons.length - 1]});
    await page.waitForFunction(() => !(window as any).compactArenaEngine.sim.selectedUtility);
    const thrown = await page.evaluate(() => (window as any).compactArenaEngine.sim.replay.export().utilities.events
      .filter((event: any) => event.action === 'throw' && event.actorId === 0).at(-1));
    expect(thrown.strength).toBeCloseTo(strength, 2);
  }
});

test('native utility WAVs decode in real Web Audio and held/world voices play and cancel independently', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium'); test.setTimeout(120000);
  await page.goto('/'); await captureEngine(page);
  await page.getByRole('button', {name: 'Enter duel', exact: true}).click();
  await page.waitForFunction(() => (window as any).compactArenaEngine.audio.context?.state === 'running');
  const result = await page.evaluate(async () => {
    const engine = (window as any).compactArenaEngine; engine.pause();
    const audio = engine.audio; await audio.preloadUtilities();
    const decoded = [...audio.samples.keys()].filter((url: string) => url.includes('/utility-')).length;
    const pin = audio.playUtilityCue('hegrenade.pullpin', .001, undefined, 0);
    const fire = audio.playUtilityCue('Inferno.Loop', .001, undefined, 'test-fire', 5);
    const loops = audio.utilityLoops.size;
    audio.playUtilityCue('Inferno.Loop', .001, undefined, 'test-fire', 5);
    const deduplicated = audio.utilityLoops.size;
    audio.cancelUtilityCues(0); const sustained = audio.utilityLoops.size;
    audio.stopUtilityLoops('test-fire'); const stopped = audio.utilityLoops.size; audio.stopVoices();
    return {decoded, pin, fire, loops, deduplicated, sustained, stopped, voices: audio.voices.size};
  });
  expect(result).toEqual({decoded: 118, pin: true, fire: true, loops: 1, deduplicated: 1, sustained: 1, stopped: 0, voices: 0});
});

test('manual lineup walk mode captures and validates native entries and holds, then restores them on use', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium'); test.setTimeout(150000);
  await page.addInitScript(() => localStorage.setItem('spraylab.duel.v1', JSON.stringify({generatedMaps: false,
    realMapChunk: 'dust2-long-doors', botCount: 1, skill: 1, botUtilities: false, shortcutProtection: false})));
  await page.goto('/'); await captureEngine(page);
  const show = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await show.isVisible()) await show.click();
  await page.locator('.manual-spawn-editor > summary').click();
  await page.getByRole('checkbox', {name: 'Manual spawn walk mode'}).check();
  await page.waitForFunction(() => (window as any).compactArenaEngine.spawnAuthoring && !(window as any).compactArenaEngine.loadingMap);
  await page.evaluate(() => {
    const engine = (window as any).compactArenaEngine; engine.sim.start(); engine.sim.resume(); engine.sessionStarted = true;
    for (let i = 0; i < 16; i++) engine.sim.step(); engine.pause();
  });
  await page.getByRole('button', {name: 'Capture entry', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Player entry name'})).toBeVisible();
  const hold = await page.evaluate(() => {
    const engine = (window as any).compactArenaEngine, pose = engine.scenario.curatedLineup('test').bots[0], actor = engine.sim.actors[0];
    actor.position = {...pose.feet, y: pose.feet.y + 64 * .0254}; actor.feet = pose.feet.y;
    actor.yaw = pose.yaw; actor.pitch = pose.pitch; actor.grounded = true; actor.duckAmount = 0;
    return pose;
  });
  await page.getByRole('button', {name: 'Add hold', exact: true}).click();
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: 'Lineup saved on this device.'})).toBeVisible();
  await page.getByRole('button', {name: 'Use lineup', exact: true}).click();
  await page.waitForFunction(() => (window as any).compactArenaEngine.sim.arena.roundSetup?.course.startsWith('manual:'));
  const applied = await page.evaluate(() => {
    const engine = (window as any).compactArenaEngine;
    return {walk: engine.spawnAuthoring, saved: JSON.parse(localStorage.getItem('spraylab.duel.manual-spawns.v1')!).lineups.length,
      bot: engine.sim.actors[1] && {feet: engine.sim.actors[1].feet, x: engine.sim.actors[1].position.x, z: engine.sim.actors[1].position.z}};
  });
  expect(applied.walk).toBe(false); expect(applied.saved).toBe(1);
  expect(applied.bot.x).toBeCloseTo(hold.feet.x, 4); expect(applied.bot.z).toBeCloseTo(hold.feet.z, 4);
});

test('grenade HUD, legal loadouts, release input and visible smoke work in the real renderer', async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium'].includes(info.project.name)); test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (message.type() === 'error' && /THREE.WebGLProgram|VALIDATE_STATUS/.test(message.text())) errors.push(message.text());});
  await page.goto('/');
  await captureEngine(page);
  await expect(page.getByRole('group', {name: 'Grenades', exact: true}).getByRole('button')).toHaveCount(6);
  await page.getByRole('button', {name: 'Equip Smoke grenade, 1 remaining', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Equip Smoke grenade, 1 remaining', exact: true})).toHaveAttribute('aria-pressed', 'true');
  const result = await page.evaluate(async () => {
    const engine = (window as any).compactArenaEngine;
    engine.sim.command(1, {}); engine.sim.start(); engine.sessionStarted = true;
    const actor = engine.sim.actors[0]; actor.pitch = -Math.PI / 3;
    engine.sim.command(0, {fireHeld: true, firePressed: true});
    for (let i = 0; i < 128; i++) engine.sim.step();
    engine.sim.command(0, {fireHeld: false});
    for (let i = 0; i < 24; i++) engine.sim.step();
    const before = engine.sim.actors[0].weapon.ammo;
    const throwEvents = engine.sim.drainEvents();
    // Let normal engine frames play the grounded bloom and upload shader buffers.
    engine.paused = false;
    return {thrown: throwEvents.filter((event: any) => event.kind === 'utility' && event.action === 'throw').length,
      ammo: before, count: engine.sim.utilityInventory().smoke};
  });
  expect(result).toEqual({thrown: 1, ammo: 30, count: 0});
  await page.waitForFunction(() => (window as any).compactArenaEngine.sim.utilities.effects.some((effect: any) => effect.type === 'smoke'), undefined, {timeout: 10000});
  await expect.poll(() => page.evaluate(() => (window as any).compactArenaEngine.utilityRenderer.smoke.count)).toBeGreaterThan(0);
  expect(await canvasColors(page, 'canvas[data-duel]')).toBeGreaterThan(3);
  const bounds = await page.locator('.duel-utility-hud').boundingBox();
  expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.screenshot({path: `research/utilities-${info.project.name}.png`});
  expect(errors).toEqual([]);
});

test('every grenade type is selectable in the four-slot loadout and persists', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium'); test.setTimeout(120000);
  await page.goto('/');
  await captureEngine(page);
  const panel = page.locator('.duel-setup');
  const show = page.getByRole('button', {name: 'Show drill panel', exact: true});
  if (await show.isVisible()) await show.click();
  await panel.locator('summary').filter({hasText: /^Utility/}).click();
  await page.getByRole('checkbox', {name: 'Carry Incendiary grenade', exact: true}).check();
  await expect(page.getByRole('checkbox', {name: 'Carry Molotov', exact: true})).not.toBeChecked();
  await page.getByRole('checkbox', {name: 'Carry HE grenade', exact: true}).uncheck();
  await page.getByRole('checkbox', {name: 'Carry Decoy grenade', exact: true}).check();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.duel.v1')!).utilityLoadout)).toEqual(['flash', 'smoke', 'incendiary', 'decoy']);
  await page.reload();
  await captureEngine(page);
  await expect(page.getByRole('button', {name: 'Equip Decoy grenade, 1 remaining', exact: true})).toBeEnabled();
});

test('bot sidearm switching reuses the correct native weapon and muzzle without cloning every switch', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium'); test.setTimeout(120000);
  await page.goto('/'); await captureEngine(page);
  await page.waitForFunction(() => (window as any).compactArenaEngine.worldWeapons.has('usp'));
  await page.evaluate(() => {
    const engine = (window as any).compactArenaEngine;
    engine.originalBotWeapon = engine.heldWeapons.get(1);
    engine.sim.equipBot(engine.sim.actors[1], 'usp');
  });
  await page.waitForFunction(() => (window as any).compactArenaEngine.actorEquipment.get(1) === 'usp');
  expect(await page.evaluate(() => (window as any).compactArenaEngine.heldWeapons.get(1).name)).toBe('held_usp');
  await page.evaluate(() => {
    const engine = (window as any).compactArenaEngine;
    engine.sim.equipBot(engine.sim.actors[1], 'ak47');
  });
  await page.waitForFunction(() => (window as any).compactArenaEngine.actorEquipment.get(1) === 'ak47');
  const restored = await page.evaluate(() => {
    const engine = (window as any).compactArenaEngine;
    return {same: engine.heldWeapons.get(1) === engine.originalBotWeapon, cached: engine.actorWeaponCache.get(1).size};
  });
  expect(restored).toEqual({same: true, cached: 2});
});

test('grenade loot and recorded flight, smoke and backwards seeks work end to end',async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/THREE.WebGLProgram|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
  await page.goto('/');await captureEngine(page);
  await page.evaluate(()=>{
    const engine=(window as any).compactArenaEngine;engine.paused=false;engine.sessionStarted=true;engine.inputName='Drag aim (browser test)';engine.sim.start();engine.sim.command(1,{});
    engine.sim.selectUtility('he');engine.sim.command(0,{dropPressed:true});
    for(let i=0;i<64;i++)engine.sim.step();engine.syncDrops();engine.report();
  });
  await expect(page.getByRole('button',{name:/E Pick up HE grenade/})).toBeVisible();
  await page.getByRole('button',{name:/E Pick up HE grenade/}).click();
  const times=await page.evaluate(async()=>{
    const engine=(window as any).compactArenaEngine,sim=engine.sim;sim.step();
    if(sim.utilityInventory().he!==1)throw new Error('HUD pickup did not restore inventory');
    engine.syncDrops();engine.report();
    sim.actors[0].pitch=-Math.PI/3;sim.selectUtility('smoke');engine.throwUtility();
    engine.paused=true;
    for(let i=0;i<128*5;i++)sim.step();
    const recording=sim.replay.export(),thrown=recording.utilities.events.find((event:any)=>event.action==='throw'&&event.kind==='smoke');
    const cloud=recording.utilities.effects.find((effect:any)=>effect.type==='smoke');
    if(!thrown||!cloud)throw new Error('Live throw/effect was not recorded');
    (window as any).utilityReviewRecording=recording;
    await engine.replayScene.prepareUtilities(recording);
    return {flight:thrown.time+.05,smoke:cloud.startedAt+1,before:Math.max(0,thrown.time-.2),inventory:sim.utilityInventory().smoke};
  });
  const sample=async(time:number)=>page.evaluate(time=>{
    const engine=(window as any).compactArenaEngine;
    engine.showReplay((window as any).utilityReviewRecording,undefined,time,true);
    engine.replayScene.camera(engine.camera,undefined,true);
    return {smoke:engine.replayScene.utilityRenderer.smoke.count,
      flight:engine.replayScene.group.getObjectsByProperty('isInstancedMesh',true)
        .filter((mesh:any)=>mesh.name.startsWith('utility-projectiles-')).reduce((sum:number,mesh:any)=>sum+mesh.count,0),
      inventory:engine.sim.utilityInventory().smoke};
  },time);
  const flight=await sample(times.flight);expect(flight.smoke).toBe(0);
  // The native projectile pool retains each material primitive as one instance.
  expect(flight.flight).toBeGreaterThan(0);
  const smoke=await sample(times.smoke);expect(smoke.smoke).toBeGreaterThan(0);
  expect((await sample(times.before)).smoke).toBe(0);expect(await sample(times.smoke)).toEqual(smoke);
  expect(smoke.inventory).toBe(times.inventory);
  expect(await canvasColors(page,'canvas[data-duel]')).toBeGreaterThan(3);
  await page.screenshot({path:'research/utility-replay-completion.png'});
  await page.evaluate(()=>(window as any).compactArenaEngine.closeReplay());expect(errors).toEqual([]);
});

test('native-reference fire grows from one flame and reuses its real renderer buffers',async({page},info)=>{
  test.skip(!['chromium','mobile-chromium'].includes(info.project.name));test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/THREE.WebGLProgram|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
  await page.goto('/');await captureEngine(page);
  const result=await page.evaluate(()=>{
    const engine=(window as any).compactArenaEngine,sim=engine.sim;
    engine.paused=true;sim.command(1,{});
    sim.configureUtilities({utilitiesEnabled:true,botUtilities:false,utilityLoadout:['molotov']});
    sim.selectUtility('molotov');sim.start();sim.actors[0].pitch=-Math.PI/3;sim.queueUtilityThrow(0);
    const fire=engine.scene.getObjectByName('utility-fire'),buffer=fire.instanceMatrix.array;
    let first=0,largest=0;
    for(let i=0;i<512;i++) {
      sim.step();const effect=sim.utilities.effects.find((effect:any)=>effect.type==='fire');
      if(effect){first||=effect.cells.length;largest=Math.max(largest,effect.cells.length);}
      if(i%16===0)engine.utilityRenderer.update(sim.utilities.projectiles,sim.utilities.effects,sim.time,engine.camera);
    }
    engine.utilityRenderer.update(sim.utilities.projectiles,sim.utilities.effects,sim.time,engine.camera);
    engine.renderer.render(engine.scene,engine.camera);
    return{first,largest,instances:fire.count,sameBuffer:buffer===fire.instanceMatrix.array};
  });
  expect(result.first).toBe(1);expect(result.largest).toBeGreaterThan(1);expect(result.largest).toBeLessThanOrEqual(16);
  expect(result.instances).toBeGreaterThan(0);expect(result.sameBuffer).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:`research/native-fire-growth-${info.project.name}.png`});
});
