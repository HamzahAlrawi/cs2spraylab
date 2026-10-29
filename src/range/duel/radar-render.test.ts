import {afterEach, describe, expect, it, vi} from 'vitest';
import {Group, Matrix4, Vector3} from 'three';
import {DuelRadar, radarPoint, type RadarSettings} from './radar';
import {RADAR_SIZE} from './radar-projection';
import {testArena} from './geometry';
import type {DuelActorSnapshot} from './types';

const settings: RadarSettings = {radarEnabled:true, radarRotate:true, radarScale:.7};
const player: DuelActorSnapshot = {id:0,generation:1,side:'player',position:{x:4281,y:4.6256,z:-8371},
  feet:3,velocity:{x:0,z:0},yaw:0,pitch:0,crouched:false,duckAmount:0,health:100,armor:100,helmet:true,
  alive:true,equipment:'ak47',ammo:30,reloading:false};
function harness() {
  const matrix=new Matrix4(),stack:Matrix4[]=[];
  const images:{matrix:Matrix4;args:number[]}[]=[],markers:Vector3[]=[];
  const ctx={save:vi.fn(()=>stack.push(matrix.clone())),restore:vi.fn(()=>matrix.copy(stack.pop()!)),
    beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),
    fill:vi.fn(),stroke:vi.fn(),clearRect:vi.fn(),fillRect:vi.fn(),strokeRect:vi.fn(),
    setTransform:vi.fn((a,b,c,d,e,f)=>matrix.set(a,c,0,e,b,d,0,f,0,0,1,0,0,0,0,1)),
    translate:vi.fn((x,y)=>matrix.multiply(new Matrix4().makeTranslation(x,y,0))),
    rotate:vi.fn(angle=>matrix.multiply(new Matrix4().makeRotationZ(angle))),
    scale:vi.fn((x,y)=>matrix.multiply(new Matrix4().makeScale(x,y,1))),
    drawImage:vi.fn((_image,...args:number[])=>images.push({matrix:matrix.clone(),args})),
    arc:vi.fn((x,y,r)=>{if(r===4.5)markers.push(new Vector3(x,y,0).applyMatrix4(matrix));})};
  const canvases:HTMLCanvasElement[]=[];
  vi.stubGlobal('document',{createElement:()=>{
    const canvas={getContext:()=>ctx,setAttribute:vi.fn(),remove:vi.fn(),hidden:false,width:0,height:0};
    canvases.push(canvas as unknown as HTMLCanvasElement);return canvas;
  }});
  const radar=new DuelRadar({append:vi.fn()} as unknown as HTMLElement);
  const query=()=>{throw new Error('Radar cannot access physics or hidden poses');};
  const arena={...testArena(),minX:4270,maxX:4330,minZ:-8380,maxZ:-8300,
    native:{fits:query,sweep:query,vertical:query,ray:query},get lanes(){return query();}};
  return {radar,ctx,images,markers,canvases,arena};
}
afterEach(()=>vi.unstubAllGlobals());

describe('circular radar renderer',()=>{
  it('keeps atlas texels and visible contacts aligned at arbitrary origins, headings and zooms',()=>{
    const {radar,images,markers,arena,canvases}=harness();
    const bounds={minX:4260,maxX:4340,minZ:-8390,maxZ:-8290};
    const source={x:128,y:384,width:256,height:320},image={} as CanvasImageSource;
    const position={x:player.position.x+4,y:player.position.y,z:player.position.z-3};
    for(const yaw of [0,.63,Math.PI/2,Math.PI,-Math.PI/2])for(const rotate of [true,false])for(const scale of [.25,.7,1]) {
      radar.update({...player,yaw},[{id:1,position,seenAt:0,dead:false}],0,arena,
        {...settings,radarRotate:rotate,radarScale:scale},{image,bounds,source});
      const draw=images[images.length-1],expected=radarPoint(position,player.position,yaw,rotate,scale,arena,RADAR_SIZE);
      expect(draw.args.slice(0,4)).toEqual([128,384,256,320]);
      const [,,,,x,z,width,height]=draw.args;
      const painted=new Vector3(x+(position.x-bounds.minX)/(bounds.maxX-bounds.minX)*width,
        z+(position.z-bounds.minZ)/(bounds.maxZ-bounds.minZ)*height,0).applyMatrix4(draw.matrix);
      expect(painted.x/2).toBeCloseTo(expected.x,7);expect(painted.y/2).toBeCloseTo(expected.y,7);
      expect(markers[markers.length-1].x).toBeCloseTo(painted.x,7);
      expect(markers[markers.length-1].y).toBeCloseTo(painted.y,7);
    }
    expect(canvases).toHaveLength(1);
  });
  it('clips a circle, retains full overview context and does no work while disabled',()=>{
    const {radar,ctx,arena}=harness(),root=new Group(),traverse=vi.spyOn(root,'traverse');
    radar.update(player,[],0,arena,{...settings,radarEnabled:false},root);
    expect(ctx.clearRect).not.toHaveBeenCalled();expect(traverse).not.toHaveBeenCalled();
    radar.update(player,[],0,arena,settings,{image:{} as CanvasImageSource,bounds:arena});
    expect(ctx.arc).toHaveBeenCalledWith(108,108,104,0,Math.PI*2);
    expect(ctx.rect).not.toHaveBeenCalled();expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledOnce();expect(traverse).not.toHaveBeenCalled();
    expect(radar.canvas.width).toBe(432);radar.dispose();expect(radar.canvas.remove).toHaveBeenCalledOnce();
  });
  it('rejects invalid/expired contacts and paints upper and lower height cues inside the rim',()=>{
    const {radar,ctx,arena,markers}=harness();
    const contacts=[{id:1,position:{x:4281,y:8,z:-8500},seenAt:0,dead:false},
      {id:2,position:{x:4281,y:0,z:-8240},seenAt:0,dead:false},
      {id:3,position:{x:NaN,y:5,z:0},seenAt:0,dead:false},
      {id:4,position:player.position,seenAt:6,dead:false},
      {id:5,position:player.position,seenAt:-5,dead:false}];
    radar.update(player,contacts,0,arena,settings,{image:{} as CanvasImageSource,bounds:arena});
    expect(markers).toHaveLength(0); // Both valid contacts use offscreen arrows.
    expect(ctx.lineTo.mock.calls.some(([x,y])=>x===108&&Math.abs(y-8)<1e-8)).toBe(true);
    expect(ctx.lineTo).toHaveBeenCalledWith(108,208);
  });
});
