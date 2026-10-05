import {describe, expect, it} from 'vitest';
import {RadarMemory, radarPoint} from './radar';
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
});
