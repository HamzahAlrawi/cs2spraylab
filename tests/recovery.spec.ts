import {test,expect} from '@playwright/test';

test('spread defaults on, explicit off is visible, and impact size persists',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Enter range',exact:true})).toBeEnabled({timeout:45000});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByLabel('Practice spread',{exact:true})).toBeChecked();
  await page.getByLabel('Bullet impact size',{exact:true}).fill('3');
  await page.getByLabel('Practice spread',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('button',{name:'Spread off',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Spread off',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByLabel('Practice spread',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Bullet impact size',{exact:true})).toHaveValue('3');
});

test('stationary counterstrafing attempts score zero and show a central movement tip',async({page},info)=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Enter range',exact:true})).toBeEnabled({timeout:45000});
  await page.getByLabel('Training mode').selectOption({label:'Counterstrafing practice'});
  const canvas=page.locator('canvas[data-range]');
  await canvas.dispatchEvent('pointerdown',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
  await canvas.dispatchEvent('pointerup',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
  await expect(page.getByTestId('accuracy')).toHaveText('0/100');
  const feedback=page.getByRole('status',{name:'Rep feedback',exact:true});
  await expect(feedback).toContainText('Move, then counter-strafe');
  await expect(feedback.locator('p')).toBeVisible();
  await page.screenshot({path:`test-results/${info.project.name}-counterstrafe-tip.png`});
  const [f,c]=await page.evaluate(()=>['.rep-feedback','canvas[data-range]'].map(s=>{
    const r=document.querySelector(s)!.getBoundingClientRect();return{y:r.y,height:r.height};
  }));
  expect(f.y).toBeGreaterThan(c.y+c.height/2+15);expect(f.y+f.height).toBeLessThanOrEqual(c.y+c.height);
});

test('peek arrow alternates with the target lane and clears once the shot is unobstructed',async({page},info)=>{
  test.skip(info.project.name.startsWith('mobile'),'Keyboard movement only');
  await page.addInitScript(()=>{Math.random=()=>.9;Object.defineProperty(HTMLElement.prototype,'requestPointerLock',{value:undefined});});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Enter range',exact:true})).toBeEnabled({timeout:45000});
  await page.getByLabel('Training mode').selectOption('peek');
  await page.getByRole('button',{name:'Enter range',exact:true}).click();
  await expect(page.getByRole('status',{name:'Peek right',exact:true})).toBeVisible();
  await page.screenshot({path:`test-results/${info.project.name}-peek-arrow.png`});
  await page.keyboard.down('KeyD');
  await expect(page.locator('.peek-direction')).toHaveCount(0);
  await page.keyboard.up('KeyD');
  await page.locator('canvas[data-range]').dispatchEvent('pointerdown',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
  await page.locator('canvas[data-range]').dispatchEvent('pointerup',{button:0,pointerId:1,isPrimary:true,pointerType:'touch'});
  await expect(page.getByRole('status',{name:'Peek left',exact:true})).toBeVisible();
});
