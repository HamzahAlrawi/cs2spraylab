import * as THREE from 'three';
import {DuelSimulation, type CombatActor} from '../duel/simulation';
import {sanitizeDuelConfig} from '../duel/config';
import {idleCommand, type ActorCommand} from '../duel/types';
import {randomStream} from '../duel/rng';
import type {Settings} from '../config';
import {DEG, UNIT, type Vec} from '../actor-physics';
import {prefireLineup, sourcePoint} from './route-helpers';
import type {HoldingDensity, PrefireAngle, PrefireCatalog, PrefireRoute} from './schema';
import {angleIdentity, choosePrefireAngles, PREFIRE_WEIGHT_POLICY} from './occupancy';
import type {PrefireMap} from './map';
import {sanitizePrefireConfig, type PrefireConfig} from './config';
import type {DuelScenario, PrefireStats} from '../duel/scenario';
import {placePrefireTarget} from './placement';
import {createPrefireBotPlan, prefireRouteViews, type PrefireBotPlan} from './bot-behavior';
import {PrefireBotController} from './bot-controller';
import {PrefireCoach} from './coaching';
import {angleDiagnosis, loadAngleDiagnoses, saveAngleDiagnoses, loadPrefireHistory, prefireAttempt, savePrefireHistory, summarizePrefireHistory, prefireTrainingIdentity, type AngleDiagnosis, type PrefireAttempt, type PrefireTrainingIdentity} from './training-log';
import {coveredAngleRetry} from './angle-practice';
import {practiceSettingsKey} from '../adaptive-practice';
import {setupKey} from '../setup-key';
import {hasPrefireSight} from './bot-behavior';
import type {ThreatReport, TradeOrder} from '../duel/trading';
import {choosePrefireEncounter, PREFIRE_ENCOUNTER_POLICY, type EncounterSelection} from './encounters';
import {PrefireNavigator} from './navigation';

const facing = (from: Vec, to: Vec) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
export const PREFIRE_PLAN_CACHE_LIMIT = 16;
const routePlans = new WeakMap<PrefireMap['collision'], Map<PrefireRoute,
  {views: Vec[]; rosters: Map<string, {normal: PrefireBotPlan[]; trades: PrefireBotPlan[]}>}>>();

function plansFor(map: PrefireMap, route: PrefireRoute, selected: readonly PrefireAngle[], enabled: boolean, trading: boolean) {
  let courses = routePlans.get(map.collision);
  if (!courses) {courses = new Map(); routePlans.set(map.collision, courses);}
  let course = courses.get(route);
  if (!course) {
    course = {views: prefireRouteViews([route.spawn, ...route.path], map.collision), rosters: new Map()};
    courses.set(route, course);
  }
  const key = JSON.stringify([enabled, trading, selected.map(angleIdentity)]);
  let plans = course.rosters.get(key);
  if (!plans) {
    const reserved = selected.map(angle => placePrefireTarget(map.collision, angle.position, angle.crouched));
    const normal = selected.map(angle => createPrefireBotPlan(map.collision, angle, enabled, course.views, reserved));
    const trades = trading ? normal.map((plan, index) => plan.kind === 'hold' || plan.kind === 'crouch-hide'
      ? createPrefireBotPlan(map.collision, selected[index], true, course.views, reserved, true) : plan) : [];
    plans = {normal, trades};
  } else {
    course.rosters.delete(key);
  }
  course.rosters.set(key, plans);
  if (course.rosters.size > PREFIRE_PLAN_CACHE_LIMIT) course.rosters.delete(course.rosters.keys().next().value!);
  return plans;
}

