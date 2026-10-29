import {describe, expect, it} from 'vitest';
import {RadarMemory, RADAR_MEMORY_SECONDS, radarPoint} from './radar';
import {testArena} from './geometry';
import type {DuelActorSnapshot} from './types';
import {radarBearing, radarContactStyle, radarHeading, radarSpan, RADAR_SIZE} from './radar-projection';
import {sourceRadarOverview} from './radar-overview';

const actor=(id:number,x:number,z:number):DuelActorSnapshot=>({id,generation:1,side:id===0?'player':'enemy',
  position:{x,y:1.6256,z},feet:0,velocity:{x:0,z:0},yaw:0,pitch:0,crouched:false,duckAmount:0,
  health:100,armor:100,helmet:true,alive:true,equipment:'ak47',ammo:30,reloading:false});

describe('radar spotting',()=>{
  it('stores visual contacts and freezes their last position when hidden',()=>{
    const radar=new RadarMemory(),arena=testArena(),player=actor(0,0,5),enemy=actor(1,0,-5);
    radar.observe(0,player,[enemy],arena,16/9);
    expect(radar.snapshot(0)[0].position.z).toBe(-5);
    const wall={center:{x:0,y:1,z:0},size:{x:10,y:2,z:1}};arena.solids.push(wall);
    radar.observe(1,player,[{...enemy,position:{x:3,y:1.6256,z:-8}}],arena,16/9);
    expect(radar.snapshot(1)[0].position.z).toBe(-5);
    expect(radar.snapshot(5)).toEqual([]);
  });
  it('does not show enemies behind the player or beyond opaque cover',()=>{
    const radar=new RadarMemory(),arena=testArena();
    radar.observe(0,actor(0,0,0),[actor(1,0,5)],arena,16/9);
    expect(radar.snapshot(0)).toEqual([]);
  });
  it('clears contacts between rounds and marks confirmed deaths briefly',()=>{
    const radar=new RadarMemory(),arena=testArena();
    radar.observe(0,actor(0,0,5),[actor(1,0,-5)],arena,16/9);
    radar.confirmDeath(1,.1);expect(radar.snapshot(.1)[0].dead).toBe(true);
    radar.reset();expect(radar.snapshot(.1)).toEqual([]);
  });
  it('projects forward to the top at every orientation',()=>{
    const arena=testArena(),player={x:0,y:0,z:0};
    for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
      const point=radarPoint({x:-Math.sin(yaw)*5,y:0,z:-Math.cos(yaw)*5},player,yaw,true,.7,arena,144);
      expect(point.x).toBeCloseTo(72);expect(point.y).toBeLessThan(72);
    }
  });
  it('keeps large translated native coordinates aligned at every rotation and zoom',()=>{
    const origin={x:4281.25,y:9,z:-8371.75},base={x:0,y:0,z:0};
    const arena=testArena(),translated={...arena,minX:arena.minX+origin.x,maxX:arena.maxX+origin.x,
      minZ:arena.minZ+origin.z,maxZ:arena.maxZ+origin.z};
    for(const yaw of [0,.4,Math.PI/2,Math.PI,-Math.PI/2])for(const rotate of [true,false])for(const scale of [.25,.7,1]) {
      const local={x:7,y:0,z:-5};
      const expected=radarPoint(local,base,yaw,rotate,scale,arena,144);
      const actual=radarPoint({x:origin.x+local.x,y:origin.y,z:origin.z+local.z},origin,yaw,rotate,scale,translated,144);
      expect(actual.x).toBeCloseTo(expected.x,8);expect(actual.y).toBeCloseTo(expected.y,8);
      expect(radarPoint(origin,origin,yaw,rotate,scale,translated,144)).toEqual({x:72,y:72});
    }
  });
  it('keeps the right side right and fixed north stable while zoom changes distance',()=>{
    const arena=testArena(),player={x:0,y:0,z:0};
    for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
      const right=radarPoint({x:Math.cos(yaw)*5,y:0,z:-Math.sin(yaw)*5},player,yaw,true,1,arena,144);
      expect(right.x).toBeGreaterThan(72);expect(right.y).toBeCloseTo(72);
      expect(radarPoint({x:3,y:0,z:-5},player,yaw,false,.7,arena,144))
        .toEqual(radarPoint({x:3,y:0,z:-5},player,0,false,.7,arena,144));
    }
    const point={x:8,y:0,z:0};
    const near=radarPoint(point,player,0,false,1,arena,144),far=radarPoint(point,player,0,false,.25,arena,144);
    expect(near.x-72).toBeCloseTo((far.x-72)*4);
    expect(radarPoint(point,player,0,false,NaN,arena,144)).toEqual(radarPoint(point,player,0,false,.7,arena,144));
  });
  it('copies only supplied spotted contacts without tracking later actor or snapshot mutations',()=>{
    const radar=new RadarMemory(),position={x:-43,y:8,z:-62};
    radar.observeVisible(2,[{id:3,position,aimPoint:{...position}}]);
    position.x=100;
    const snapshot=radar.snapshot(3);expect(snapshot[0].position.x).toBe(-43);
    snapshot[0].position.z=200;
    radar.observeVisible(4,[]);
    expect(radar.snapshot(4)).toEqual([{id:3,position:{x:-43,y:8,z:-62},seenAt:2,dead:false}]);
    radar.confirmDeath(99,4);expect(radar.snapshot(4)).toHaveLength(1);
    expect(radar.snapshot(1)).toEqual([]);
    expect(radar.snapshot(2+RADAR_MEMORY_SECONDS)).toEqual([]);
  });
  it('respects native occlusion with no authored solids and never updates an unspotted position',()=>{
    const radar=new RadarMemory(),arena=testArena(),player=actor(0,1200,-2000),enemy=actor(1,1200,-2010);
    let blocked=true;
    const unused=()=>{throw new Error('Spotting must not issue movement queries');};
    arena.native={fits:unused,sweep:unused,vertical:unused,
      ray:()=>blocked?{distance:1,surfaceId:0,normal:{x:0,y:0,z:1}}:undefined};
    radar.observe(0,player,[enemy],arena,16/9);expect(radar.snapshot(0)).toEqual([]);
    blocked=false;radar.observe(1,player,[enemy],arena,16/9);
    expect(radar.snapshot(1)[0].position).toEqual(enemy.position);
    blocked=true;radar.observe(2,player,[{...enemy,position:{...enemy.position,x:1203,z:-2015}}],arena,16/9);
    expect(radar.snapshot(2)[0].position).toEqual(enemy.position);
    expect(radar.snapshot(6)).toEqual([]);
  });
  it('does not extend a death marker or revive an already expired sighting',()=>{
    const radar=new RadarMemory(),position={x:0,y:1,z:-4};
    radar.observeVisible(0,[{id:1,position,aimPoint:position}]);
    radar.confirmDeath(1,1);radar.confirmDeath(1,2);
    expect(radar.snapshot(3)).toEqual([]);
    radar.observeVisible(4,[{id:2,position,aimPoint:position}]);
    radar.confirmDeath(2,10);expect(radar.snapshot(10)).toEqual([]);
  });
});

