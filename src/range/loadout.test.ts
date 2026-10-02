import {describe,expect,it} from 'vitest';
import {defaults,loadoutWeapon,sanitizeSettings,recoilPattern,gameData} from './config';
import {Simulation,STEP} from './simulation';
import {DuelSimulation} from './duel/simulation';
import {duelDefaults} from './duel/config';
import {testArena} from './duel/geometry';

describe('sidearm-only loadouts',()=>{
  it('persists the selected primary but does not carry or equip it',()=>{
    const settings=sanitizeSettings({...defaults,weapon:'awp',sidearm:'deagle',primaryEnabled:false});
    expect(settings.weapon).toBe('awp');expect(loadoutWeapon(settings)).toBe('deagle');
    const range=new Simulation({...settings,mode:'guided'});
    expect(range.slot).toBe(2);expect(range.equipped).toBe('deagle');
    expect(range.pattern).toEqual(recoilPattern('deagle'));
    expect(range.equip(1)).toBe(false);expect(range.equip(3)).toBe(true);
    expect(range.equip(2)).toBe(true);expect(range.equipped).toBe('deagle');
  });
  it('keeps six-round burst drills and reload timing on the sidearm',()=>{
    const range=new Simulation({...defaults,mode:'burst',primaryEnabled:false,sidearm:'cz75a'});
    expect(range.burstSize).toBe(6);range.start();
    for(let n=0;n<200;n++) range.step(STEP);
    expect(range.pistolAmmo).toBe(6);expect(range.drillResult?.shots).toBe(6);
    expect(range.reload()).toBe(true);expect(range.start()).toBe(false);
    while(range.pistolReloadAt) range.step(STEP);
    expect(range.pistolAmmo).toBe(gameData.weapons.cz75a.magazine);
  });
  it('starts duels with the sidearm and can acquire a primary only by picking one up',()=>{
    const sim=new DuelSimulation(duelDefaults,1,{...testArena(),solids:[]},'awp','deagle',false);
    expect(sim.loadout.primary).toBeNull();expect(sim.actors[0].weapon.id).toBe('deagle');
    sim.equipPlayer(1);expect(sim.actors[0].weapon.id).toBe('deagle');
    sim.equipPlayer(3);expect(sim.actors[0].weapon.id).toBe('knife');
    sim.equipPlayer(2);expect(sim.actors[0].weapon.id).toBe('deagle');
    sim.start();sim.drops.push({id:1,equipment:'ak47',ammo:11,position:{x:0,y:.08,z:8},picked:false});
    expect(sim.pickupPlayer()).toBe(true);expect(sim.loadout.primary).toBe('ak47');expect(sim.actors[0].weapon.ammo).toBe(11);
  });
});
