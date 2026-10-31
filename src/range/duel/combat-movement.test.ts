import {describe, expect, it} from 'vitest';
import {STEP, UNIT} from '../actor-physics';
import {gameData, type Weapon} from '../config';
import {combatMovement} from './combat-movement';
import {sanitizeDuelConfig} from './config';
import {testArena, type Arena} from './geometry';
import {DuelSimulation} from './simulation';
import type {ShotState} from '../shot-state';

function fight(weapon: Weapon, seed = 19, range = 10, level: 1 | 10 = 10) {
  const arena: Arena = {...testArena(), minX: -20, maxX: 20, minZ: -30, maxZ: 30,
    lanes: [{side: 1, role: 'camp', anchor: {x: 0, y: 0, z: -range}, edge: {x: .8, y: 0, z: -range},
      retreat: {x: 0, y: 0, z: -range - 1}, watch: {x: 0, y: 64 * UNIT, z: 0}}],
    spawns: {player: {feet: {x: 0, y: 0, z: 0}, yaw: 0}, bots: [{feet: {x: 0, y: 0, z: -range}, yaw: Math.PI, lane: 0}]}};
  const sim = new DuelSimulation(sanitizeDuelConfig({weapons: [weapon], skill: level, behavior: 'holder',
    utilitiesEnabled: false, radarEnabled: false, generatedMaps: true, roundSeconds: 30}), seed, arena);
  sim.actors[0].health = 10000; sim.start();
  const shots: {at: number; x: number; state: ShotState}[] = [];
  const rows: {at: number; x: number; speed: number; braking: boolean; phase?: string}[] = [];
  for (let tick = 0; tick < 8 / STEP && sim.phase === 'fighting'; tick++) {
    sim.step();
    const bot = sim.actors[1], command = bot.command;
    const wishX = -command.forward * Math.sin(bot.yaw) + command.side * Math.cos(bot.yaw);
    const wishZ = -command.forward * Math.cos(bot.yaw) - command.side * Math.sin(bot.yaw);
    rows.push({at: sim.time, x: bot.position.x, speed: Math.hypot(bot.velocity.x, bot.velocity.z),
      braking: wishX * bot.velocity.x + wishZ * bot.velocity.z < -.1,
      phase: sim.botDecision(1)?.phase});
    for (const event of sim.drainEvents()) if (event.kind === 'fire' && event.actorId === 1 && event.equipment === weapon && event.accuracy)
      shots.push({at: sim.time, x: event.origin.x, state: event.accuracy});
  }
  return {sim, shots, rows};
}

describe('weapon-aware combat movement policy', () => {
  it('prefers mobile SMGs nearby, but precise stops for heavy pistols and snipers', () => {
    expect(combatMovement(10, 'mp9', 8, false, () => .3).style).toBe('run');
    expect(combatMovement(10, 'usp', 8, false, () => .8).style).toBe('stutter');
    for (const weapon of ['deagle', 'revolver', 'awp', 'ssg08', 'scar20'] as const)
      expect(combatMovement(10, weapon, 8, false, () => 0)).toMatchObject({style: 'stutter'});
    expect(combatMovement(10, 'mp9', 30, false, () => .3).style).toBe('stutter');
  });
  it('keeps novice rifle commits and requested crouch sprays without changing skill accuracy', () => {
    expect(combatMovement(1, 'ak47', 12, false, () => 0).style).toBe('commit');
    expect(combatMovement(10, 'ak47', 12, true, () => 0).style).toBe('commit');
    expect(combatMovement(10, 'ak47', 25, false, () => 0)).toMatchObject({style: 'stutter', maxRounds: 3});
  });
  it.each(['ak47', 'deagle', 'usp', 'awp', 'ssg08'] as const)('%s steps between stopped firing windows and uses physical counter-inputs', weapon => {
    const {shots, rows} = fight(weapon);
    expect(shots.length).toBeGreaterThan(2);
    expect(Math.max(...rows.map(row => row.x)) - Math.min(...rows.map(row => row.x))).toBeGreaterThan(.6);
    if (weapon !== 'ssg08')
      expect(Math.max(...shots.map(shot => shot.x)) - Math.min(...shots.map(shot => shot.x))).toBeGreaterThan(.45);
    expect(rows.some(row => row.braking && row.speed > .5)).toBe(true);
    expect(shots.every(shot => shot.state.speedUnits <= gameData.weapons[weapon].speed * .21)).toBe(true);
    for (let index = 1; index < shots.length; index++)
      expect(shots[index].at - shots[index - 1].at).toBeGreaterThanOrEqual(gameData.weapons[weapon].cycle - STEP * 2);
  });
  it('fires an SMG during real running motion without erasing movement spread', () => {
    const samples = [19, 23, 31].map(seed => fight('mp9', seed));
    const moving = samples.flatMap(sample => sample.shots).filter(shot => shot.state.speedUnits > gameData.weapons.mp9.speed * .5);
    expect(moving.length).toBeGreaterThan(3);
    expect(moving.every(shot => shot.state.movementInaccuracy > 0)).toBe(true);
    expect(samples.some(sample => sample.rows.some(row => row.phase === 'microstrafe'))).toBe(true);
  });
  it('never manufactures a combat step through blocking cover', () => {
    const {sim} = fight('ak47');
    sim.arena.solids.push({center: {x: 0, y: 1.5, z: -10}, size: {x: 4, y: 3, z: 4}});
    const brain = sim['brains'].get(1)!;
    if (!('dodge' in brain)) throw Error('Expected tactical brain');
    expect((brain as any).dodge(sim.snapshot()[1], {position: sim.snapshot()[0].position}, sim.time)).toBe(false);
  });
  it('uses a short reachable step when a full combat strafe would hit a wall', () => {
    const {sim} = fight('ak47');
    Object.assign(sim.arena, {minX: -.95, maxX: .95, solids: []});
    const self = {...sim.snapshot()[1], position: {x: 0, y: 64 * UNIT, z: -10}, feet: 0};
    const brain = sim['brains'].get(1)! as any;
    expect(brain.dodge(self, {position: {x: 0, y: 64 * UNIT, z: 0}}, sim.time)).toBe(true);
    expect(Math.abs(brain.microGoal.x)).toBeCloseTo(.45);
  });
  it('does not step through an allied player even when the endpoint is clear', () => {
    const {sim} = fight('ak47');
    const self = {...sim.snapshot()[1], position: {x: 0, y: 64 * UNIT, z: -10}, feet: 0};
    const peers = [-.65, .65].map((x, index) => ({...self, id: index + 2, position: {...self.position, x}}));
    const brain = sim['brains'].get(1)! as any;
    expect(brain.dodge(self, {position: {x: 0, y: 64 * UNIT, z: 0}}, sim.time, peers)).toBe(false);
  });
  it('starts a new movement leg when a running exchange continues in the same phase', () => {
    const {sim} = fight('mp9');
    const self = {...sim.snapshot()[1], position: {x: 0, y: 64 * UNIT, z: -10}, feet: 0};
    const brain = sim['brains'].get(1)! as any;
    brain.phase = 'microstrafe'; brain.phaseAt = 1; brain.routeGoal = 'old'; brain.arrivedGoal = 'old';
    brain.route = [{x: 0, y: 0, z: -8}];
    expect(brain.dodge(self, {position: {x: 0, y: 64 * UNIT, z: 0}}, 5)).toBe(true);
    expect(brain.phaseAt).toBe(5); expect(brain.route).toEqual([]);
    expect(brain.routeGoal).toBe(''); expect(brain.arrivedGoal).toBe('');
  });
});
