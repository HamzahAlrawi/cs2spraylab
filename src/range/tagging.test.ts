import {describe, expect, it} from 'vitest';
import {advanceActor, groundVelocity, idleInput, STEP, UNIT, type ActorKinematics} from './actor-physics';
import {equipmentIds, equipmentStats, type Equipment} from './equipment';
import {applyTagging, recoverTagging} from './tagging';
import data from './tagging-data.json';
import fixture from './tagging-native-fixture.json';

const fresh = () => ({flinchStack: 1, velocityModifier: 1});
const standing = (): ActorKinematics => ({position: {x: 0, y: 64 * UNIT, z: 0},
  velocity: {x: 0, z: 0}, yaw: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT,
  jumpHeld: false, grounded: true});

describe('native damage-tagging arithmetic', () => {
  it('covers every equipped weapon with audited movement data', () => {
    expect(Object.keys(data.weapons).sort()).toEqual([...equipmentIds].sort());
    expect(fixture.build).toBe(data.build);
    expect(fixture.weaponSha256).toBe(data.sha256);
    for (const id of equipmentIds) expect(data.weapons[id].speed).toBe(equipmentStats(id).speed);
  });

  for (const entry of fixture.cases) it(`matches offline native ${entry.attacker} -> ${entry.victim} repeated-hit fixtures`, () => {
    const state = fresh();
    entry.hits.forEach((hit, index) => {
      if (index) for (let i = 0; i < entry.gapTicks; i++) recoverTagging(state, STEP, true);
      applyTagging(state, entry.attacker as Equipment, entry.victim as Equipment);
      expect(state.flinchStack).toBeCloseTo(hit.stack, 5);
      expect(state.velocityModifier).toBeCloseTo(hit.modifier, 5);
    });
  });

  it('matches native grounded/airborne recovery and full reset fixtures', () => {
    for (const entry of fixture.recovery) {
      const state = {flinchStack: .4, velocityModifier: .3};
      for (let i = 0; i < entry.ticks; i++) recoverTagging(state, STEP, entry.grounded);
      expect(state.flinchStack).toBeCloseTo(entry.stack, 5);
      expect(state.velocityModifier).toBeCloseTo(entry.modifier, 5);
    }
  });

  it('recovers movement at 0.4 per second and repeat-hit buildup at 0.35', () => {
    const state = fresh(); applyTagging(state, 'ak47', 'm4a4');
    const hit = {...state};
    for (let i = 0; i < 64; i++) recoverTagging(state, STEP, true);
    expect(state.velocityModifier).toBeCloseTo(hit.velocityModifier + .2, 8);
    expect(state.flinchStack).toBeCloseTo(hit.flinchStack + .175, 8);
    for (let i = 0; i < 400; i++) recoverTagging(state, STEP, true);
    expect(state).toEqual(fresh());
  });

  it('freezes the speed modifier in air but still recovers the flinch stack', () => {
    const state = fresh(); applyTagging(state, 'ak47', 'm4a4');
    const modifier = state.velocityModifier;
    for (let i = 0; i < 128; i++) recoverTagging(state, STEP, false);
    expect(state.velocityModifier).toBe(modifier);
    expect(state.flinchStack).toBeCloseTo(.75);
    recoverTagging(state, STEP, true);
    expect(state.velocityModifier).toBeCloseTo(modifier + .4 * STEP);
  });

  it('a weaker following hit cannot remove an existing slow', () => {
    const state = fresh(); applyTagging(state, 'mp9', 'ak47');
    const modifier = state.velocityModifier;
    applyTagging(state, 'usp', 'knife');
    expect(state.velocityModifier).toBeLessThanOrEqual(modifier);
  });

  it('bounds repeated hits without freezing any weapon holder', () => {
    for (const attacking of equipmentIds) for (const held of equipmentIds) {
      const state = fresh();
      for (let i = 0; i < 30; i++) {
        recoverTagging(state, STEP, true); applyTagging(state, attacking, held);
        expect(state.velocityModifier).toBeGreaterThanOrEqual(.2 - 1e-9);
        expect(state.velocityModifier).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('tagged movement', () => {
  it('caps existing ground momentum, wish speed and acceleration without frame-by-frame multiplication', () => {
    const actor = {...standing(), velocity: {x: 225 * UNIT, z: 0}, velocityModifier: .3};
    const input = {...idleInput(), side: 1};
    const first = advanceActor(actor, input, 225 * UNIT, STEP);
    expect(first.velocity.x).toBeCloseTo(225 * UNIT * .3);
    const second = advanceActor(first, input, 225 * UNIT, STEP);
    expect(second.velocity).toEqual(groundVelocity(first.velocity.x, 0, 1, 0, 225 * UNIT * .3, STEP));
    expect(second.velocity.x).toBeGreaterThan(first.velocity.x * .95);
    const resting = {...actor, velocity: {x: 0, z: 0}};
    expect(advanceActor(resting, input, 225 * UNIT, STEP).velocity.x)
      .toBeCloseTo(5.5 * 225 * UNIT * .3 * STEP);
  });

  it('combines tagging with walking and crouching caps', () => {
    for (const stance of [{walk: true, crouch: false, duckAmount: 0, factor: .52},
      {walk: false, crouch: true, duckAmount: 1, factor: .34}]) {
      const actor = {...standing(), duckAmount: stance.duckAmount, velocity: {x: 225 * UNIT, z: 0}, velocityModifier: .3};
      const next = advanceActor(actor, {...idleInput(), side: 1, ...stance}, 225 * UNIT, STEP);
      expect(next.velocity.x).toBeCloseTo(225 * UNIT * .3 * stance.factor);
    }
  });

  it('does not change airborne trajectory or air steering, and applies on landing', () => {
    const air = {...standing(), feet: .05, position: {x: 0, y: 64 * UNIT + .05, z: 0},
      grounded: false, verticalVelocity: -1, velocity: {x: 225 * UNIT, z: 0}};
    const input = {...idleInput(), side: -1, crouch: true};
    let tagged = advanceActor({...air, velocityModifier: .3}, input, 225 * UNIT, STEP);
    const normal = advanceActor(air, input, 225 * UNIT, STEP);
    expect(tagged.velocity).toEqual(normal.velocity);
    expect(tagged.position).toEqual(normal.position);
    expect(tagged.verticalVelocity).toBe(normal.verticalVelocity);
    for (let i = 0; i < 80; i++) tagged = advanceActor(tagged, {...idleInput(), side: 1}, 225 * UNIT, STEP);
    expect(tagged.grounded).toBe(true);
    expect(tagged.velocity.x).toBeGreaterThan(0);
    expect(tagged.velocity.x).toBeLessThanOrEqual(225 * UNIT * .3);
  });
});
