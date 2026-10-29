import {expect, test} from '@playwright/test';
import {existsSync, readFileSync} from 'node:fs';

test.beforeEach(async ({page})=>{
  await page.route('**/__radar-fixture',route=>route.fulfill({contentType:'text/html',body:
    '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#80878b"><div class="duel-view" style="width:100vw;height:100vh"><div class="duel-canvas"></div></div></body></html>'}));
  await page.goto('/__radar-fixture');
  await page.addStyleTag({url:'/src/range/duel/duel.css'});
  await page.evaluate(async ()=>{
    const moduleUrl='/src/range/duel/radar.ts';
    const {DuelRadar,radarPoint}=await import(/* @vite-ignore */ moduleUrl);
    const projectionUrl='/src/range/duel/radar-projection.ts';
    const {RADAR_SIZE,radarBearing}=await import(/* @vite-ignore */ projectionUrl);
    const radar=new DuelRadar(document.querySelector('.duel-canvas'));
    const player={id:0,position:{x:4281,y:4.6256,z:-8371},feet:3,yaw:0};
    const query=()=>{throw Error('Unexpected radar physics/hidden actor query');};
    const arena={minX:4270,maxX:4330,minZ:-8380,maxZ:-8300,solids:[],
      native:{fits:query,sweep:query,vertical:query,ray:query},get lanes(){return query();}};
    const image=document.createElement('canvas');image.width=256;image.height=320;
    const ctx=image.getContext('2d')!;ctx.fillStyle='#304b61';ctx.fillRect(0,0,256,320);
    const bounds={minX:4260,maxX:4340,minZ:-8390,maxZ:-8290};
    const position={x:4289,y:4.6256,z:-8377};
    const px=(position.x-bounds.minX)/80*256,pz=(position.z-bounds.minZ)/100*320;
    ctx.fillStyle='#f8dd38';ctx.fillRect(px-4,pz-4,8,8);
    const settings={radarEnabled:true,radarRotate:true,radarScale:.7};
    const fixture={radar,radarPoint,radarBearing,size:RADAR_SIZE,player,arena,settings,position,overview:{image,bounds}};
    (window as any).radarFixture=fixture;
    radar.update(player,[],0,arena,settings,fixture.overview);
  });
});

test('radar is legible and circular on desktop/mobile with aligned map, heading and contacts',async ({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const bounds=await page.locator('.duel-radar').boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(136);expect(bounds!.width).toBeCloseTo(bounds!.height);
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const result=await page.evaluate(()=>{
    const f=(window as any).radarFixture,ctx=f.radar.canvas.getContext('2d');
    const pixel=(x:number,y:number)=>[...ctx.getImageData(Math.round(x*2),Math.round(y*2),1,1).data];
    const corners=[pixel(0,0),pixel(f.size-1,0),pixel(0,f.size-1),pixel(f.size-1,f.size-1)];
    const rows:{map:number[];contact:number[];self:number[]}[]=[];
    for(const yaw of [0,.63,Math.PI/2,Math.PI,-Math.PI/2])for(const rotate of [true,false])for(const scale of [.25,.7,1]) {
      const player={...f.player,yaw},settings={...f.settings,radarRotate:rotate,radarScale:scale};
      const p=f.radarPoint(f.position,player.position,yaw,rotate,scale,f.arena,f.size);
      f.radar.update(player,[],0,f.arena,settings,f.overview);
      const map=pixel(p.x,p.y);
      f.radar.update(player,[{id:1,position:f.position,seenAt:0,dead:false}],0,f.arena,settings,f.overview);
      rows.push({map,contact:pixel(p.x,p.y),self:pixel(f.size/2,f.size/2)});
    }
    return {corners,rows};
  });
  expect(result.corners.every(pixel=>pixel[3]===0)).toBe(true);
  for(const row of result.rows) {
    expect(row.map[0]).toBeGreaterThan(row.map[2]);
    expect(row.contact[0]).toBeGreaterThan(220);expect(row.contact[1]).toBeLessThan(140);
    expect(row.self[0]).toBeGreaterThan(200);expect(row.self[1]).toBeGreaterThan(200);
  }
  await page.screenshot({path:info.outputPath('radar-responsive.png')});
  expect(errors).toEqual([]);
});

test('offscreen bearing, last-known memory and expiry remain presentation-only',async ({page})=>{
  const result=await page.evaluate(()=>{
    const f=(window as any).radarFixture,ctx=f.radar.canvas.getContext('2d');
    const position={x:f.player.position.x+180,y:f.player.position.y,z:f.player.position.z-90};
    const contacts=[{id:1,position,seenAt:0,dead:false}];
    const p=f.radarPoint(position,f.player.position,.63,true,.7,f.arena,f.size);
    const edge=f.radarBearing(p,f.size);
    const frame=(now:number)=>{
      f.radar.update({...f.player,yaw:.63},contacts,now,f.arena,f.settings,f.overview);
      const pixels=ctx.getImageData(Math.floor((edge.x-7)*2),Math.floor((edge.y-7)*2),28,28).data;
      let red=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>140&&pixels[i]>pixels[i+1]*1.1&&pixels[i]>pixels[i+2]*1.15)red++;
      return red;
    };
    return {fresh:frame(0),remembered:frame(1),expired:frame(5),future:frame(-1),distance:Math.hypot(edge.x-108,edge.y-108)};
  });
  expect(result.fresh).toBeGreaterThan(20);expect(result.remembered).toBeGreaterThan(10);
  expect(result.expired).toBe(0);expect(result.future).toBe(0);expect(result.distance).toBeCloseTo(94);
});

