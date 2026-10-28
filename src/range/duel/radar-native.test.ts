import {afterEach,describe,expect,it,vi} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import sharp from 'sharp';
import {BoxGeometry,BufferGeometry,Float32BufferAttribute,Group,Matrix4,Mesh,SkinnedMesh,Vector3} from 'three';
import {drawNativeRadarMap,DuelRadar,RadarMemory,radarPoint,type RadarSettings} from './radar';
import {testArena,type Arena} from './geometry';
import type {DuelActorSnapshot} from './types';
import catalog from './real-map-catalog.json';
import rounds from './real-map-round-data.json';
import type {RoundCatalog} from './real-map-rounds';

const settings:RadarSettings={radarEnabled:true,radarRotate:true,radarScale:.7};
const actor=(x=0,z=0,yaw=0):DuelActorSnapshot=>({id:0,generation:1,side:'player',
  position:{x,y:1.6256,z},feet:0,velocity:{x:0,z:0},yaw,pitch:0,crouched:false,duckAmount:0,
  health:100,armor:100,helmet:true,alive:true,equipment:'ak47',ammo:30,reloading:false});
function context() {
  return {save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),
    closePath:vi.fn(),fill:vi.fn(),stroke:vi.fn(),setTransform:vi.fn(),clearRect:vi.fn(),fillRect:vi.fn(),
    strokeRect:vi.fn(),translate:vi.fn(),rotate:vi.fn(),scale:vi.fn(),drawImage:vi.fn(),arc:vi.fn(),
    fillStyle:'',strokeStyle:'',globalAlpha:1,lineWidth:1};
}
function documentHarness() {
  const contexts:ReturnType<typeof context>[]=[],canvases:HTMLCanvasElement[]=[];
  vi.stubGlobal('document',{createElement:vi.fn(()=>{
    const ctx=context();contexts.push(ctx);
    const canvas={getContext:()=>ctx,setAttribute:vi.fn(),remove:vi.fn(),hidden:false,width:0,height:0};
    canvases.push(canvas as unknown as HTMLCanvasElement);return canvas;
  })});
  const host={append:vi.fn()} as unknown as HTMLElement;
  return {host,contexts,canvases};
}
function nativeArena():Arena {
  const query=()=>{throw new Error('Radar must never query native physics');};
  return {...testArena(),native:{fits:query,sweep:query,vertical:query,ray:query}};
}
function chunkScene(x=0,z=0) {
  const root=new Group();root.position.set(x,0,z);
  const floor=new Mesh(new BoxGeometry(16,.2,16));floor.position.y=-.1;root.add(floor);
  const wall=new Mesh(new BoxGeometry(1,3,10));wall.position.set(2,1.5,0);root.add(wall);
  const roof=new Mesh(new BoxGeometry(16,.2,16));roof.position.y=4;root.add(roof);
  return {root,floor,wall,roof};
}
afterEach(()=>vi.unstubAllGlobals());

