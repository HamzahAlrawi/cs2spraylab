import {describe,expect,it} from 'vitest';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {STEP,UNIT} from '../actor-physics';
import {testArena} from './geometry';

describe('selectable knife opponent',()=>{
  it('keeps the configured knife, approaches and damages a visible player',()=>{
    const config=sanitizeDuelConfig({weapons:['knife'],skill:8,behavior:'aggressive'});
    expect(config.weapons).toEqual(['knife']);
    const sim=new DuelSimulation(config,11,testArena());sim.actors[0].health=10000;
    sim.actors[1].position={x:0,y:64*UNIT,z:5};sim.start();let swings=0;
    for(let tick=0;tick<128*8;tick++){sim.step();swings+=sim.drainEvents().filter(event=>event.kind==='fire'&&event.actorId===1&&event.equipment==='knife').length;}
    expect(sim.actors[1].weapon.id).toBe('knife');expect(swings).toBeGreaterThan(0);expect(sim.actors[0].health).toBeLessThan(10000);
  });
});
