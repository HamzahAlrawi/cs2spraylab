import {describe,it,expect,vi} from 'vitest';
import {Simulation,STEP,UNIT} from './simulation';
import {defaults} from './config';
import {equipmentData} from './equipment';

describe('Always-available sidearm and knife',()=>{
  it('retains the selected primary across slot swaps and applies native movement caps',()=>{
    const sim=new Simulation({...defaults,weapon:'m4a4'});sim.equip(3);sim.active=true;sim.input.side=1;
    for(let i=0;i<128;i++)sim.step(STEP);
    expect(Math.hypot(sim.velocity.x,sim.velocity.z)/UNIT).toBeCloseTo(250);
    sim.equip(2);for(let i=0;i<128;i++)sim.step(STEP);
    expect(sim.equipped).toBe('usp');expect(sim.stats.speed).toBe(240);
    sim.equip(1);expect(sim.equipped).toBe('m4a4');expect(sim.previousSlot).toBe(2);
  });
  it('does not shoot while drawing, fires one USP round per press, and enforces the firing interval',()=>{
    const sim=new Simulation(defaults);const shots=vi.fn();sim.onShot=shots;sim.active=true;sim.equip(2);
    expect(sim.start()).toBe(false);sim.advance(.25);sim.advance(.25);sim.advance(.25);sim.advance(.25);
    sim.start(true);expect(shots).toHaveBeenCalledOnce();expect(sim.pistolAmmo).toBe(11);
    sim.advance(.25);expect(shots).toHaveBeenCalledOnce();
    sim.start();expect(shots).toHaveBeenCalledTimes(2);
    sim.start();sim.advance(.1);expect(shots).toHaveBeenCalledTimes(2);
    sim.advance(.08);expect(shots).toHaveBeenCalledTimes(3);
    expect(shots.mock.calls[2][0].at-shots.mock.calls[1][0].at).toBeGreaterThanOrEqual(.17);
  });
  it('preserves ammo when switching and uses the installed reload duration',()=>{
    const sim=new Simulation(defaults);sim.equip(2);sim.active=true;sim.time=1;
    for(let i=0;i<12;i++){sim.start();sim.advance(.2);}
    expect(sim.pistolAmmo).toBe(0);sim.start();expect(sim.pistolReloadAt-sim.time).toBeCloseTo(equipmentData.weapons.usp.reload);
    for(let i=0;i<8;i++)sim.advance(.25);expect(sim.pistolAmmo).toBe(0);
    sim.advance(.25);expect(sim.pistolAmmo).toBe(12);
    sim.start();sim.equip(3);sim.equip(2);expect(sim.pistolAmmo).toBe(11);
  });
  it('knife swings do not emit bullets or score drill attempts',()=>{
    const sim=new Simulation(defaults);sim.equip(3);sim.time=1;const shots=vi.fn();sim.onShot=shots;
    sim.start();expect(shots.mock.calls[0][0].melee).toBe(true);expect(sim.shots).toBe(0);expect(sim.firing).toBe(false);
    expect(sim.start()).toBe(false);expect(sim.attempts).toBe(0);
  });
});