describe('native radar geometry',()=>{
  it.each(catalog.chunks)('draws native walls and play bounds for $id, without procedural solids',chunk=>{
    const bounds={minX:chunk.sourceMin[0]*.0254,maxX:chunk.sourceMax[0]*.0254,
      minZ:-chunk.sourceMax[1]*.0254,maxZ:-chunk.sourceMin[1]*.0254};
    const x=(bounds.minX+bounds.maxX)/2,z=(bounds.minZ+bounds.maxZ)/2;
    const {root}=chunkScene(x,z),ctx=context(),span=Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ);
    drawNativeRadarMap(ctx as unknown as CanvasRenderingContext2D,root,bounds,0,512);
    expect(ctx.rect).toHaveBeenCalledOnce();
    expect(ctx.rect.mock.calls[0][2]).toBeCloseTo((bounds.maxX-bounds.minX)*512/span);
    expect(ctx.rect.mock.calls[0][3]).toBeCloseTo((bounds.maxZ-bounds.minZ)*512/span);
    expect(ctx.clip).toHaveBeenCalledOnce();expect(ctx.stroke).toHaveBeenCalledOnce();
    // Two floor triangles and eight wall-slice segments. The roof is omitted.
    expect(ctx.moveTo).toHaveBeenCalledTimes(10);
    const points=[...ctx.moveTo.mock.calls,...ctx.lineTo.mock.calls];
    expect(points.every(([px,pz])=>Number.isFinite(px)&&Number.isFinite(pz)&&px>=0&&px<=512&&pz>=0&&pz<=512)).toBe(true);
  });
  it('uses transformed native triangles rather than axis-aligned mesh bounds',()=>{
    const root=new Group();root.position.set(1000,5,-2000);root.rotation.y=Math.PI/2;
    const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute([0,0,0, 0,2,0, 4,0,0],3));
    root.add(new Mesh(geometry));
    const ctx=context(),bounds={minX:990,maxX:1010,minZ:-2010,maxZ:-1990};
    drawNativeRadarMap(ctx as unknown as CanvasRenderingContext2D,root,bounds,5,200);
    expect(ctx.moveTo).toHaveBeenCalledExactlyOnceWith(100,100);
    expect(ctx.lineTo).toHaveBeenCalledExactlyOnceWith(100,80);
  });
  it('clips padded context at chunk bounds and excludes animated actors',()=>{
    const {root}=chunkScene();
    root.add(new SkinnedMesh(new BoxGeometry(2,3,2)));
    const outside=new Mesh(new BoxGeometry(2,3,2));outside.position.set(80,1.5,80);root.add(outside);
    const ctx=context();drawNativeRadarMap(ctx as unknown as CanvasRenderingContext2D,root,testArena(),0,512);
    expect(ctx.moveTo).toHaveBeenCalledTimes(10);
    expect(ctx.rect).toHaveBeenCalledWith(0,0,384,512);
  });
  it('clips sloping floors through the elevation band instead of discarding entire ramp triangles',()=>{
    const root=new Group(),ctx=context();
    root.add(new Mesh(new BufferGeometry().setAttribute('position',
      new Float32BufferAttribute([-4,0,-4, -4,0,4, 4,2,4],3))));
    drawNativeRadarMap(ctx as unknown as CanvasRenderingContext2D,root,testArena(),0,320);
    expect(ctx.moveTo).toHaveBeenCalledOnce();expect(ctx.lineTo).toHaveBeenCalledTimes(3);
    expect(Math.max(...[...ctx.moveTo.mock.calls,...ctx.lineTo.mock.calls].map(([x])=>x))).toBeCloseTo(106);
  });
});

