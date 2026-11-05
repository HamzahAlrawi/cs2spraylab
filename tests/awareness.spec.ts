import {expect,test,type Page} from '@playwright/test';
import {canvasColors} from './render-frame';
async function capture(page:Page){
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(e=>e.name.includes('/src/range/duel/DuelEngine.ts')));
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/src/range/duel/DuelEngine.ts'))!.name;
    const {DuelEngine}=await import(/* @vite-ignore */url),tick=DuelEngine.prototype.tick;
    DuelEngine.prototype.tick=function(time:number){(window as any).awarenessEngine=this;return tick.call(this,time);};
  });
  await page.waitForFunction(()=>!!(window as any).awarenessEngine);
}
test('map sound awareness reveals only heard sources, then scores an unaided physical shot and persists results',async({page},info)=>{
  test.skip(!['chromium','mobile-chromium'].includes(info.project.name));test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'awareness',volume:.5,quality:'performance',frameLimit:60,protectShortcuts:false}));
    localStorage.setItem('spraylab.awareness.v1',JSON.stringify({chunk:'dust2-mid-ct',stage:'reveal',autoNext:false}));
  });
  await page.goto('/');await capture(page);
  const enter=page.getByRole('button',{name:'Start sound practice',exact:true});
  await expect(enter).toBeVisible({timeout:120000});await expect(enter).toBeEnabled();
  expect(await canvasColors(page,'canvas[data-duel]')).toBeGreaterThan(8);
  await expect(page.locator('.awareness-marker')).toBeHidden();await enter.click();
  await page.waitForFunction(()=>{const e=(window as any).awarenessEngine;return !!e.scenario.trial?.heardAt&&e.sim.time>=e.scenario.trial.heardAt;},undefined,{timeout:30000});
  await expect(page.locator('.awareness-marker')).toBeVisible();
  await page.screenshot({path:info.outputPath('awareness-assisted.png'),fullPage:true});
  if(info.project.name==='mobile-chromium')await page.getByRole('button',{name:'Pause listening',exact:true}).click();else await page.keyboard.press('Escape');
  if(!await page.getByRole('radio',{name:'Unaided training',exact:true}).isVisible())await page.getByRole('button',{name:'Show drill panel',exact:true}).click();
  await page.getByRole('radio',{name:'Direction hint',exact:true}).check();
  if(info.project.name==='mobile-chromium')await page.getByRole('button',{name:'Hide drill panel',exact:true}).click();
  await page.getByRole('button',{name:'Resume listening',exact:true}).click();
  await expect(page.locator('.awareness-marker[data-hint=true]')).toBeVisible({timeout:30000});
  expect(await page.evaluate(()=>{const e=(window as any).awarenessEngine;return e.scenario.radarContacts(e.sim).length;})).toBe(0);
  if(info.project.name==='mobile-chromium')await page.getByRole('button',{name:'Pause listening',exact:true}).click();else await page.keyboard.press('Escape');
  if(!await page.getByRole('radio',{name:'Unaided training',exact:true}).isVisible())await page.getByRole('button',{name:'Show drill panel',exact:true}).click();
  await page.getByRole('radio',{name:'Unaided training',exact:true}).check();
  if(info.project.name==='mobile-chromium')await page.getByRole('button',{name:'Hide drill panel',exact:true}).click();
  await page.getByRole('button',{name:'Resume listening',exact:true}).click();
  await page.waitForFunction(()=>{const e=(window as any).awarenessEngine;return !!e.scenario.trial?.heardAt&&e.sim.time>=e.scenario.trial.heardAt;},undefined,{timeout:30000});
  await expect(page.locator('.awareness-marker')).toBeHidden();
  expect(await page.evaluate(()=>{const e=(window as any).awarenessEngine;return e.scenario.radarContacts(e.sim).length;})).toBe(0);
  await page.evaluate(()=>{
    const e=(window as any).awarenessEngine,s=e.sim,a=s.actors[0],target=e.scenario.trial.target;
    const x=target.x-a.position.x,y=target.y-a.position.y,z=target.z-a.position.z;
    s.command(0,{yawDelta:Math.atan2(-x,-z)-a.yaw,pitchDelta:Math.atan2(y,Math.hypot(x,z))-a.pitch});
  });
  await page.waitForTimeout(100);
  if(info.project.name==='mobile-chromium')await page.locator('canvas[data-duel]').tap();else{await page.mouse.down();await page.mouse.up();}
  await expect(page.locator('.awareness-feedback')).toContainText('Source revealed');
  const rows=await page.evaluate(()=>JSON.parse(localStorage.getItem('spraylab.awareness.history.v1')??'[]'));
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({stage:'training',mapId:'de_dust2',chunk:'dust2-mid-ct'});expect(rows[0].score).toBeGreaterThan(85);
  await expect(page.locator('.awareness-marker')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:info.outputPath('awareness-answer.png'),fullPage:true});
  if(info.project.name==='mobile-chromium')await page.getByRole('button',{name:'Pause listening',exact:true}).click();else await page.keyboard.press('Escape');
  if(!await page.getByRole('radio',{name:'Unaided training',exact:true}).isVisible())await page.getByRole('button',{name:'Show drill panel',exact:true}).click();
  await page.locator('summary').filter({hasText:'Audio setup'}).click();
  await page.getByLabel('Awareness output',{exact:true}).selectOption('mono');
  await expect(page.getByLabel('Awareness output',{exact:true})).toHaveValue('mono');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('spraylab.awareness.v1')??'{}').device)).toBe('mono');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.locator('.awareness-settings').screenshot({path:info.outputPath('awareness-setup.png')});
  expect(errors).toEqual([]);
});
