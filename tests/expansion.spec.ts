import {test,expect} from '@playwright/test';
import sharp from 'sharp';

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Enter range',exact:true})).toBeEnabled({timeout:45000});
}
async function rendered(page: import('@playwright/test').Page) {
  // Sample the actual WebGL framebuffer, excluding DOM overlays in screenshots.
  await expect.poll(()=>page.locator('canvas[data-range]').evaluate(node=>new Promise<number>(resolve=>requestAnimationFrame(()=>{
    const canvas=node as HTMLCanvasElement,gl=canvas.getContext('webgl2');
    if(!gl||gl.isContextLost()){resolve(0);return;}
    const pixel=new Uint8Array(4),colors=new Set<string>();
    for(let y=1;y<5;y++)for(let x=1;x<5;x++){
      gl.readPixels(Math.floor(canvas.width*x/5),Math.floor(canvas.height*y/5),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      colors.add(`${pixel[0]},${pixel[1]},${pixel[2]}`);
    }
    resolve(colors.size);
  }))),{timeout:15000}).toBeGreaterThan(3);
}

test('the resized drill canvas remains visible without DOM overlays',async({page,browserName})=>{
  await ready(page);
  await page.getByLabel('Training mode').selectOption('peek');
  await rendered(page);
  const png=await page.locator('canvas[data-range]').screenshot({style:'.range-view > :not(.canvas-host), .canvas-host > :not(canvas) { visibility:hidden !important; }'});
  const stats=await sharp(png).stats();
  test.fail(browserName==='webkit'&&process.platform==='win32','Windows Playwright WebKit also loses a standalone WebGL canvas after a backing-buffer resize; physical Safari verification is pending.');
  expect(stats.channels.slice(0,3).every(channel=>channel.stdev>8)).toBe(true);
});
test('sidearm and emerald knife render, switch back to primary, and USP is semi-automatic',async({page},info)=>{
  await ready(page);
  const canvas=page.locator('canvas[data-range]');
  const initial=await canvas.screenshot();
  await page.getByRole('button',{name:'Equip USP-S',exact:true}).click();
  await expect(page.getByRole('button',{name:'Enter range',exact:true})).toBeEnabled({timeout:45000});
  await rendered(page);
  const pistol=await canvas.screenshot();expect(pistol.equals(initial)).toBe(false);
  await page.screenshot({path:`test-results/${info.project.name}-usp.png`});
  await expect(page.getByTestId('ammo')).toContainText('12');
  await page.getByRole('button',{name:'Enter range',exact:true}).click();
  await expect(page.locator('.hud-ammo>span')).toHaveText('Ready');
  await canvas.dispatchEvent('pointerdown',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
  await canvas.dispatchEvent('pointerup',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
  await expect(page.getByTestId('ammo')).toContainText('11');
  await page.waitForTimeout(400);await expect(page.getByTestId('ammo')).toContainText('11');
  if(await page.evaluate(()=>!!document.pointerLockElement))await page.keyboard.press('Escape');
  else await page.getByRole('button',{name:'Pause range',exact:true}).click();
  await page.getByRole('button',{name:'Equip Butterfly | Emerald',exact:true}).click();
  await expect(page.getByRole('button',{name:'Enter range',exact:true})).toBeEnabled({timeout:45000});
  await rendered(page);
  const knife=await canvas.screenshot();expect(knife.equals(pistol)).toBe(false);
  const stats=await sharp(knife).stats();expect(stats.channels[1].stdev).toBeGreaterThan(10);
  await page.screenshot({path:`test-results/${info.project.name}-butterfly.png`});
  await page.getByRole('button',{name:'Equip AK-47',exact:true}).click();
  await expect(page.getByRole('button',{name:'Enter range',exact:true})).toBeEnabled({timeout:45000});
  await expect(page.getByTestId('ammo')).toContainText('30');
  const decoded=await page.evaluate(async()=>{
    if(!window.AudioContext)return null;
    const context=new AudioContext();
    try{return await Promise.all(['usp','knife'].map(async id=>{
      const response=await fetch(`/audio/${id}.wav`),buffer=await context.decodeAudioData(await response.arrayBuffer());
      return {duration:buffer.duration,peak:buffer.getChannelData(0).reduce((p,n)=>Math.max(p,Math.abs(n)),0)};
    }));}finally{await context.close();}
  });
  if(decoded)for(const sample of decoded){expect(sample.duration).toBeGreaterThan(.05);expect(sample.peak).toBeGreaterThan(.01);}
});
test('peeking begins in cover and records stopping and aiming feedback after the entry',async({page},info)=>{
  test.skip(info.project.name.startsWith('mobile'),'Peeking requires keyboard movement');
  await page.addInitScript(()=>{Math.random=()=>.2;Object.defineProperty(HTMLElement.prototype,'requestPointerLock',{value:undefined});});
  await ready(page);await page.getByLabel('Training mode').selectOption('peek');
  const coach=page.getByRole('complementary',{name:'Drill coach'});
  await expect(coach).toContainText('Peek right');
  await page.screenshot({path:`test-results/${info.project.name}-peek-covered.png`});
  await page.getByRole('button',{name:'Enter range',exact:true}).click();
  await page.keyboard.down('KeyD');await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');await page.keyboard.down('KeyA');await page.waitForTimeout(80);await page.keyboard.up('KeyA');
  const canvas=page.locator('canvas[data-range]');
  await canvas.dispatchEvent('pointerdown',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
  await canvas.dispatchEvent('pointerup',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
  await expect(coach.locator('.drill-metrics')).toBeVisible();
  await expect(coach).toContainText('Counter-strafe');await expect(coach).toContainText('Aim on reveal');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('spraylab.results.v2')||'[]').some((r:{drill:unknown})=>!!r.drill))).toBe(true);
  await page.screenshot({path:`test-results/${info.project.name}-peek-feedback.png`});
  await page.getByRole('button',{name:'Session',exact:false}).click();
  await expect(page.getByRole('dialog').locator('.drill-review')).toBeVisible();
  for(const icon of await page.locator('.replay .drill-review svg').all())expect((await icon.boundingBox())!.height).toBeLessThanOrEqual(20);
  await page.screenshot({path:`test-results/${info.project.name}-drill-history.png`});
});
test('new drills and coach fit desktop, portrait and landscape with no overlap of the aiming area',async({page},info)=>{
  await ready(page);
  for(const mode of ['precision','burst','peek']){
    await page.getByLabel('Training mode').selectOption(mode);
    const coach=page.locator('.drill-panel'),canvas=page.locator('canvas[data-range]');
    await expect(coach).toBeVisible();
    await rendered(page);
    const a=(await canvas.boundingBox())!,b=(await coach.boundingBox())!;
    expect(a.width).toBeGreaterThan(100);expect(a.height).toBeGreaterThan(100);
    expect(a.x+a.width<=b.x+1 || a.y+a.height<=b.y+1).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const enter=(await page.locator('.enter-range').boundingBox())!,hud=(await page.locator('.hud-result').boundingBox())!;
    expect(enter.y+enter.height).toBeLessThan(hud.y);
    await page.screenshot({path:`test-results/${info.project.name}-${mode}-layout.png`});
  }
  await page.setViewportSize({width:844,height:390});
  await rendered(page);
  const canvas=(await page.locator('canvas[data-range]').boundingBox())!,coach=(await page.locator('.drill-panel').boundingBox())!;
  expect(canvas.x+canvas.width).toBeLessThanOrEqual(coach.x+1);
  expect(coach.y+coach.height).toBeLessThanOrEqual(391);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/${info.project.name}-peek-landscape.png`});
});
test('slot clicks keep keyboard movement focused and pausing clears held directions',async({page},info)=>{
  test.skip(info.project.name.startsWith('mobile'),'Keyboard movement coverage');
  await page.addInitScript(()=>Object.defineProperty(HTMLElement.prototype,'requestPointerLock',{value:undefined}));
  await ready(page);await page.getByRole('button',{name:'Enter range',exact:true}).click();
  await page.getByRole('button',{name:'Equip AK-47',exact:true}).click();
  await expect(page.locator('canvas[data-range]')).toBeFocused();
  await page.keyboard.down('KeyD');
  await expect.poll(async()=>Number(await page.locator('.hud-stat b').first().innerText())).toBeGreaterThan(100);
  await page.getByRole('button',{name:'Pause range',exact:true}).click();
  await page.getByRole('button',{name:'Enter range',exact:true}).click();
  await page.keyboard.press('KeyW');await page.waitForTimeout(350);
  await expect(page.locator('.hud-stat b').first()).toHaveText('0');
  await page.keyboard.up('KeyD');
});
test('hit captions stay away from the crosshair during a burst',async({page})=>{
  await ready(page);
  const canvas=page.locator('canvas[data-range]');
  await canvas.dispatchEvent('pointerdown',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
  await expect(page.locator('.hit-caption')).toHaveCSS('opacity','1');
  const caption=(await page.locator('.hit-caption').boundingBox())!,c=(await canvas.boundingBox())!;
  const cx=c.x+c.width/2,cy=c.y+c.height/2;
  expect(caption.x+caption.width<cx-35||caption.x>cx+35||caption.y+caption.height<cy-35||caption.y>cy+35).toBe(true);
});