describe('radar drawing and settings',()=>{
  it('does no drawing or native-map preparation when disabled and restores when enabled',()=>{
    const {host,contexts,canvases}=documentHarness(),radar=new DuelRadar(host),arena=nativeArena(),{root}=chunkScene();
    const traverse=vi.spyOn(root,'traverse');
    radar.update(actor(),[],0,arena,{...settings,radarEnabled:false},root);
    expect(radar.canvas.hidden).toBe(true);expect(contexts[0].clearRect).not.toHaveBeenCalled();
    expect(traverse).not.toHaveBeenCalled();expect(canvases).toHaveLength(1);
    radar.update(actor(),[],0,arena,settings,root);
    expect(radar.canvas.hidden).toBe(false);expect(contexts[0].drawImage).toHaveBeenCalledOnce();
  });
  it('bakes once per native chunk/elevation and blits cached map while moving, rotating or zooming',()=>{
    const {host,contexts,canvases}=documentHarness(),radar=new DuelRadar(host),arena=nativeArena(),{root}=chunkScene();
    const traverse=vi.spyOn(root,'traverse');
    radar.update(actor(),[],0,arena,settings,root);
    radar.update(actor(5,-4,Math.PI/2),[],.1,{...arena}, {...settings,radarScale:1,radarRotate:false},root);
    expect(traverse).toHaveBeenCalledOnce();expect(canvases).toHaveLength(2);
    expect(contexts[0].drawImage.mock.calls[0][0]).toBe(contexts[0].drawImage.mock.calls[1][0]);
    expect(contexts[0].drawImage.mock.calls[0].slice(1)).toEqual([-12,-20,32,32]);
    radar.update({...actor(),feet:2},[],.2,arena,settings,root);
    radar.update(actor(),[],.3,arena,settings,root);
    expect(traverse).toHaveBeenCalledTimes(2);
    radar.update(actor(),[],.4,nativeArena(),settings,root);
    expect(traverse).toHaveBeenCalledTimes(3);
    radar.dispose();expect(radar.canvas.remove).toHaveBeenCalledOnce();
  });
  it('invalidates cached bounds and keeps procedural arenas and native maps separate',()=>{
    const {host,contexts}=documentHarness(),radar=new DuelRadar(host),arena=nativeArena(),{root}=chunkScene();
    const traverse=vi.spyOn(root,'traverse');
    radar.update(actor(),[],0,arena,settings,root);
    radar.update(actor(),[],1,{...arena,minX:-10},settings,root);
    expect(traverse).toHaveBeenCalledTimes(2);
    radar.update(actor(),[],2,testArena(),settings,root);
    expect(traverse).toHaveBeenCalledTimes(2);expect(contexts[0].drawImage).toHaveBeenCalledTimes(2);
    expect(contexts[0].strokeRect).toHaveBeenCalledWith(-12,-20,24,32);
  });
  it('uses a pre-baked overview directly at arbitrary coordinates without any round-time bake or lane markers',()=>{
    const {host,contexts,canvases}=documentHarness(),radar=new DuelRadar(host);
    const bounds={minX:4270,maxX:4330,minZ:-8380,maxZ:-8300},arena={...nativeArena(),...bounds};
    arena.lanes=Array.from({length:32},(_,i)=>({side:1,anchor:{x:4275+i,y:0,z:-8350},
      edge:{x:4276+i,y:0,z:-8350},retreat:{x:4275+i,y:0,z:-8352}}));
    const overview={image:{} as CanvasImageSource,bounds:{minX:4260,maxX:4340,minZ:-8390,maxZ:-8290}};
    for(const [x,z,yaw] of [[4271,-8378,Math.PI/2],[4328,-8301,-Math.PI/2]])
      radar.update(actor(x,z,yaw),[],1,{...arena},settings,overview);
    expect(canvases).toHaveLength(1);expect(contexts[0].drawImage).toHaveBeenCalledTimes(2);
    expect(contexts[0].drawImage).toHaveBeenLastCalledWith(overview.image,4260,-8390,80,100);
    expect(contexts[0].rect).toHaveBeenCalledWith(4270,-8380,60,80);
    expect(contexts[0].translate).toHaveBeenCalledWith(-4328,8301);
    expect(contexts[0].arc).not.toHaveBeenCalled();
  });
  it.each([0,Math.PI/2,Math.PI,-Math.PI/2])('points the fixed player arrow along the same yaw as map markers (%s)',yaw=>{
    const {host,contexts}=documentHarness(),radar=new DuelRadar(host);
    radar.update(actor(0,0,yaw),[],0,testArena(),{...settings,radarRotate:false});
    const rotation=contexts[0].rotate.mock.lastCall![0];
    expect(rotation).toBe(-yaw);
    const forward=radarPoint({x:-Math.sin(yaw),y:0,z:-Math.cos(yaw)},{x:0,y:0,z:0},yaw,false,1,testArena(),144);
    expect(Math.sin(rotation)).toBeCloseTo((forward.x-72)/(144/32));
    expect(-Math.cos(rotation)).toBeCloseTo((forward.y-72)/(144/32));
    radar.update(actor(0,0,yaw),[],0,testArena(),settings);
    expect(contexts[0].rotate).toHaveBeenLastCalledWith(0);
  });
  it('blits an atlas floor without sampling native physics or baking meshes',()=>{
    const {host,contexts,canvases}=documentHarness(),radar=new DuelRadar(host),arena=nativeArena();
    const image={} as CanvasImageSource,source={x:0,y:320,width:160,height:160};
    radar.update(actor(),[],0,arena,settings,{image,bounds:arena,source});
    expect(canvases).toHaveLength(1);
    expect(contexts[0].drawImage).toHaveBeenCalledExactlyOnceWith(image,0,320,160,160,-12,-20,24,32);
  });
  it('draws spotted last-known positions only and ignores expired or future contacts',()=>{
    const {host,contexts}=documentHarness(),radar=new DuelRadar(host),memory=new RadarMemory();
    radar.update(actor(),memory.snapshot(0),0,testArena(),settings);
    expect(contexts[0].arc).not.toHaveBeenCalled();
    memory.observeVisible(0,[{id:1,position:{x:0,y:1.6256,z:-8},aimPoint:{x:0,y:1.6256,z:-8}}]);
    radar.update(actor(),memory.snapshot(1),1,testArena(),settings);
    expect(contexts[0].arc).toHaveBeenLastCalledWith(72,46.8,3,0,Math.PI*2);
    radar.update(actor(),[{id:2,position:{x:7,y:0,z:2},seenAt:2,dead:false},
      {id:3,position:{x:9,y:0,z:3},seenAt:-4,dead:false}],1,testArena(),settings);
    expect(contexts[0].arc).toHaveBeenCalledOnce();
  });
  it.each([0,.63,Math.PI/2,-Math.PI/2])('preserves offscreen contact bearings instead of pinning both axes (%s)',yaw=>{
    const {host,contexts}=documentHarness(),radar=new DuelRadar(host),player=actor(-48,-63,yaw);
    const arena={...nativeArena(),minX:-63,maxX:-27,minZ:-84,maxZ:-22};
    // A long, oblique last-known direction exercises both-axis overflow.
    const position={x:player.position.x+180,y:player.position.y,z:player.position.z-90};
    radar.update(player,[{id:1,position,seenAt:0,dead:false}],0,arena,settings);
    const [x,y]=contexts[0].arc.mock.lastCall!,projected=radarPoint(position,player.position,yaw,true,.7,arena,144);
    expect((x-72)*(projected.y-72)).toBeCloseTo((y-72)*(projected.x-72),7);
    expect(Math.max(Math.abs(x-72),Math.abs(y-72))).toBeCloseTo(66);
  });
  it('keeps the elevated contact chevron inside the viewport at its top edge',()=>{
    const {host,contexts}=documentHarness(),radar=new DuelRadar(host),player=actor();
    radar.update(player,[{id:1,position:{x:0,y:5,z:-100},seenAt:0,dead:false}],0,nativeArena(),settings);
    const [x,y]=contexts[0].arc.mock.lastCall!;
    expect(x).toBe(72);expect(y-10).toBeGreaterThan(1);
    expect(contexts[0].lineTo).toHaveBeenCalledWith(x,y-10);
  });
});

