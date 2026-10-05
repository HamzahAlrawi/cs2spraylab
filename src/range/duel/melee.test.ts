import {describe,expect,it} from 'vitest';
import {traceMelee} from './melee';
import {UNIT} from '../actor-physics';

describe('knife swept contact',()=>{
  const actor={position:{x:0,y:64*UNIT,z:-1},feet:0,duckAmount:0};
  it('allows an edge contact missed by the narrow bullet ray',()=>{
    expect(traceMelee({x:.48,y:64*UNIT,z:0},{x:0,y:0,z:-1},actor,48*UNIT).group).toBe('chest');
  });
  it('does not extend the sweep beyond its range or hit behind the ray',()=>{
    expect(traceMelee({x:0,y:64*UNIT,z:4},{x:0,y:0,z:-1},actor,48*UNIT).group).toBeUndefined();
    expect(traceMelee({x:0,y:64*UNIT,z:0},{x:0,y:0,z:1},actor,48*UNIT).group).toBeUndefined();
  });
});