describe('radar presentation projection',()=>{
  it('uses the same local metre scale for every chunk size, including rectangular chunks',()=>{
    const player={x:-42,y:3,z:70},point={x:-32,y:3,z:60};
    const small={minX:-45,maxX:-30,minZ:50,maxZ:80},large={minX:-500,maxX:500,minZ:-2000,maxZ:2000};
    for(const scale of [.25,.7,1])for(const yaw of [0,.7,Math.PI/2,-Math.PI]) {
      expect(radarPoint(point,player,yaw,true,scale,small,RADAR_SIZE))
        .toEqual(radarPoint(point,player,yaw,true,scale,large,RADAR_SIZE));
    }
    expect(radarSpan(.7)).toBeCloseTo(48);
    expect(radarSpan(.25)).toBeCloseTo(134.4);
    expect(radarSpan(1)).toBeCloseTo(33.6);
    expect(radarSpan(-1)).toBe(radarSpan(.25));expect(radarSpan(8)).toBe(radarSpan(1));
  });
  it.each([0,.5,Math.PI/2,Math.PI,-Math.PI/2])('aligns cone, player arrow, forward and right at heading %s',yaw=>{
    const player={x:0,y:0,z:0};
    for(const rotate of [true,false]) {
      const rotation=radarHeading(yaw,rotate);
      const point=radarPoint({x:-Math.sin(yaw)*8,y:0,z:-Math.cos(yaw)*8},player,yaw,rotate,.7,testArena(),RADAR_SIZE);
      expect(point.x-108).toBeCloseTo(Math.sin(rotation)*36);
      expect(point.y-108).toBeCloseTo(-Math.cos(rotation)*36);
    }
  });
  it.each([0,.3,Math.PI/4,Math.PI/2,Math.PI,3.8,5.6])('intersects the circular rim without changing bearing (%s)',angle=>{
    const point={x:108+900*Math.cos(angle),y:108+900*Math.sin(angle)};
    const edge=radarBearing(point,RADAR_SIZE);
    expect(edge.offscreen).toBe(true);expect(Math.hypot(edge.x-108,edge.y-108)).toBeCloseTo(94);
    expect((edge.x-108)*(point.y-108)).toBeCloseTo((edge.y-108)*(point.x-108));
    expect(radarBearing({x:108,y:108},RADAR_SIZE)).toMatchObject({x:108,y:108,offscreen:false});
  });
  it('distinguishes remembered contacts, both height directions, expiry and invalid time',()=>{
    expect(radarContactStyle(2,2,false,2)).toMatchObject({fresh:true,height:1,alpha:1});
    expect(radarContactStyle(2,4,false,-2)).toMatchObject({fresh:false,height:-1});
    expect(radarContactStyle(2,4,false,.9)?.height).toBe(0);
    expect(radarContactStyle(2,4,true,3)?.height).toBe(0);
    for(const time of [1,7,NaN,Infinity]) expect(radarContactStyle(2,time,false,0)).toBeUndefined();
    expect(radarContactStyle(2,4,false,NaN)).toBeUndefined();
  });
  it('converts installed-style Source overview coordinates without scene traversal or fetching',()=>{
    const image={} as CanvasImageSource;
    // Static resource/overviews/de_dust2.txt from installed build 2000938.
    const overview=sourceRadarOverview(image,{pos_x:-2476,pos_y:3239,scale:4.4});
    expect(overview.image).toBe(image);
    expect(overview.bounds.minX).toBeCloseTo(-62.8904);
    expect(overview.bounds.minZ).toBeCloseTo(-82.2706);
    expect(overview.bounds.maxX-overview.bounds.minX).toBeCloseTo(114.44224);
    expect(overview.bounds.maxZ-overview.bounds.minZ).toBeCloseTo(114.44224);
    expect(()=>sourceRadarOverview(image,{pos_x:NaN,pos_y:0,scale:1})).toThrow();
    expect(()=>sourceRadarOverview(image,{pos_x:0,pos_y:0,scale:0})).toThrow();
  });
});