// Unlike call-only mocks, track the complete canvas transform including the
// backing-store scale. This catches image/marker drift after native translation.
function trackTransform(ctx:ReturnType<typeof context>) {
  const matrix=new Matrix4(),stack:Matrix4[]=[],images:{matrix:Matrix4;args:number[]}[]=[],markers:Vector3[]=[];
  ctx.setTransform.mockImplementation((a,b,c,d,e,f)=>matrix.set(a,c,0,e,b,d,0,f,0,0,1,0,0,0,0,1));
  ctx.save.mockImplementation(()=>stack.push(matrix.clone()));
  ctx.restore.mockImplementation(()=>matrix.copy(stack.pop()!));
  ctx.translate.mockImplementation((x,y)=>matrix.multiply(new Matrix4().makeTranslation(x,y,0)));
  ctx.rotate.mockImplementation(angle=>matrix.multiply(new Matrix4().makeRotationZ(angle)));
  ctx.scale.mockImplementation((x,y)=>matrix.multiply(new Matrix4().makeScale(x,y,1)));
  ctx.drawImage.mockImplementation((_image,...args:number[])=>images.push({matrix:matrix.clone(),args}));
  ctx.arc.mockImplementation((x,y)=>markers.push(new Vector3(x,y,0).applyMatrix4(matrix)));
  return {images,markers};
}

