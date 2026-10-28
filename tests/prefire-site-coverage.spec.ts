import {expect, test, type Page} from '@playwright/test';
import sharp from 'sharp';

async function showDrillPanel(page:Page) {
  const button=page.getByRole('button',{name:'Show drill panel',exact:true});
  if(await button.isVisible()) await button.click();
}

async function openPractice(page:Page) {
  await page.addInitScript(()=>{performance.setResourceTimingBufferSize(10000);if(!localStorage.getItem('spraylab.range.v2'))
    localStorage.setItem('spraylab.range.v2',JSON.stringify({mode:'duel',volume:0,quality:'performance'}));});
  await page.goto('/'); await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async()=>{
    const path=performance.getEntriesByType('resource').find(row=>row.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine}=await import(/* @vite-ignore */ path),tick=DuelEngine.prototype.tick;
    DuelEngine.prototype.tick=function(time:number){(window as any).siteCoverage=this;return tick.call(this,time);};
  });
  await page.getByLabel('Training mode').selectOption('prefire');
  await showDrillPanel(page);
  await expect(page.getByLabel('Prefire route')).toBeVisible({timeout:90000});
  await page.getByLabel('Training preset').selectOption('learn');
}

test('focused CT and site-box lineups are selectable and retain exact supported native spawns',async({page},info)=>{
  test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await openPractice(page);
  for(const [route,lineup,hold] of [
    ['mid-doors','ct-spawn-boxes','openprefire:mid_to_b/24:standing'],
    ['long-a','long-a-boxes','openprefire:a_short/11'],
    ['short-a','short-a-boxes','openprefire:a_short/14'],
    ['long-doors','long-pit-floor','spraylab:dust2/pit-slope'],
    ['long-a','long-car-variations','spraylab:dust2/car-back-edge'],
    ['short-a','catwalk-close','openprefire:mid_to_b/14'],
    ['short-a','short-a-ninja-ramp','spraylab:dust2/a-ninja'],
    ['b-tunnels','b-tunnel-boxes','retakes:dust2/13'],
  ]) {
    await page.getByLabel('Prefire route').selectOption(route);
    await page.getByLabel('Practice lineup').selectOption(lineup);
    await page.waitForFunction(({route,hold})=>{
      const e=(window as any).siteCoverage;
      return e?.sim.route.id===route&&e.sim.selectedAngles.some((a:any)=>a.id===hold)&&e.sim.actors.length===6;
    },{route,hold});
    const positions=await page.evaluate(()=>{
      const e=(window as any).siteCoverage;
      return e.sim.selectedAngles.map((angle:any,index:number)=>{
        const actor=e.sim.actors[index+1],c=e.sim.map.collision;
        return {id:angle.id,dx:Math.abs(actor.position.x/.0254-angle.position[0]),dy:Math.abs(-actor.position.z/.0254-angle.position[1]),
          height:Math.abs(actor.feet/.0254-angle.position[2]),fits:c.fits(actor.position,actor.feet,(angle.crouched?54:72)*.0254),
          duck:actor.duckAmount,crouched:!!angle.crouched};
      });
    });
    for(const position of positions) {expect(position.dx).toBeLessThan(.001);expect(position.dy).toBeLessThan(.001);
      expect(position.height).toBeLessThanOrEqual(6);expect(position.fits).toBe(true);expect(position.duck).toBe(Number(position.crouched));}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.screenshot({path:info.outputPath('site-box-lineups.png'),fullPage:true});
  await page.reload();await showDrillPanel(page);
  await expect(page.getByLabel('Practice lineup')).toHaveValue('b-tunnel-boxes',{timeout:90000});
  await expect(page.getByLabel('Prefire route')).toHaveValue('b-tunnels');
  expect(errors).toEqual([]);
});

test('new Pit, car, Ninja and Short-facing A holds have hittable native animated heads',async({page},info)=>{
  test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await openPractice(page);
  const results:unknown[]=[];
  for(const [route,lineup,ids] of [
    ['long-doors','long-pit-floor',['pit-slope']],
    ['long-a','long-car-variations',['car-front-edge','car-back-edge','a-ramp-short-low','a-default-box-top']],
    ['short-a','short-a-ninja-ramp',['a-ninja','a-short-box-edge','a-ramp-short-high']],
  ] as const){
    await page.getByLabel('Prefire route').selectOption(route);
    await page.getByLabel('Practice lineup').selectOption(lineup);
    await page.waitForFunction(({route,ids})=>{
      const e=(window as any).siteCoverage;
      return e?.sim.route.id===route&&ids.every(id=>{
        const index=e.sim.selectedAngles.findIndex((a:any)=>a.id===`spraylab:dust2/${id}`);
        return index>=0&&e.hitboxes.get(index+1)?.pose.capsules.length===19;
      });
    },{route,ids});
    const rows=await page.evaluate(async(ids)=>{
      const e=(window as any).siteCoverage,auditPath='/src/range/prefire/spawn-audit.ts',bulletPath='/src/range/duel/penetration.ts';
      const {walkPrefireAuditPath}=await import(/* @vite-ignore */ auditPath);
      const {resolveBulletRay}=await import(/* @vite-ignore */ bulletPath);
      const sim=e.sim,collision=sim.map.collision,walked=walkPrefireAuditPath(collision,[sim.route.spawn,...sim.route.path]);
      return ids.map(id=>{
        const index=sim.selectedAngles.findIndex((a:any)=>a.id===`spraylab:dust2/${id}`),bot=sim.snapshot()[index+1];
        const pose=sim.actorHitPose(bot,sim.time),capsule=pose.capsules.find((c:any)=>c.group==='head');
        const head={x:(capsule.point0.x+capsule.point1.x)/2,y:(capsule.point0.y+capsule.point1.y)/2,z:(capsule.point0.z+capsule.point1.z)/2};
        const hit=walked.filter((_:any,i:number)=>i%4===0).some((point:any)=>{
          const origin={...point,y:point.y+64*.0254},d=Math.hypot(head.x-origin.x,head.y-origin.y,head.z-origin.z);
          const direction={x:(head.x-origin.x)/d,y:(head.y-origin.y)/d,z:(head.z-origin.z)/d};
          return resolveBulletRay({origin,direction,range:d+1,equipment:'ak47',maxPenetrations:0,arena:{solids:[],native:collision},
            actors:[{...bot,hitPose:pose}],shooterId:0,shooterSide:'player'}).hits.some((hit:any)=>hit.actorId===bot.id&&hit.group==='head');
        });
        return {id,hit,capsules:pose.capsules.length};
      });
    },ids);
    for(const row of rows)expect(row,`${route}/${row.id}`).toMatchObject({hit:true,capsules:19});
    results.push(...rows);
  }
  await info.attach('native-hold-head-shots',{body:JSON.stringify(results,null,2),contentType:'application/json'});
  expect(errors).toEqual([]);
});

test('CT standing headglitch has a hittable native head while the native torso remains covered',async({page},info)=>{
  test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await openPractice(page);await page.getByLabel('Prefire route').selectOption('mid-doors');
  await page.getByLabel('Practice lineup').selectOption('ct-spawn-boxes');
  await page.waitForFunction(()=>{
    const e=(window as any).siteCoverage,index=e?.sim.selectedAngles.findIndex((a:any)=>a.id==='openprefire:mid_to_b/24:standing');
    return index>=0&&e.hitboxes.get(index+1)?.pose.capsules.length===19;
  });
  const result=await page.evaluate(async()=>{
    const e=(window as any).siteCoverage;cancelAnimationFrame(e.frame);e.paused=true;e.sim.pause();e.sim.phase='fighting';
    const auditPath='/src/range/prefire/spawn-audit.ts',penetrationPath='/src/range/duel/penetration.ts';
    const {walkPrefireAuditPath,nativeSightBlocked}=await import(/* @vite-ignore */ auditPath);
    const {resolveBulletRay}=await import(/* @vite-ignore */ penetrationPath);
    const index=e.sim.selectedAngles.findIndex((a:any)=>a.id==='openprefire:mid_to_b/24:standing'),bot=e.sim.snapshot()[index+1];
    const pose=e.sim.actorHitPose(bot,e.sim.time),headCapsule=pose.capsules.find((c:any)=>c.group==='head');
    const center=(c:any)=>({x:(c.point0.x+c.point1.x)/2,y:(c.point0.y+c.point1.y)/2,z:(c.point0.z+c.point1.z)/2});
    const head=center(headCapsule),torso=pose.capsules.filter((c:any)=>['chest','stomach'].includes(c.group)&&!c.neck).flatMap((c:any)=>[c.point0,c.point1,center(c)]);
    const collision=e.sim.map.collision,views=walkPrefireAuditPath(collision,[e.sim.route.spawn,...e.sim.route.path]);
    const eye=views.filter((_:any,i:number)=>i%4===0).map((p:any)=>({...p,y:p.y+64*.0254}))
      .find((eye:any)=>!nativeSightBlocked(collision,eye,head)&&torso.every((p:any)=>nativeSightBlocked(collision,eye,p)));
    if(!eye)return {found:false,capsules:pose.capsules.length};
    const d=Math.hypot(head.x-eye.x,head.y-eye.y,head.z-eye.z),direction={x:(head.x-eye.x)/d,y:(head.y-eye.y)/d,z:(head.z-eye.z)/d};
    const shot=resolveBulletRay({origin:eye,direction,range:d+1,equipment:'ak47',maxPenetrations:0,
      arena:{solids:[],native:collision},actors:[{...bot,hitPose:pose}],shooterId:0,shooterSide:'player'});
    // A read-only exposure fixture on a native-walked point, not a movement score or live-game input.
    Object.assign(e.sim.actors[0],{position:{...eye},feet:eye.y-64*.0254,yaw:Math.atan2(-direction.x,-direction.z),
      pitch:Math.asin(direction.y),velocity:{x:0,z:0}});
    e.pacer.next=0;e.last=performance.now();e.tick(e.last+100);cancelAnimationFrame(e.frame);
    return {found:true,capsules:pose.capsules.length,duck:bot.duckAmount,head:shot.hits.some((hit:any)=>hit.actorId===bot.id&&hit.group==='head'),
      surfaceCount:shot.surfaces.length};
  });
  expect(result).toMatchObject({found:true,capsules:19,duck:0,head:true,surfaceCount:0});
  await page.addStyleTag({content:'.duel-entry{display:none!important}'});
  const image=await page.locator('canvas[data-duel]').screenshot({path:info.outputPath('ct-standing-headglitch.png')});
  expect((await sharp(image).stats()).channels[0].stdev).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
