import {test,expect,type Page} from '@playwright/test';

async function captureEngine(page:Page) {
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(row=>row.name.includes('/duel/DuelEngine.ts')));
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(row=>row.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine}=await import(/* @vite-ignore */url),original=DuelEngine.prototype.tick;
    DuelEngine.prototype.tick=function(time:number){(window as any).presentationEngine=this;return original.call(this,time);};
  });
  await page.waitForFunction(()=>(window as any).presentationEngine?.criticalReady,null,{timeout:90000});
}

test('native chunk selection keeps the renderer; resolved headshots publish effects and a bounded feed',async({page},info)=>{
  test.skip(info.project.name!=='chromium');test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0,quality:'auto'}));
    localStorage.setItem('spraylab.duel.v1',JSON.stringify({realMapChunk:'dust2-mid-ct',botCount:2}));
  });
  await page.goto('/');await captureEngine(page);
  await page.evaluate(()=>{const e=(window as any).presentationEngine;(window as any).presentationRenderer=e.renderer;});
  const show=page.getByRole('button',{name:'Show drill panel',exact:true});if(await show.isVisible())await show.click();
  await page.locator('summary').filter({hasText:/^Arena$/}).click();
  await page.getByLabel('Real map chunk',{exact:true}).selectOption('dust2-a-short');
  await page.getByLabel('Real map chunk',{exact:true}).selectOption('dust2-b-entry');
  await page.waitForFunction(()=>{const e=(window as any).presentationEngine;return !e.loadingMap&&e.scenario.chunk.id==='dust2-b-entry';},null,{timeout:90000});
  expect(await page.evaluate(()=>(window as any).presentationEngine.renderer===(window as any).presentationRenderer)).toBe(true);
  const result=await page.evaluate(()=>{
    const e=(window as any).presentationEngine,actor=e.sim.actors[1],point={...actor.position};
    e.sim.phase='fighting';actor.alive=false;actor.health=0;
    e.processEvents([{kind:'hit',tick:0,shooter:0,victim:1,shotId:9000,group:'head',point,
      direction:{x:0,y:0,z:-1},healthDamage:100,armorDamage:0,lethal:true,helmet:true}]);
    e.report();e.paused=true;
    return {particles:e.characterHits.activeCount,feed:e.killFeed.entries(e.animationClock)};
  });
  expect(result.particles).toBeGreaterThanOrEqual(8);expect(result.feed).toHaveLength(1);
  await expect(page.getByRole('log',{name:'Death feed'})).toContainText('You');
  await expect(page.locator('.kill-feed-headshot')).toHaveCount(1);
  await page.evaluate(()=>{const e=(window as any).presentationEngine;e.restart(false,false);e.report();});
  await expect(page.locator('.kill-feed-row')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).presentationEngine.characterHits.activeCount)).toBe(0);
  expect(errors).toEqual([]);
});
