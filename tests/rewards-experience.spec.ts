import {expect, test} from '@playwright/test';

test('reward overview, exact finish navigation and purchase requirements fit desktop and mobile', async ({page}, info) => {
  test.skip(!['chromium','mobile-chromium'].includes(info.project.name));
  await page.addInitScript(()=>localStorage.setItem('spraylab.progression.v1',JSON.stringify({version:2,xp:10000,balance:1000})));
  await page.goto('/tests/armory-host.html');
  await page.getByRole('button',{name:/Open armory/}).click();
  const dialog=page.getByRole('dialog',{name:'Armory',exact:true});
  await expect(dialog.getByRole('region',{name:'Rewards overview'})).toBeVisible();
  for (const [width,height] of [[1440,1000],[390,844],[320,700],[844,390]]) {
    await page.setViewportSize({width,height});
    expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    expect(await dialog.locator('button').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth+1))).toBe(true);
    await page.screenshot({path:info.outputPath(`reward-overview-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  const finish=dialog.getByRole('button',{name:/^View unlock /}).first();
  const label=(await finish.getAttribute('aria-label'))!.replace('View unlock ','');
  await finish.click();
  await expect(dialog.locator('.armory-detail h3')).toHaveText(label);
  await expect(dialog.getByRole('list',{name:'Unlock requirements'})).toBeVisible();
  await expect(dialog.getByRole('progressbar',{name:'Credits saved for this finish'})).toBeVisible();
  await dialog.getByRole('button',{name:/^Achievements/}).click();
  await dialog.getByLabel('Search achievements').fill('Keep it head level');
  await expect(dialog.locator('.achievement-row')).toHaveCount(4);
});

test('level-up is skippable after half a second, does not re-award credits, and honors reduced motion', async ({page},info)=>{
  test.skip(!['chromium','mobile-chromium'].includes(info.project.name));
  await page.addInitScript(()=>localStorage.setItem('spraylab.progression.v1',JSON.stringify({version:2,xp:180,balance:200})));
  await page.goto('/tests/armory-host.html');
  await page.waitForFunction(()=>!!(window as any).armoryController);
  await page.evaluate(async()=>{await (window as any).armoryController.ready;});
  await page.clock.install();
  await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+1000)));
  const award=await page.evaluate(async()=>{
    const c=(window as any).armoryController;await c.ready;
    const setup={playerHealth:100,playerArmor:true,bots:[{id:'1',skill:5,health:100,armor:true,accuracy:1,weapon:'ak47'}]};
    const result={completion:'completed',outcome:'won',activeSeconds:20,review:{score:92,shots:10,hits:8,heads:4,kills:1,damage:100,taken:0,settled:100,movingShots:0,airShots:0},opponents:[{id:'1',healthDamage:100,killed:true}]};
    c.completeDuel(c.beginDuel(setup,'test'),result,setup,'test');
    return {balance:c.getSnapshot().profile.balance,level:c.getSnapshot().notification.levelAfter};
  });
  const reveal=page.getByRole('status',{name:`Level up to ${award.level}`,exact:true});
  await expect(reveal).toBeVisible();
  const skip=reveal.getByRole('button',{name:'Skip level-up reveal'});
  await expect(skip).toBeDisabled();
  await page.clock.runFor(499);await expect(skip).toBeDisabled();
  await page.clock.runFor(1);await expect(skip).toBeEnabled();
  await page.screenshot({path:info.outputPath('rank-reveal.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await reveal.evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
  await skip.click();await expect(reveal).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).armoryController.getSnapshot().profile.balance)).toBe(award.balance);
});
