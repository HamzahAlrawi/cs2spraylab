import {test,expect} from '@playwright/test';
import sharp from 'sharp';

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'peek'}));
  });
});

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
test('hit captions sit just below the crosshair without covering the score in every mode',async({page},info)=>{
  await ready(page);
  for(const size of [null,{width:390,height:844},{width:844,height:390}]){
    if(size)await page.setViewportSize(size);
    for(const mode of ['guided','spray','transfer','peek','precision','burst']){
      await page.getByLabel('Training mode').selectOption(mode);
      if(['peek','precision','burst'].includes(mode))await expect(page.locator('.drill-panel')).toBeVisible();
      else await expect(page.locator('.drill-panel')).toHaveCount(0);
      for(const label of ['HEADSHOT','BODY HIT']){
        await page.locator('.hit-caption').evaluate((el,text)=>{el.textContent=text;},label);
        const [caption,c,score]=await page.evaluate(()=>['.hit-caption','canvas[data-range]','.hud-result'].map(selector=>{
          const r=document.querySelector(selector)!.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
        }));
        const cx=c.x+c.width/2,cy=c.y+c.height/2;
        expect(Math.abs(caption.x+caption.width/2-cx)).toBeLessThan(2);
        expect(caption.y-cy).toBeGreaterThanOrEqual(24);expect(caption.y-cy).toBeLessThanOrEqual(44);
        expect(caption.y+caption.height).toBeLessThan(score.y);
      }
    }
  }
  await page.screenshot({path:`test-results/${info.project.name}-below-crosshair.png`,style:'.hit-caption{opacity:1!important}.enter-range{visibility:hidden}'});
});

test('six-shot bursts and configurable timed peeking retain live shot feedback',async({page})=>{
  await ready(page);
  await page.getByLabel('Training mode').selectOption('burst');
  const canvas=page.locator('canvas[data-range]');
  const tap=async()=>{
    await canvas.dispatchEvent('pointerdown',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
    await canvas.dispatchEvent('pointerup',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
  };
  await tap();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('spraylab.results.v2')||'[]')[0]?.shots)).toBe(6);
  await page.getByLabel('Training mode').selectOption('peek');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByLabel('Peeking target duration',{exact:true}).fill('4');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();await expect(page.getByRole('button',{name:'Enter range',exact:true})).toBeEnabled({timeout:45000});
  await expect(page.locator('.coach-condition')).toContainText('4 s from first shot');
  await tap();
  const accurate=page.locator('.drill-metrics div').filter({has:page.locator('dt',{hasText:'Hits after stopping'})}).locator('dd');
  const settled=page.locator('.drill-metrics div').filter({has:page.locator('dt',{hasText:'Shots after stopping'})}).locator('dd');
  await expect.poll(async()=>Number((await settled.innerText()).split('/')[0])).toBeGreaterThan(5);
  await expect(accurate).toHaveText(/^0\/\d+$/);
  await expect(page.locator('.coach-heading')).toContainText('REP 1');
  await expect(page.locator('.coach-heading')).toContainText('REP 2',{timeout:15000});
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('spraylab.results.v2')||'[]')[0]?.shots)).toBe(30);
  await expect(page.getByRole('status',{name:'Rep feedback',exact:true})).toContainText('Your shot was blocked by cover');
});

test('repeated mistakes produce a central tip and the skin donation label fits narrow screens',async({page},info)=>{
  await page.addInitScript(()=>{Math.random=()=>.9;});
  await ready(page);
  await page.getByLabel('Training mode').selectOption('peek');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByLabel('Peeking target duration',{exact:true}).fill('0.5');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  for(let i=1;i<=3;i++){
    await page.locator('canvas[data-range]').dispatchEvent('pointerdown',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
    await page.locator('canvas[data-range]').dispatchEvent('pointerup',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('spraylab.results.v2')||'[]').length)).toBe(i);
    await expect(page.getByRole('status',{name:'Rep feedback',exact:true})).toBeVisible();
  }
  const feedback=page.getByRole('status',{name:'Rep feedback',exact:true});
  await expect(feedback).toContainText('Move farther sideways until you can see and hit the head');
  for(const size of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
    await page.setViewportSize(size);
    // WebGL dimensions follow ResizeObserver, which can lag the CSS viewport.
    await expect.poll(()=>page.evaluate(()=>{
      const canvas=document.querySelector('canvas[data-range]')!.getBoundingClientRect();
      const view=document.querySelector('.range-view')!.getBoundingClientRect();
      return Math.abs(canvas.height-view.height)+Math.abs(canvas.width-view.width);
    })).toBeLessThan(1);
    const boxes=await page.evaluate(()=>{
      const rect=(selector:string)=>{const r=document.querySelector(selector)!.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
      return{feedback:rect('.rep-feedback'),canvas:rect('canvas[data-range]'),donate:rect('.header-donation'),settings:rect('.settings-button'),brand:rect('.brand'),history:rect('.main-nav')};
    });
    expect(boxes.feedback.y+boxes.feedback.height).toBeLessThanOrEqual(boxes.canvas.y+boxes.canvas.height-4);
    expect(boxes.feedback.y).toBeGreaterThan(boxes.canvas.y+boxes.canvas.height/2+15);
    expect(boxes.brand.x+boxes.brand.width).toBeLessThanOrEqual(boxes.history.x);
    expect(boxes.history.x+boxes.history.width).toBeLessThanOrEqual(boxes.donate.x);
    expect(boxes.donate.x+boxes.donate.width).toBeLessThanOrEqual(boxes.settings.x);
    expect(boxes.settings.x+boxes.settings.width).toBeLessThanOrEqual(size.width);
    await expect(page.getByRole('link',{name:'Donate unwanted CS2 skins',exact:true})).toBeVisible();
    await page.screenshot({path:`test-results/${info.project.name}-rep-tip-${size.width}.png`});
  }
});
