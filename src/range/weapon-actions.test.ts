import {describe, expect, it} from 'vitest';
import {STEP} from './actor-physics';
import {defaults, gameData} from './config';
import {Simulation} from './simulation';
import {REVOLVER_WINDUP, WeaponActions, scopeVerticalFov} from './weapon-actions';
import {DuelWeaponState} from './duel/weapon-state';
import {idleCommand} from './duel/types';

const actor = {position: {x: 0, y: 1.6256, z: 0}, velocity: {x: 0, z: 0},
  yaw: 0, pitch: 0, feet: 0, grounded: true, verticalVelocity: 0};

describe('native weapon modes', () => {
  it('requires a held R8 primary windup, cancels an early release, and uses native alternate accuracy for right click', () => {
    const weapon = new DuelWeaponState('revolver', () => 0);
    expect(weapon.advance(0, 0, {...idleCommand(), firePressed: true, fireHeld: true}, actor)).toBeUndefined();
    expect(weapon.advance(.1, .1, idleCommand(), actor)).toBeUndefined();
    expect(weapon.advance(.3, .2, idleCommand(), actor)).toBeUndefined();
    expect(weapon.ammo).toBe(8);
    expect(weapon.advance(1, .1, {...idleCommand(), firePressed: true, fireHeld: true}, actor)).toBeUndefined();
    expect(weapon.advance(1 + REVOLVER_WINDUP, REVOLVER_WINDUP, {...idleCommand(), fireHeld: true}, actor)).toBeDefined();
    weapon.holster();
    expect(weapon.advance(2, .1, {...idleCommand(), secondaryPressed: true}, actor)).toBeDefined();
    expect(weapon.actions.stats.stand).toBe(gameData.weapons.revolver.alternate.stand);
  });
  it('uses R8 alternate accuracy immediately in the range, including after a primary shot', () => {
    const range = new Simulation({...defaults, mode: 'spray', weapon: 'revolver', spread: false});
    const shots: number[] = []; range.onShot = shot => shots.push(shot.at);
    range.start(); range.release('mouse');
    for (let tick = 0; tick < 100; tick++) range.step(STEP);
    expect(shots).toEqual([]);
    range.start();
    while (!shots.length) range.step(STEP);
    range.release('mouse');
    for (let tick = 0; tick < 70; tick++) range.step(STEP);
    range.start(false, true);
    expect(shots).toHaveLength(2);
    expect(range.recovery.weapon.stand).toBe(gameData.weapons.revolver.alternate.stand);
    expect(range.recovery.weapon.fire).toBe(gameData.weapons.revolver.alternate.fire);
    expect(range.firing).toBe(true);
    range.release('mouse');
    expect(range.firing).toBe(false);
  });
  it.each(['awp', 'ssg08', 'g3sg1', 'scar20', 'aug', 'sg553'] as const)('%s uses the extracted scope, accuracy and speed', id => {
    const action = new WeaponActions(id), data = gameData.weapons[id];
    expect(action.secondary(0)).toBe(true);
    expect(action.zoom).toBe(1); expect(action.horizontalFov).toBe(data.zoomFov[0]);
    expect(action.stats.stand).toBe(data.alternate.stand);
    expect(action.stats.speed).toBe(data.alternate.speed);
    expect(action.stats.move).toBe(data.alternate.move);
    expect(action.hidesViewmodel).toBe(data.hideWhenZoomed);
    expect(action.secondary(0)).toBe(false);
    action.holster(); expect(action.zoom).toBe(0);
    expect(action.stats).toBe(action.base);
  });
  it.each(['awp', 'ssg08'] as const)('%s unscopes while cycling the bolt, restores its zoom and cancels on holster', id => {
    const action = new WeaponActions(id);
    action.secondary(0); action.afterShot(1);
    expect(action.zoom).toBe(0); expect(action.pendingZoom).toBe(true);
    action.advance(1 + action.base.cycle - .01); expect(action.zoom).toBe(0);
    action.advance(1 + action.base.cycle); expect(action.zoom).toBe(1);
    action.afterShot(3); action.holster(); action.advance(10);
    expect(action.zoom).toBe(0); expect(action.pendingZoom).toBe(false);
  });
  it('cycles both sniper zoom levels back to unscoped and uses a fixed 4:3 FOV conversion', () => {
    const action = new WeaponActions('awp');
    action.secondary(0); action.secondary(1); expect(action.zoom).toBe(2);
    action.secondary(2); expect(action.zoom).toBe(0);
    expect(scopeVerticalFov(90)).toBeCloseTo(73.739795, 5);
  });
  it.each(['glock', 'famas'] as const)('%s completes a released three-round burst in both modes at native cadence', id => {
    const range = new Simulation({...defaults, mode: 'spray', weapon: id, spread: false});
    const duel = new DuelWeaponState(id, () => 0);
    range.actions.secondary(0); duel.actions.secondary(0);
    const times: number[] = [], duelTimes: number[] = [];
    range.onShot = shot => times.push(shot.at);
    range.active = true;
    for (let tick = 0; tick < 100; tick++) {
      const at = tick * STEP, pressed = tick === 40;
      if (tick) range.step(STEP);
      if (pressed) {range.start(); range.release('mouse');}
      const shot = duel.advance(at, tick ? STEP : 0, {...idleCommand(), firePressed: pressed, fireHeld: pressed}, actor);
      if (shot) duelTimes.push(at);
    }
    expect(times).toHaveLength(3); expect(duelTimes).toEqual(times);
    times.slice(1).forEach((at, i) => expect(at - times[0] - (i + 1) * gameData.weapons[id].burstInterval).toBeLessThan(STEP + 1e-8));
  });
  it('does not resume an interrupted burst or queued trigger when equipping a holstered weapon', () => {
    const weapon = new DuelWeaponState('glock', () => 0);
    weapon.actions.secondary(0);
    expect(weapon.advance(1, 0, {...idleCommand(), firePressed: true}, actor)).toBeDefined();
    weapon.holster();
    expect(weapon.advance(2, STEP, idleCommand(), actor)).toBeUndefined();
    expect(weapon.ammo).toBe(19); expect(weapon.actions.burst).toBe(true);
  });
  it('uses the empty reload presentation state and unscopes on automatic reload', () => {
    const weapon = new DuelWeaponState('awp', () => 0);
    weapon.actions.secondary(0); weapon.ammo = 0;
    weapon.advance(1, 0, {...idleCommand(), firePressed: true}, actor);
    expect(weapon.reloadEmpty).toBe(true); expect(weapon.reloadUntil).toBeGreaterThan(1);
    expect(weapon.actions.zoom).toBe(0);
  });
  it.each([false, true])('R8 held fire uses the same cadence in range and duels (alternate=%s)', alternate => {
    const range = new Simulation({...defaults, mode:'spray', weapon:'revolver', spread:false});
    const duel = new DuelWeaponState('revolver', () => .5);
    const times:number[] = [], duelTimes:number[] = [];
    range.onShot = shot => times.push(shot.at);
    range.start(false, alternate);
    for (let tick=0; tick<300; tick++) {
      const time=tick*STEP;
      if (tick) range.step(STEP);
      const round=duel.advance(time, tick ? STEP : 0, {...idleCommand(),fireHeld:!alternate,firePressed:tick===0&&!alternate,
        secondaryHeld:alternate,secondaryPressed:tick===0&&alternate},actor);
      if(round) duelTimes.push(time);
    }
    expect(times.length).toBeGreaterThan(3);
    expect(times.length).toBe(duelTimes.length);
    times.forEach((time,i)=>expect(time).toBeCloseTo(duelTimes[i],6));
    const interval=alternate ? gameData.weapons.revolver.alternate.cycle : gameData.weapons.revolver.cycle;
    times.slice(1).forEach((time,i)=>expect(Math.abs(time-times[i]-interval)).toBeLessThan(STEP+1e-8));
    expect(Math.abs(times[times.length-1]-times[0]-(times.length-1)*interval)).toBeLessThan(STEP+1e-8);
  });
  it('R8 slows only while cocking its primary trigger and restores idle speed on release', () => {
    const action=new WeaponActions('revolver');
    expect(action.stats.speed).toBe(220);
    action.chargeTrigger(0,true); expect(action.stats.speed).toBe(180);
    action.chargeTrigger(.1,false); expect(action.stats.speed).toBe(220);
    action.alternateFire=true; action.chargeTrigger(1,true); expect(action.stats.speed).toBe(220);
  });
});
