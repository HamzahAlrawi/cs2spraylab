import {describe,expect,it,vi} from 'vitest';
import {sweepGrenadeHull} from './grenade-contact';
import {testArena} from './geometry';

describe('grenade-centred hull contact',()=>{
  it('catches an off-centre box corner that all seven axis probes miss',()=>{
    const arena=testArena();
    arena.solids.push({center:{x:.08,y:.08,z:-1},size:{x:.02,y:.02,z:.2}});
    const hit=sweepGrenadeHull({x:0,y:0,z:0},{x:0,y:0,z:-2},.1,arena);
    expect(hit.fraction).toBeCloseTo(.4);expect(hit.contact?.normal).toEqual({x:0,y:0,z:1});
    expect(hit.startSolid).toBe(false);
  });
  it('does not use the player hull or collide while sliding tangentially',()=>{
    const arena=testArena();arena.solids.push({center:{x:1,y:1,z:0},size:{x:1,y:2,z:10}});
    expect(sweepGrenadeHull({x:.4,y:1,z:2},{x:.4,y:1,z:-2},.1,arena).contact).toBeUndefined();
    expect(sweepGrenadeHull({x:0,y:1,z:2},{x:0,y:1,z:-2},.1,arena).fraction).toBe(1);
  });
  it('clips to the ramp plane rather than the empty top half of its bounds',()=>{
    const arena=testArena();arena.solids.push({center:{x:0,y:1,z:0},size:{x:4,y:2,z:4},
      shape:{kind:'ramp',axis:'x',highSide:1}});
    const hit=sweepGrenadeHull({x:-1,y:3,z:0},{x:-1,y:0,z:0},.1,arena);
    expect(hit.position.y).toBeCloseTo(.65);expect(hit.contact?.normal.y).toBeCloseTo(1/Math.sqrt(1.25));
  });
  it('keeps native grenade masks authoritative without falling back to a player sphere',()=>{
    const arena=testArena(),sweepGrenade=vi.fn((from:{x:number;y:number;z:number},to:typeof from)=>
      ({position:to,fraction:1,startSolid:false})),sweepSphere=vi.fn();
    Object.assign(arena,{native:{sweepGrenade,sweepSphere}});
    const to={x:1,y:2,z:3};expect(sweepGrenadeHull({x:0,y:0,z:0},to,.05,arena).position).toEqual(to);
    expect(sweepGrenade).toHaveBeenCalledTimes(1);expect(sweepSphere).not.toHaveBeenCalled();
  });
  it('reports overlap and ignores inactive/open leaves',()=>{
    const arena=testArena();arena.solids.push({center:{x:0,y:1,z:0},size:{x:1,y:2,z:1}});
    expect(sweepGrenadeHull({x:0,y:1,z:0},{x:1,y:1,z:0},.05,arena).startSolid).toBe(true);
    arena.solids[0].active=false;
    expect(sweepGrenadeHull({x:0,y:1,z:0},{x:1,y:1,z:0},.05,arena).fraction).toBe(1);
  });
});