export class PrefireSimulation extends DuelSimulation {
  override readonly coach: PrefireCoach;
  readonly route: PrefireRoute;
  readonly selectedAngles: readonly PrefireAngle[];
  readonly encounter?: EncounterSelection;
  private readonly controllers: PrefireBotController[];
  private suspended = false;
  constructor(readonly map: PrefireMap, readonly practice: PrefireConfig, route: PrefireRoute, seed: number, settings: Settings, density: HoldingDensity | undefined, catalog: PrefireCatalog) {
    const bounds = map.collision.bounds;
    if (!bounds || ![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite) ||
      bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) {
      throw new Error('Prefire requires finite native collision bounds with positive X and Z extents.');
    }
    route = practice.population === 'all' ? prefireLineup(route, practice.lineupId) : route;
    const random = randomStream(seed, 'prefire-occupancy');
    const encounter = practice.population === 'contextual' ? choosePrefireEncounter(catalog, route, random, {build: {
      mapId: catalog.id, catalogRevision: catalog.revision, gameBuild: map.collision.build, geometrySha256: map.collision.collisionSha256}}) : undefined;
    const selected = encounter?.angles ?? choosePrefireAngles(route, practice.population === 'all' ? 'all' : 'random', random, density, practice.botsPerRun);
    const config = sanitizeDuelConfig({mapId: catalog.id, botCount: selected.length, skill: 1, behavior: 'holder', accuracy: .5,
      weapons: ['m4a4'], tradeEnabled: practice.returnFire && practice.tradeEnabled, roundSeconds: 180, feedbackSeconds: practice.reviewSeconds,
      radarEnabled: false, shortcutProtection: settings.protectShortcuts});
    super(config, seed, {...bounds, solids: [], native: map.collision, design: `Prefire / ${route.name}`},
      settings.weapon, settings.sidearm, settings.primaryEnabled);
    // Duel normalizes registry IDs; this scenario supplies its native arena/catalog explicitly.
    this.config.mapId = catalog.id;
    this.route = route;
    this.selectedAngles = selected; this.encounter = encounter;
    if (!selected.length) this.actors.splice(1);
    this.coach = new PrefireCoach(selected.map(angle => angle.name));
    const anchors = selected.map(angle => placePrefireTarget(map.collision, angle.position, angle.crouched));
    const plans = plansFor(map, route, selected, practice.botBehavior === 'angle-specific', practice.returnFire && practice.tradeEnabled);
    const spawn = placePrefireTarget(map.collision, route.spawn);
    this.place(0, spawn, facing(spawn, sourcePoint(route.look)));
    this.controllers = anchors.map((point, i) => {
      const sample = selected[i], actor = this.actors[i + 1];
      if (sample.crouched) Object.assign(actor, {duckAmount: 1, crouchHeld: true, eyeHeight: 46 * UNIT});
      this.place(i + 1, point, sample.rotation ? (sample.rotation[1] - 90) * DEG : facing(point, spawn));
      // Source pitch is positive-down; the trainer's physical ray is positive-up.
      actor.pitch = sample.rotation ? -sample.rotation[0] * DEG : 0;
      const watch = plans.normal[i].watchPoint;
      if (watch) {
        actor.yaw = facing(actor.position, watch);
        actor.pitch = Math.atan2(watch.y - actor.position.y, Math.hypot(watch.x - actor.position.x, watch.z - actor.position.z));
      }
      this.command(i + 1, {...idleCommand(), crouch: !!sample.crouched});
      return new PrefireBotController(plans.normal[i],
        seed, actor.yaw, actor.pitch, plans.trades[i]);
    });
  }
  private place(id: number, p: Vec, yaw: number) {
    const actor = this.actors[id];
    Object.assign(actor, {feet: p.y, position: {...p, y: p.y + actor.eyeHeight}, yaw, grounded: true, velocity: {x: 0, z: 0}});
  }
  protected override weaponCommand(actor: CombatActor, command: ActorCommand) {
    if (actor.id) this.controllers[actor.id - 1].guardSight(this.time, actor, this.actors[0], this.map.collision);
    if (actor.id && (command.fireHeld || command.firePressed) && actor.weapon.nextShotAt <= this.time + 1e-9 &&
      !this.controllers[actor.id - 1].verifyShot(this.time, actor, this.actors[0], this.map.collision, this.practice.reactionMs)) {
      return {...command, fireHeld: false, firePressed: false};
    }
    return command;
  }
  override step() {
    if (this.suspended) return;
    if (this.phase === 'fighting') {
      const player = this.actors[0];
      for (const actor of this.actors.slice(1)) {
        if (!actor.alive) continue;
        const controller = this.controllers[actor.id - 1];
        controller.visibilityFilter = (from, to) => this.canSeeUtility(actor.id, from, to);
        let command: Partial<ActorCommand> = controller.command(this.time, actor, player, this.map.collision, this.practice);
        if (this.practice.returnFire) {
          controller.guardSight(this.time, actor, player, this.map.collision);
          const {report, visible, tradePending, allowUtility} = controller.combatPolicyState(this.time, actor, this.practice);
          command = this.applyBotCombatPolicy(actor.id, command, report, visible, {allowUtility, tradePending});
        }
        this.command(actor.id, command);
      }
    }
    super.step();
    if (this.actors[0].feet < -15 && this.actors[0].alive) {this.actors[0].health = 0; this.actors[0].alive = false;}
  }
  override pause() {this.suspended = true; super.pause();}
  override resume() {this.suspended = false; super.resume();}
  protected override tradeSkill() {return 8 as const;}
  protected override threatReport(actorId: number): ThreatReport | null {
    return this.practice.returnFire ? this.controllers[actorId - 1]?.threatReport(this.time, this.practice.reactionMs) ?? null : null;
  }
  protected override orderTrade(actorId: number, order: TradeOrder) {
    if (this.practice.returnFire && this.practice.tradeEnabled) this.controllers[actorId - 1]?.orderTrade(order);
  }
  protected override hearBot(actorId: number, point: Vec, sound: 'footstep' | 'landing' | 'gunshot', occluded: boolean) {
    if (sound !== 'gunshot' && sound !== 'footstep' && sound !== 'landing') return;
    const actor = this.actors[actorId];
    this.controllers[actorId - 1]?.hear(point, this.time, this.practice.reactionMs,
      occluded || !hasPrefireSight(this.map.collision, actor.position, point));
  }
  prefireBotDecision(actorId: number) {return this.controllers[actorId - 1]?.snapshot();}
  override botDecision(actorId: number) {
    const decision = this.controllers?.[actorId - 1]?.snapshot();
    return decision ? {phase: decision.phase, peek: decision.kind, visible: decision.visible} : undefined;
  }
}

