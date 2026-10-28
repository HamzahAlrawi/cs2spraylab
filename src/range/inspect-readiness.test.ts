import {describe, expect, it, vi} from 'vitest';
import {RangeEngine} from './engine';
import {DuelEngine} from './duel/DuelEngine';
import {Simulation} from './simulation';
import {defaults} from './config';

describe('inspection during deployment is presentation-only', () => {
  it('queues an inspection requested while the range sidearm model loads', async () => {
    const engine = Object.create(RangeEngine.prototype) as RangeEngine;
    const sim = new Simulation(defaults); sim.active = true;
    let loaded!: () => void;
    const animation = {playDraw:vi.fn(),playInspect:vi.fn(() => true)};
    Object.assign(engine,{sim,viewAnimations:new Map([[defaults.sidearm,animation]]),
      renderer:{domElement:{focus:vi.fn()}},updateDemonstration:vi.fn(),
      audio:{unlock:vi.fn(),playAction:vi.fn()},setWeapon:vi.fn(() => new Promise<void>(resolve => {loaded=resolve;}))});
    const switched = engine.equip(2), readyAt = sim.equipReadyAt;
    expect(readyAt).toBeGreaterThan(sim.time);
    engine.inspect(); expect(animation.playInspect).not.toHaveBeenCalled();
    loaded(); await switched;
    expect(animation.playInspect).toHaveBeenCalledOnce();
    expect(sim.equipReadyAt).toBe(readyAt); expect(sim.start()).toBe(false);
  });
  it('does not inspect the wrong range weapon after another switch during loading', async () => {
    const engine = Object.create(RangeEngine.prototype) as RangeEngine;
    const sim = new Simulation(defaults); sim.active = true;
    const loaded: (() => void)[] = [];
    const pistol = {playDraw:vi.fn(),playInspect:vi.fn(() => true)}, knife = {playDraw:vi.fn(),playInspect:vi.fn(() => true)};
    Object.assign(engine,{sim,viewAnimations:new Map([[defaults.sidearm,pistol],['knife',knife]]),
      renderer:{domElement:{focus:vi.fn()}},updateDemonstration:vi.fn(),audio:{unlock:vi.fn(),playAction:vi.fn()},
      setWeapon:vi.fn(() => new Promise<void>(resolve => loaded.push(resolve)))});
    const a = engine.equip(2); engine.inspect(); const b = engine.equip(3);
    loaded[0](); await a; loaded[1](); await b;
    expect(pistol.playInspect).not.toHaveBeenCalled(); expect(knife.playInspect).not.toHaveBeenCalled();
  });
  it('allows Duel inspect before equip readiness but not while reloading or firing', () => {
    const engine = Object.create(DuelEngine.prototype) as DuelEngine;
    const actor = {alive:true,equipReadyAt:100,weapon:{id:'ak47',reloadUntil:0},command:{fireHeld:false}};
    const playInspect = vi.fn(() => true);
    Object.assign(engine,{sim:{actors:[actor],time:1},loadedViewEquipment:'ak47',renderedEquipment:'ak47',
      viewAnimation:{playInspect},audio:{playAction:vi.fn()},settings:defaults});
    engine.inspect(); expect(playInspect).toHaveBeenCalledOnce(); expect(actor.equipReadyAt).toBe(100);
    actor.weapon.reloadUntil = 3; engine.inspect(); expect(playInspect).toHaveBeenCalledOnce();
    actor.weapon.reloadUntil = 0; actor.command.fireHeld = true;
    engine.inspect(); expect(playInspect).toHaveBeenCalledOnce();
  });
  it('queues Duel inspection for a switch command awaiting the next physics tick', () => {
    const engine = Object.create(DuelEngine.prototype) as DuelEngine;
    const playInspect = vi.fn(() => true);
    Object.assign(engine,{sim:{actors:[{alive:true,weapon:{id:'ak47',reloadUntil:1},command:{equipSlot:2,fireHeld:false}}],
      loadout:{primary:'ak47',sidearm:'usp'}},loadedViewEquipment:'ak47',renderedEquipment:'ak47',viewAnimation:{playInspect}});
    engine.inspect();
    expect(playInspect).not.toHaveBeenCalled();
    expect((engine as any).pendingInspect).toBe('usp');
  });
});