describe.each(catalog.chunks)('$id delivered native overview',chunk=>{
  const base=`public/revamp/maps/dust2/duel/${chunk.id}/`;
  it.skipIf(!existsSync(base+'radar.json'))('aligns actual atlas layers and sourced holds with markers at every heading/zoom',async()=>{
    const metadata=JSON.parse(readFileSync(base+'radar.json','utf8')) as {
      collisionSha256:string;bounds:Arena;layers:{feet:number;x:number;y:number;width:number;height:number}[]};
    const baked=(rounds as unknown as RoundCatalog).chunks[chunk.id];
    expect(metadata.collisionSha256).toBe(baked.collisionSha256);
    expect(metadata.bounds).toEqual({minX:chunk.sourceMin[0]*.0254,maxX:chunk.sourceMax[0]*.0254,
      minZ:-chunk.sourceMax[1]*.0254,maxZ:-chunk.sourceMin[1]*.0254});
    const {data,info}=await sharp(base+'radar.png').ensureAlpha().raw().toBuffer({resolveWithObject:true});
    expect(info.width).toBe(160);expect(info.height).toBe(160*metadata.layers.length);
    const {host,contexts,canvases}=documentHarness(),radar=new DuelRadar(host),tracked=trackTransform(contexts[0]);
    const arena={...nativeArena(),...metadata.bounds},image={} as CanvasImageSource;
    for(const course of baked.courses) {
      const feet=course.starts[0].feet,hold=course.holds[0],position={...hold.source,y:feet.y+1.6256};
      expect(position.x).toBeCloseTo(hold.angle.position[0]*.0254,6);
      expect(position.z).toBeCloseTo(-hold.angle.position[1]*.0254,6);
      const source=metadata.layers.reduce((a,b)=>Math.abs(b.feet-feet.y)<Math.abs(a.feet-feet.y)?b:a);
      expect(source.y+source.height).toBeLessThanOrEqual(info.height);
      const b=metadata.bounds;
      const u=(feet.x-b.minX)/(b.maxX-b.minX),v=(feet.z-b.minZ)/(b.maxZ-b.minZ);
      // The real start must have walkable pixels nearby on its selected floor.
      const sx=Math.floor(u*source.width),sy=Math.floor(v*source.height);
      const nearby=[];
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++) {
        const x=sx+dx,y=sy+dz;
        if(x<0||y<0||x>=source.width||y>=source.height)continue;
        const at=((source.y+y)*info.width+source.x+x)*4;
        nearby.push([...data.subarray(at,at+3)]);
      }
      expect(nearby).toContainEqual([83,109,99]);
      for(const yaw of [0,.63,Math.PI/2,Math.PI,-Math.PI/2])for(const rotate of [true,false])for(const scale of [.25,.7,1]) {
        const player={...actor(feet.x,feet.z,yaw),feet:feet.y,position:{...feet,y:feet.y+1.6256}};
        radar.update(player,[{id:1,position,seenAt:0,dead:false}],0,arena,
          {...settings,radarRotate:rotate,radarScale:scale},{image,bounds:b,source});
        const draw=tracked.images[tracked.images.length-1];
        expect(draw.args.slice(0,4)).toEqual([source.x,source.y,source.width,source.height]);
        const [,,sw,sh,dx,dy,dw,dh]=draw.args;
        const atlasPoint=(x:number,z:number)=>new Vector3(dx+x/sw*dw,dy+z/sh*dh,0).applyMatrix4(draw.matrix);
        const expected=radarPoint(position,player.position,yaw,rotate,scale,arena,144);
        const painted=atlasPoint((position.x-b.minX)/(b.maxX-b.minX)*source.width,
          (position.z-b.minZ)/(b.maxZ-b.minZ)*source.height);
        expect(painted.x/2).toBeCloseTo(expected.x,7);expect(painted.y/2).toBeCloseTo(expected.y,7);
        // With player centering, the atlas start texel stays at the marker origin.
        const start=atlasPoint(u*source.width,v*source.height);
        expect(start.x/2).toBeCloseTo(72,7);expect(start.y/2).toBeCloseTo(72,7);
        const marker=tracked.markers[tracked.markers.length-1];
        if(Math.max(Math.abs(expected.x-72),Math.abs(expected.y-72))<=66) {
          expect(marker.x).toBeCloseTo(painted.x,7);expect(marker.y).toBeCloseTo(painted.y,7);
        } else {
          expect((marker.x-144)*(painted.y-144)).toBeCloseTo((marker.y-144)*(painted.x-144),7);
        }
      }
    }
    expect(canvases).toHaveLength(1);
  });
});