test('delivered native atlas retains floor detail without extra per-update requests',async ({page},info)=>{
  const base='public/revamp/maps/dust2/duel/dust2-long-doors/';
  test.skip(!existsSync(base+'radar.json'),'Optional installed map assets');
  const metadata=JSON.parse(readFileSync(base+'radar.json','utf8'));
  const source=metadata.layers.reduce((a:any,b:any)=>Math.abs(b.feet)<Math.abs(a.feet)?b:a);
  let requests=0;page.on('request',request=>{if(request.url().includes('radar.png'))requests++;});
  const result=await page.evaluate(async ({bounds,source})=>{
    const f=(window as any).radarFixture,image=new Image();image.src='/maps/dust2/duel/dust2-long-doors/radar.png';await image.decode();
    const player={...f.player,position:{x:5.334,y:1.67492,z:7.5438},feet:.04932};
    const arena=Object.assign(Object.create(f.arena),bounds);
    for(let i=0;i<30;i++)f.radar.update({...player,yaw:i/20},[],i/10,arena,f.settings,{image,bounds,source});
    const pixels=f.radar.canvas.getContext('2d').getImageData(0,0,432,432).data;
    const colors=new Set<number>();let bright=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>200) {
      colors.add((pixels[i]>>4)*256+(pixels[i+1]>>4)*16+(pixels[i+2]>>4));
      if(pixels[i]>110&&pixels[i+1]>110&&pixels[i+2]>110)bright++;
    }
    return {colors:colors.size,bright};
  },{bounds:metadata.bounds,source});
  expect(requests).toBe(1);expect(result.colors).toBeGreaterThan(20);expect(result.bright).toBeGreaterThan(300);
  await page.screenshot({path:info.outputPath('radar-delivered-atlas.png')});
});

test('installed Valve overview adapter preserves native detail with no loader changes',async ({page},info)=>{
  test.skip(!existsSync('research/radar-native-overview.png'),'Optional offline-extracted Valve reference');
  await page.evaluate(async ()=>{
    const url='/src/range/duel/radar-overview.ts';
    const {sourceRadarOverview}=await import(/* @vite-ignore */ url);
    const image=new Image();image.src='/research/radar-native-overview.png';await image.decode();
    const f=(window as any).radarFixture,overview=sourceRadarOverview(image,{pos_x:-2476,pos_y:3239,scale:4.4});
    const player={...f.player,position:{x:17.78,y:1.6153,z:-23.114},feet:-.0103,yaw:0};
    f.radar.update(player,[],0,Object.assign(Object.create(f.arena),overview.bounds),f.settings,overview);
  });
  const colors=await page.locator('.duel-radar').evaluate((canvas:HTMLCanvasElement)=>{
    const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
    const colors=new Set<number>();for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>200)
      colors.add((pixels[i]>>4)*256+(pixels[i+1]>>4)*16+(pixels[i+2]>>4));
    return colors.size;
  });
  expect(colors).toBeGreaterThan(50);
  await page.screenshot({path:info.outputPath('radar-valve-overview-reference.png')});
});

test('radar fits the live training viewport below the status line',async ({page},info)=>{
  test.skip(!['chromium','mobile-chromium'].includes(info.project.name),'Live desktop/mobile layout smoke test');
  await page.goto('/');
  const radar=page.locator('.duel-radar');await expect(radar).toBeVisible();
  const [box,view,topline]=await Promise.all([radar.boundingBox(),page.locator('.duel-view').boundingBox(),page.locator('.duel-topline').boundingBox()]);
  expect(box!.width).toBeGreaterThanOrEqual(136);
  expect(box!.x).toBeGreaterThanOrEqual(view!.x);
  expect(box!.x+box!.width).toBeLessThanOrEqual(view!.x+view!.width);
  expect(box!.y+box!.height).toBeLessThanOrEqual(view!.y+view!.height);
  expect(box!.y).toBeGreaterThanOrEqual(topline!.y+topline!.height);
  await page.locator('.duel-view').screenshot({path:info.outputPath('radar-live-layout.png')});
});
