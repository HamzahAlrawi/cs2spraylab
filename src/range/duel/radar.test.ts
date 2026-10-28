import {describe, expect, it} from 'vitest';
import {RadarMemory, RADAR_MEMORY_SECONDS, radarPoint} from './radar';
import {testArena} from './geometry';
import type {DuelActorSnapshot} from './types';

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
});
