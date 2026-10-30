import {dust2Catalog} from './routes';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import * as THREE from 'three';
import {advanceActor, STEP, UNIT} from '../actor-physics';
import {defaults} from '../config';
import {arenaMovementEnvironment} from '../duel/traversal';
import {sanitizePrefireConfig} from './config';
import {PrefireSimulation} from './session';
import {NativeMapCollision} from './native-collision';
import {prefireRoutes} from './routes';
import {placePrefireTarget} from './placement';
import {validPrefireExcursion, type PrefireBotPlan} from './bot-behavior';
import {PrefireBotController} from './bot-controller';

const collisionPath = 'public/revamp/maps/dust2/collision.bin';
describe.skipIf(!existsSync(collisionPath))('native holder trade excursions', () => {
  let collision: NativeMapCollision;
  beforeAll(async () => {
    const bytes = readFileSync(collisionPath), manifest = JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8'));
    collision = await NativeMapCollision.create(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  });
  afterAll(() => collision?.dispose());
  for (const id of ['long-a']) it(`${id}: a holder trades through native cover and physically returns`, () => {
    const route = prefireRoutes.find(route => route.id === id)!;
    const practice = sanitizePrefireConfig({population: 'all', botBehavior: 'static', returnFire: true, tradeEnabled: true, reactionMs: 300});
    const map = {scene: new THREE.Group(), collision, dispose() {}, settle: (point: Parameters<typeof placePrefireTarget>[1]) => placePrefireTarget(collision, point)};
    const sim = new PrefireSimulation(map, practice, route, 7, defaults, undefined, dust2Catalog);
    // Inspect plans in offline QA; production does not expose a hidden-player query.
    type QAController = Pick<PrefireBotController, 'command' | 'orderTrade' | 'snapshot'> & {tradePlan?: PrefireBotPlan};
    const controllers = (sim as unknown as {controllers: QAController[]}).controllers;
    const index = controllers.findIndex(controller => controller.tradePlan?.exposure && !controller.tradePlan.attackFromAnchor);
    expect(index, 'No supported cover-changing local trade').toBeGreaterThanOrEqual(0);
    const controller = controllers[index], plan = controller.tradePlan!, actor = sim.actors[index + 1];
    const anchors = sim.actors.slice(1).map(actor => ({...actor.position, y: actor.feet}));
    expect(validPrefireExcursion(collision, plan.anchor, plan.exposure!, plan.sourceCrouched, anchors)).toBe(true);
    expect(plan.watchPoint).toBeDefined();
    const source = {...actor.position};
    controller.orderTrade({victimId: 99, generation: actor.generation, point: {...plan.watchPoint!}, observedAt: 0,
      readyAt: .15, expiresAt: 2.5, source: 'sight'});
    let excursion = 0;
    for (let tick = 0; tick < 6 / STEP; tick++) {
      const time = tick * STEP, command = controller.command(time, actor, sim.actors[0], collision, practice);
      actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta;
      Object.assign(actor, advanceActor(actor, command, actor.weapon.actions.stats.speed * UNIT, STEP, undefined, undefined, undefined,
        arenaMovementEnvironment(sim.arena, sim.actors, actor.id, time, actor.pitch)));
      excursion = Math.max(excursion, Math.hypot(actor.position.x - source.x, actor.position.z - source.z));
      expect(actor.grounded, `lost support at ${time}`).toBe(true);
      expect(command.fireHeld, 'Must not shoot at the player hidden at the covered start').toBe(false);
    }
    expect(excursion).toBeGreaterThan(16 * UNIT);
    expect(Math.hypot(actor.position.x - source.x, actor.position.z - source.z)).toBeLessThan(2 * UNIT);
    expect(controller.snapshot()).toMatchObject({phase: 'holding', trading: false});
  }, 30000);
  it('Long doors: an already-exposed trader holds the fighting point instead of taking a pointless lap', () => {
    const route = prefireRoutes.find(route => route.id === 'long-doors')!;
    const practice = sanitizePrefireConfig({population: 'all', botBehavior: 'static', returnFire: true, tradeEnabled: true, reactionMs: 300});
    const sim = new PrefireSimulation({scene: new THREE.Group(), collision, dispose() {}, settle: point => placePrefireTarget(collision, point)},
      practice, route, 7, defaults, undefined, dust2Catalog);
    type QAController = Pick<PrefireBotController, 'command' | 'orderTrade' | 'snapshot'> & {tradePlan?: PrefireBotPlan};
    const controllers = (sim as unknown as {controllers: QAController[]}).controllers;
    const index = controllers.findIndex(controller => controller.tradePlan?.exposure && controller.tradePlan.attackFromAnchor);
    expect(index, 'A real source fighting point must still have a validated covered retreat').toBeGreaterThanOrEqual(0);
    const controller = controllers[index], actor = sim.actors[index + 1], plan = controller.tradePlan!;
    const source = {...actor.position};
    expect(validPrefireExcursion(collision, plan.anchor, plan.exposure!, plan.travelCrouched ?? plan.sourceCrouched,
      sim.actors.slice(1).map(other => ({...other.position, y: other.feet})))).toBe(true);
    controller.orderTrade({victimId: 99, generation: actor.generation, point: {...plan.watchPoint!}, observedAt: 0,
      readyAt: .15, expiresAt: 2.5, source: 'sight'});
    let participated = false;
    for (let tick = 0; tick < 4 / STEP; tick++) {
      const time = tick * STEP, command = controller.command(time, actor, sim.actors[0], collision, practice);
      actor.yaw += command.yawDelta; actor.pitch += command.pitchDelta;
      Object.assign(actor, advanceActor(actor, command, actor.weapon.actions.stats.speed * UNIT, STEP, undefined, undefined, undefined,
        arenaMovementEnvironment(sim.arena, sim.actors, actor.id, time, actor.pitch)));
      participated ||= controller.snapshot().trading;
      expect(actor.grounded).toBe(true); expect(command.fireHeld).toBe(false);
      expect(Math.hypot(actor.position.x - source.x, actor.position.z - source.z)).toBeLessThan(.001);
    }
    expect(participated).toBe(true); expect(controller.snapshot()).toMatchObject({phase: 'holding', trading: false});
  }, 30000);
});
