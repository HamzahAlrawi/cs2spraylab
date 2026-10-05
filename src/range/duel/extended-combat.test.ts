import {describe,expect,it} from 'vitest';
import {STEP,UNIT} from '../actor-physics';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {DuelCoach} from './coaching';

const prepare=(weapon:'ak47'|'awp'|'nova'|'zeus'='ak47',bots=1)=>{
  const sim=new DuelSimulation(sanitizeDuelConfig({botCount:bots,armor:false,health:500}),3,testArena(),weapon);
  for(let id=1;id<=bots;id++){sim.command(id,{});sim.actors[id].position={x:0,y:64*UNIT,z:4-(id-1)*2};}
  sim.start();return sim;
};

describe('integrated extended weapons and ballistics',()=>{
  it('damages two lined-up enemies with one penetrating rifle shot',()=>{
    const sim=prepare('awp',2);sim.command(0,{firePressed:true});sim.step();
    expect(sim.actors[1].health).toBeLessThan(500);expect(sim.actors[2].health,JSON.stringify(sim.drainEvents())).toBeLessThan(500);
    const review=sim.coach.review();expect(review.shots).toBe(1);expect(review.hits).toBe(1);expect(review.accuracy).toBe(100);
  });
  it('allows a wood wallbang and still blocks a thick concrete wall',()=>{
    const wood=prepare('ak47');wood.arena.solids.push({center:{x:0,y:1,z:6},size:{x:3,y:2,z:.0254},material:'wood'});
    wood.command(0,{firePressed:true});wood.step();expect(wood.actors[1].health,JSON.stringify(wood.snapshot())).toBeLessThan(500);
    expect(wood.drainEvents().filter(event=>event.kind==='surface').map(event=>event.phase)).toEqual(['entry','exit']);
    const concrete=prepare('ak47');concrete.arena.solids.push({center:{x:0,y:1,z:6},size:{x:3,y:2,z:1},material:'concrete'});
    concrete.command(0,{firePressed:true});concrete.step();expect(concrete.actors[1].health).toBe(500);
  });
  it('fires shotgun pellets once per trigger and consolidates coaching and damage events',()=>{
    const sim=prepare('nova');sim.actors[1].position.z=7;
    sim.command(0,{firePressed:true});sim.step();
    expect(sim.actors[0].weapon.ammo).toBe(7);
    const hits=sim.drainEvents().filter(event=>event.kind==='hit');
    expect(hits.length,JSON.stringify(sim.snapshot())).toBe(1);expect(hits[0].healthDamage).toBeGreaterThan(26);
    expect(sim.coach.review()).toMatchObject({shots:1,hits:1,accuracy:100});
  });
  it('does not let Zeus penetrate cover and does not recharge immediately',()=>{
    const sim=prepare('zeus');sim.actors[1].position.z=7;
    sim.arena.solids.push({center:{x:0,y:1,z:7.5},size:{x:3,y:2,z:.02},material:'glass'});
    sim.command(0,{firePressed:true});sim.step();expect(sim.actors[1].health).toBe(500);expect(sim.actors[0].weapon.ammo).toBe(0);
    for(let tick=0;tick<Math.ceil(1/STEP);tick++)sim.step();expect(sim.actors[0].weapon.ammo).toBe(0);
  });
  it('counts multiple pellets and collateral hits without inflating shot accuracy',()=>{
    const coach=new DuelCoach(),sim=prepare();coach.shot(sim.snapshot()[0]);
    for(const victim of [1,2,3])coach.hit({kind:'hit',tick:1,shooter:0,victim,shotId:77,group:'head',point:{x:0,y:1,z:0},healthDamage:10,armorDamage:0,lethal:false},.1);
    expect(coach.review()).toMatchObject({hits:1,heads:1,accuracy:100,headRate:100,damage:30});
  });
});