export class PrefireSession implements DuelScenario {
  get mapId() {return this.catalog.id;}
  readonly name: string;
  get routes() {return this.catalog.routes;}
  get density() {return this.catalog.density?.mapId === this.catalog.id && this.catalog.density.schemaVersion === 1 ? this.catalog.density : undefined;}
  readonly scene = new THREE.Group();
  private readonly guide = new THREE.Group();
  private guideLine?: THREE.Line;
  private guideArrows?: THREE.InstancedMesh;
  private guideSegments: number[] = [];
  private guideArrowSegments: number[] = [];
  private guideMatrices: THREE.Matrix4[] = [];
  private guideStep = 0;
  private guideSimulation?: DuelSimulation;
  config: PrefireConfig;
  routeIndex: number;
  private history: PrefireAttempt[];
  private recorded = new WeakSet<DuelSimulation>();
  private keys = new WeakMap<DuelSimulation, string>();
  private rosters = new WeakMap<DuelSimulation, readonly PrefireAngle[]>();
  private navigators = new WeakMap<DuelSimulation, PrefireNavigator>();
  private isolated = new WeakSet<DuelSimulation>();
  private attempts = 0;
  private readonly instance = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  diagnoses: AngleDiagnosis[];
  readonly identity: PrefireTrainingIdentity;
  retry?: {angleId: string; route: PrefireRoute};
  activeKey = '';
  onReview?: (rows: AngleDiagnosis[], isolated: boolean) => void;
  constructor(readonly map: PrefireMap, config: PrefireConfig, readonly catalog: PrefireCatalog) {
    if (!catalog.routes.length) throw new Error('Prefire catalog needs at least one validated course.');
    this.name = `${catalog.name} Prefire`;
    this.config = this.sanitize(config);
    this.identity = prefireTrainingIdentity(catalog, map.collision);
    this.history = loadPrefireHistory(this.identity);
    this.diagnoses = loadAngleDiagnoses(this.identity);
    this.routeIndex = Math.max(0, this.routes.findIndex(route => route.id === this.config.routeId));
    this.scene.add(map.scene, this.guide);
  }
  updateView(position: Vec) {this.map.updateVisibility?.(position);}
  loadingReport() {return this.map.loadStats;}
  feedbackSeconds() {return this.config.reviewSeconds;}
  private sanitize(config: PrefireConfig) {
    if (config.mapId !== this.catalog.id) throw new Error('Prefire config/catalog map identity mismatch.');
    return sanitizePrefireConfig(config, this.catalog);
  }
  practiceKey(settings: Settings, config = this.config) {return setupKey([this.identity, practiceSettingsKey(settings), config]);}
  configure(config: PrefireConfig) {
    const next = this.sanitize(config);
    if (next.routeId !== this.config.routeId) this.routeIndex = Math.max(0, this.routes.findIndex(route => route.id === next.routeId));
    this.config = next;
  }
  next() {this.retry = undefined; this.routeIndex = (this.routeIndex + 1) % this.routes.length;}
  select(id: string) {const index = this.routes.findIndex(route => route.id === id); if (index >= 0) {this.retry = undefined; this.routeIndex = index;}}
  startAngleRetry(angleId: string, routeId = this.routes[this.routeIndex].id) {
    const index = this.routes.findIndex(route => route.id === routeId);
    if (index < 0) return false;
    const route = coveredAngleRetry(this.map.collision, this.routes[index], angleId);
    if (!route) return false;
    this.routeIndex = index; this.retry = {angleId, route}; return true;
  }
  endAngleRetry() {this.retry = undefined;}
  beforeRestart(outcome: DuelSimulation['outcome'], continuous: boolean) {if (!this.retry && continuous && outcome === 'won' && this.config.autoAdvance) this.next();}
  create(settings: Settings, seed: number) {
    const route = this.retry?.route ?? this.routes[this.routeIndex];
    const practice = this.retry ? {...this.config, population: 'all' as const, lineupId: undefined} : this.config;
    for (const node of this.guide.children) if (node instanceof THREE.Line || node instanceof THREE.Mesh) {node.geometry.dispose(); (node.material as THREE.Material).dispose(); if (node instanceof THREE.InstancedMesh) node.dispose();}
    this.guide.clear(); this.guide.visible = this.config.routeGuide;
    this.guideLine = this.guideArrows = undefined;
    this.guideSegments = []; this.guideArrowSegments = []; this.guideMatrices = []; this.guideStep = 0;
    if (this.config.routeGuide) {
      const points = [route.spawn, ...route.path].map(point => placePrefireTarget(this.map.collision, point));
      const groundLine: THREE.Vector3[] = [];
      const groundSegments: number[] = [];
      for (let i = 1; i < points.length; i++) {
        this.guideSegments.push(groundLine.length);
        const a = points[i - 1], b = points[i], steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .25);
        for (let step = 0; step <= steps; step++) {
          const t = step / steps, p = {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t};
          const floor = this.map.collision.vertical(p, p.y + 1, p.y - 4, 72 * .0254);
          groundLine.push(new THREE.Vector3(p.x, (floor.grounded ? floor.feet : p.y) + .025, p.z));
          groundSegments.push(i - 1);
        }
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(groundLine),
        new THREE.LineDashedMaterial({color: '#66debe', dashSize: .22, gapSize: .22, transparent: true, opacity: .65}));
      line.name = 'prefire-guide-line'; line.computeLineDistances(); this.guide.add(line); this.guideLine = line;
      // One batched draw for all direction arrows; no per-frame floor raycasts.
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -.22,0,.16, 0,0,-.16, -.08,0,.16, 0,0,-.16, .22,0,.16, .08,0,.16,
      ], 3));
      const arrowPoints: {point: THREE.Vector3; yaw: number}[] = [];
      let spacing = 0;
      for (let i = 1; i < groundLine.length; i++) {
        const a = groundLine[i - 1], b = groundLine[i];
        spacing += Math.hypot(b.x - a.x, b.z - a.z);
        if (spacing < 1.8) continue;
        spacing = 0; arrowPoints.push({point: b, yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z))});
        this.guideArrowSegments.push(groundSegments[i]);
      }
      const arrows = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({color: '#8cf2d9', side: THREE.DoubleSide}), arrowPoints.length);
      const transform = new THREE.Object3D();
      arrowPoints.forEach(({point, yaw}, i) => {transform.position.copy(point); transform.position.y += .012;
        transform.rotation.y = yaw; transform.updateMatrix(); arrows.setMatrixAt(i, transform.matrix); this.guideMatrices.push(transform.matrix.clone());});
      arrows.name = 'prefire-guide-arrows'; arrows.instanceMatrix.needsUpdate = true; this.guide.add(arrows); this.guideArrows = arrows;
    }
    const sim = new PrefireSimulation(this.map, practice, route, seed, settings, this.density, this.catalog);
    this.guideSimulation = sim;
    this.navigators.set(sim, new PrefireNavigator(sim.route.path.map(point => placePrefireTarget(this.map.collision, point)), sim.route.name));
    this.rosters.set(sim, sim.selectedAngles);
    if (this.retry) this.isolated.add(sim);
    this.keys.set(sim, setupKey([this.identity,
      this.density ? [this.density.source.revision, this.density.sample.matches, this.density.sample.rounds] : null,
        route.id, sim.loadout, sim.actors.length - 1, this.config.population,
        this.config.population === 'random' ? PREFIRE_WEIGHT_POLICY.id : null, this.config.botsPerRun, this.config.botBehavior,
      sim.encounter ? [PREFIRE_ENCOUNTER_POLICY.id, sim.encounter.mode, sim.encounter.build, sim.encounter.evidence.revision, sim.encounter.context] : null,
      this.config.returnFire ? [this.config.reactionMs, this.config.tradeEnabled] : false, this.config.routeGuide, this.config.navigationHints,
      this.config.population === 'all' ? sim.route.angles.map(angleIdentity) : null,
      this.retry ? ['isolated', this.retry.angleId] : 'route', practiceSettingsKey(settings)]));
    this.activeKey = this.keys.get(sim)!;
    return sim;
  }
  report(sim: DuelSimulation): PrefireStats {
    const review = sim instanceof PrefireSimulation ? sim.coach.review() : new PrefireCoach([]).review();
    const route = sim instanceof PrefireSimulation ? sim.route : this.routes[this.routeIndex];
    const key = this.keys.get(sim) ?? '';
    if (sim.phase === 'result' && sim.outcome && key && !this.recorded.has(sim)) {
      this.recorded.add(sim);
      const isolated = this.isolated.has(sim), id = `${this.instance}-${++this.attempts}`;
      const roster = this.rosters.get(sim) ?? [];
      const rows = review.angles.flatMap(angle => {
        const source = roster[angle.id - 1];
        if (!source) return [];
        return [angleDiagnosis(angle, {...this.identity, id: `${id}-${angleIdentity(source)}`, key, routeId: route.id, angleId: angleIdentity(source),
          scope: isolated ? 'angle' : 'route', date: new Date().toISOString()})];
      });
      this.diagnoses = [...rows, ...this.diagnoses].slice(0, 160); saveAngleDiagnoses(this.diagnoses, this.identity);
      if (!isolated && roster.length) {
        this.history.unshift(prefireAttempt(review, key, route.name, sim.outcome, sim.completedAt??sim.time, this.identity));
        this.history = this.history.slice(0, 40); savePrefireHistory(this.history, this.identity);
      }
      this.onReview?.(rows, isolated);
    }
    const navigation = this.navigators.get(sim)?.update({...sim.actors[0].position, y: sim.actors[0].feet}, sim.actors[0].yaw);
    if (sim === this.guideSimulation && navigation && this.guideLine && this.guideArrows) {
      const step = navigation.complete ? navigation.total : navigation.waypoint - 1;
      if (step !== this.guideStep) {
        this.guideStep = step;
        const vertices = this.guideLine.geometry.getAttribute('position').count, start = this.guideSegments[step] ?? vertices;
        this.guideLine.geometry.setDrawRange(start, vertices - start);
        let first = this.guideArrowSegments.findIndex(segment => segment >= step);
        if (first < 0) first = this.guideMatrices.length;
        this.guideArrows.count = this.guideMatrices.length - first;
        for (let i = 0; i < this.guideArrows.count; i++) this.guideArrows.setMatrixAt(i, this.guideMatrices[first + i]);
        this.guideArrows.instanceMatrix.needsUpdate = true;
      }
    }
    return {...review, routeId: route.id, routeName: route.name, headshotPercent: review.headRate,
      stoppedPercent: review.settled, seconds: sim.completedAt??sim.time, progress: summarizePrefireHistory(this.history, key, this.identity),
      encounter: sim instanceof PrefireSimulation ? sim.encounter : undefined,
      navigation};
  }
}
