import {describe, expect, it} from 'vitest';
import {BotUtilityPlanner, utilityAimDirection} from './utility-tactics';
import {UTILITY_RULES, utilityLaunchVelocity} from './utilities';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {utilityInventory} from './utility-loadout';

describe('sensed-information utility decisions', () => {
  it('does not invent a target from hidden enemy positions', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({botUtilities: false}));
    const planner = new BotUtilityPlanner(1, 1, 10);
    for (let time = 0; time < 20; time += .1) expect(planner.command(time, sim.snapshot()[1],
      utilityInventory(['he', 'flash', 'smoke', 'molotov']), null, testArena(),
      {visible: false, lastShotAt: -Infinity, teammates: []})).toBeUndefined();
  });
  it('solves the same gravity/launch model used by real projectiles', () => {
    const from = {x: 2, y: 1.6, z: 5}, to = {x: 10, y: .1, z: -8};
    const direction = utilityAimDirection(from, to)!;
    const velocity = utilityLaunchVelocity(direction, 1);
    const time = (to.x - from.x) / velocity.x;
    expect(from.z + velocity.z * time).toBeCloseTo(to.z, 5);
    expect(from.y + velocity.y * time - UTILITY_RULES.gravity * time ** 2 / 2).toBeCloseTo(to.y, 5);
    expect(utilityAimDirection(from, {...to, x: 1000})).toBeUndefined();
  });
  it('never throws while actively shooting or without recognition', () => {
    const self = new DuelSimulation().snapshot()[1];
    const planner = new BotUtilityPlanner(1, 1, 10);
    const inventory = utilityInventory(['he', 'flash']);
    for (let time = 2; time < 8; time += .1) expect(planner.command(time, self, inventory,
      {point: {x: 0, y: 1.6, z: 10}, observedAt: time, readyAt: time + 1, source: 'sight'}, testArena(),
      {visible: true, lastShotAt: time, teammates: []})).toBeUndefined();
  });
});
