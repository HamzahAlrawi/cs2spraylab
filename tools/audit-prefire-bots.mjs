// Offline, native-asset audit. No fake LOS, route teleporting, or browser grid work.
// Usage: node tools/audit-prefire-bots.mjs [--seeds=7,42] [--seconds=180] [--report=path.json]
// Fast diagnostics: --planning-only or --routes=long-a,b-tunnels (full audit is the default).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {createServer} from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const seeds = (arg('seeds') ?? '7,42').split(',').map(Number), seconds = Number(arg('seconds') ?? 180);
const planningOnly = process.argv.includes('--planning-only'), requestedRoutes = arg('routes')?.split(',');
if (!seeds.length || seeds.some(seed => !Number.isSafeInteger(seed)) || new Set(seeds).size !== seeds.length || !(seconds > 0 && seconds <= 180)) {
  throw new Error('Use integer seeds and a duration in (0, 180]. Short runs are diagnostic, not full audits.');
}
const vite = await createServer({root, server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
let collision, restoreController, restoreVerification;
const started = performance.now(), failures = [], observations = [], diagnostics = [], failureKeys = new Set(), runs = [], planning = [];
const fail = (code, context, detail) => {
  const key = `${code}/${context.route ?? ''}/${context.seed ?? ''}/${context.bot ?? ''}`;
  if (!failureKeys.has(key)) {
    failureKeys.add(key);
    const items = ['blocked-player-route', 'route-not-completed'].includes(code) ? diagnostics : failures;
    items.push({code, ...context, ...detail});
  }
};
const round = value => Number.isFinite(value) ? +value.toFixed(4) : null;
const distribution = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  return {samples: sorted.length, p50Ms: round(sorted[Math.floor((sorted.length - 1) * .5)]),
    p95Ms: round(sorted[Math.floor((sorted.length - 1) * .95)]), maxMs: round(sorted[sorted.length - 1])};
};

try {
  const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
  const {PrefireSimulation} = await vite.ssrLoadModule('/src/range/prefire/session.ts');
  const {PrefireBotController} = await vite.ssrLoadModule('/src/range/prefire/bot-controller.ts');
  const {prefireBotCatalog, prefireBotKey, validPrefireExcursion, hasPrefireSight, prefireRouteViews} =
    await vite.ssrLoadModule('/src/range/prefire/bot-behavior.ts');
  const {prefireRoutes, sourcePoint} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
  if (requestedRoutes?.some(id => !prefireRoutes.some(route => route.id === id))) throw new Error('Unknown --routes ID.');
  const selectedRoutes = requestedRoutes ? prefireRoutes.filter(route => requestedRoutes.includes(route.id)) : prefireRoutes;
  const {placePrefireTarget} = await vite.ssrLoadModule('/src/range/prefire/placement.ts');
  const {sanitizePrefireConfig} = await vite.ssrLoadModule('/src/range/prefire/config.ts');
  const {defaults} = await vite.ssrLoadModule('/src/range/config.ts');
  const {STEP, UNIT, stanceCurve} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
  const {idleCommand} = await vite.ssrLoadModule('/src/range/duel/types.ts');
  const {actorHeadPoint, traceActor} = await vite.ssrLoadModule('/src/range/duel/geometry.ts');
  const {moveOnTerrain} = await vite.ssrLoadModule('/src/range/actor-collision.ts');
  const {actorContactSolids} = await vite.ssrLoadModule('/src/range/actor-contact.ts');
  const bytes = fs.readFileSync(path.join(root, 'public/revamp/maps/dust2/collision.bin'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/revamp/maps/dust2/collision.json'), 'utf8'));
  const binarySha256 = createHash('sha256').update(bytes).digest('hex');
  if (binarySha256 !== manifest.collisionSha256) throw new Error('Native collision checksum mismatch.');
  const sourceSha256 = Object.fromEntries(['bot-behavior.ts', 'bot-controller.ts', 'session.ts', 'routes.ts', 'native-collision.ts']
    .map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, 'src/range/prefire', file))).digest('hex')]));
  for (const file of ['schema.ts', 'occupancy.ts', 'config.ts', '../actor-physics.ts']) {
    sourceSha256[file] = createHash('sha256').update(fs.readFileSync(path.join(root, 'src/range/prefire', file))).digest('hex');
  }
  const auditSha256 = createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  const loadStarted = performance.now();
  collision = await NativeMapCollision.create(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const nativeLoadMs = performance.now() - loadStarted;
  const map = {scene: new THREE.Group(), collision, settle: point => placePrefireTarget(collision, point), dispose() {}};
  let queryCounts = {ray: 0, sweep: 0, fits: 0, vertical: 0}, activeCommand, activeRun;
  const nativeRay = collision.ray.bind(collision);
  for (const name of Object.keys(queryCounts)) {
    const original = collision[name].bind(collision);
    collision[name] = (...args) => {
      queryCounts[name]++;
      if (activeCommand && name === 'ray') activeCommand.rays++;
      return original(...args);
    };
  }
  const heading = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
  const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
  const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const feetOf = actor => ({x: actor.position.x, y: actor.feet, z: actor.position.z});
  const headOf = actor => actorHeadPoint(feetOf(actor), actor.duckAmount ?? 0, actor.yaw);
  const resetQueries = () => {queryCounts = {ray: 0, sweep: 0, fits: 0, vertical: 0};};
  const walkLane = (from, to, sim) => {
    let p = {...from};
    const world = {floor: null, solids: actorContactSolids(sim.actors, 0), native: collision};
    for (let step = 0; step < 400 && gap(p, to) > .03; step++) {
      const d = gap(p, to), increment = Math.min(.05, d);
      const moved = moveOnTerrain(p, {x: p.x + (to.x - p.x) / d * increment, y: p.y,
        z: p.z + (to.z - p.z) / d * increment}, 72 * UNIT, world, true);
      if (!moved.grounded || gap(p, moved.position) < .0001) return undefined;
      p = moved.position;
    }
    return gap(p, to) < .05 ? p : undefined;
  };
  const detourAround = (sim, bot, goal) => {
    const from = feetOf(sim.actors[0]), b = feetOf(bot), alongZ = Math.abs(goal.z - from.z) >= Math.abs(goal.x - from.x);
    const candidates = [];
    for (const clearance of [1.15, 1.4, 1.7]) for (const side of [-1, 1]) {
      const a = alongZ ? {...from, x: b.x + side * clearance} : {...from, z: b.z + side * clearance};
      const c = alongZ ? {...a, z: b.z + Math.sign(goal.z - b.z) * clearance} : {...a, x: b.x + Math.sign(goal.x - b.x) * clearance};
      const first = walkLane(from, a, sim), second = first && walkLane(first, c, sim);
      if (!second || !walkLane(second, goal, sim)) continue;
      candidates.push({points: [first, second], length: gap(from, first) + gap(first, second) + gap(second, goal)});
    }
    return candidates.sort((a, b) => a.length - b.length)[0]?.points;
  };
  const countKinds = plans => plans.reduce((counts, plan) => {counts[plan.kind]++; return counts;},
    {'hold': 0, 'crouch-hide': 0, 'periodic-peek': 0, 'move-out': 0});
  const takesAngle = plan => plan.intent ? plan.intent === 'take-angle' : plan.kind === 'move-out';
  const homeOf = plan => plan.attackFromAnchor && plan.exposure ? plan.exposure : plan.anchor;
  const attackOf = plan => plan.attackFromAnchor ? plan.anchor : plan.exposure;
  const validPoint = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

  // Dense silhouette rays run once offline, at native lane samples, never in command().
  const visibleBody = (origin, feet, crouched, yaw) => {
    const head = actorHeadPoint(feet, crouched, yaw);
    const headDistance = Math.hypot(head.x - origin.x, head.y - origin.y, head.z - origin.z);
    if (headDistance > 1e-6) {
      const direction = {x: (head.x - origin.x) / headDistance, y: (head.y - origin.y) / headDistance, z: (head.z - origin.z) / headDistance};
      const hit = traceActor(origin, direction, feet, crouched, headDistance, yaw);
      if (hit.group === 'head' && !nativeRay(origin, direction, hit.distance - .0001)) return {origin, target: head, hitgroup: hit.group, hitDistance: round(hit.distance)};
    }
    for (const height of [32, 40, 48, 56, 64, 68, 72]) {
      for (const x of [-.4, -.31, -.22, -.135, 0, .135, .22, .31, .4]) for (const z of [-.17, 0, .17]) {
        const target = {x: feet.x + x, y: feet.y + (height - (crouched ? 18 : 0)) * UNIT, z: feet.z + z};
        const distance = Math.hypot(target.x - origin.x, target.y - origin.y, target.z - origin.z);
        const direction = {x: (target.x - origin.x) / distance, y: (target.y - origin.y) / distance, z: (target.z - origin.z) / distance};
        const hit = traceActor(origin, direction, feet, crouched, distance + .5, yaw);
        if (Number.isFinite(hit.distance) && !nativeRay(origin, direction, Math.max(0, hit.distance - .0001))) {
          return {origin, target, hitgroup: hit.group, hitDistance: round(hit.distance)};
        }
      }
    }
    return undefined;
  };

  const commandOriginal = PrefireBotController.prototype.command;
  PrefireBotController.prototype.command = function(time, actor, player, terrain, options) {
    if (!activeRun) return commandOriginal.call(this, time, actor, player, terrain, options);
    const metric = activeRun.bots[actor.id - 1], commandProbe = {rays: 0}, previousPhase = this.snapshot().phase;
    activeCommand = commandProbe;
    let command;
    const commandStarted = performance.now();
    try {command = commandOriginal.call(this, time, actor, player, terrain, options);}
    finally {activeCommand = undefined;}
    const cost = performance.now() - commandStarted, decision = this.snapshot();
    activeRun.controllerMs += cost; activeRun.controllerCalls++; activeRun.controllerRays += commandProbe.rays;
    if (activeRun.controllerCalls % 128 === 0) activeRun.controllerSamples.push(cost);
    if (decision.visible && commandProbe.rays) {
      metric.lastContact = {...this.contact}; metric.lastContactAt = this.contactAt;
    }
    const context = {route: activeRun.route, seed: activeRun.seed, bot: this.plan.key};
    if (!decision.visible) {
      // Structural memory check only. Independent visible-actor quality is
      // measured by audit-prefire-encounters.mjs, not this desired-aim mirror.
      const remembered = this.contact && time < this.contactUntil ? this.contact : undefined;
      let aim = remembered ?? (time < this.areaUntil ? this.knownApproach : undefined) ?? this.plan.watchPoint;
      let observedAt = remembered ? this.contactAt : -Infinity;
      const heard = this.heard && time >= this.heard.readyAt && time - this.heard.observedAt < 3.5 ? this.heard : undefined;
      if (heard && heard.observedAt > observedAt) {aim = heard.point; observedAt = heard.observedAt;}
      const trade = this.trade && options.returnFire && options.tradeEnabled !== false && time >= this.trade.readyAt &&
        time < this.trade.expiresAt && (actor.generation === undefined || this.trade.generation === actor.generation) ? this.trade : undefined;
      if (trade && trade.observedAt > observedAt) aim = trade.point;
      const expectedYaw = aim ? heading(actor.position, aim) : metric.homeYaw;
      const expectedPitch = aim ? Math.atan2(aim.y - actor.position.y, gap(aim, actor.position)) : metric.homePitch;
      const punch = actor.punch?.shotFor(actor.weapon.recovery?.angle ?? {yaw: 0, pitch: 0});
      const viewYaw = actor.yaw - (punch?.yaw ?? 0) * Math.PI / 180, viewPitch = actor.pitch + (punch?.pitch ?? 0) * Math.PI / 180;
      metric.hiddenAimChecks++;
      if (remembered) metric.hiddenMemoryAimChecks++;
      else if (aim) metric.routePreAimChecks++;
      else metric.sourceFacingChecks++;
      if (Math.abs(command.yawDelta - (aim || options.returnFire ? clamp(angleDelta(viewYaw, expectedYaw), .035) : 0)) > 1e-8 ||
        Math.abs(command.pitchDelta - (aim || options.returnFire ? clamp(expectedPitch - viewPitch, .025) : 0)) > 1e-8) {
        fail('hidden-player-tracking', context, {time, command, lastContact: metric.lastContact, watchPoint: this.plan.watchPoint,
          expectedAim: aim, expectedYaw, expectedPitch, hiddenPlayer: {...player.position}});
      }
    }
    const speed = Math.hypot(actor.velocity.x, actor.velocity.z), yaw = actor.yaw + command.yawDelta;
    const wish = {x: command.side * Math.cos(yaw) - command.forward * Math.sin(yaw),
      z: -command.side * Math.sin(yaw) - command.forward * Math.cos(yaw)};
    const wishLength = Math.hypot(wish.x, wish.z);
    metric.phaseSeconds[decision.phase] = (metric.phaseSeconds[decision.phase] ?? 0) + STEP;
    if (command.walk) {metric.walkCommandTicks++; fail('unexpected-shift-walk', context, {time, phase: decision.phase, command});}
    if (wishLength > 1e-8) {
      metric.movementInputTicks++;
      if (Math.abs(wishLength - 1) > 1e-8) fail('partial-speed-wish', context, {time, phase: decision.phase, wish, wishLength});
      if (wish.x * actor.velocity.x + wish.z * actor.velocity.z < -1e-6) metric.counterstrafeTicks++;
      if (['waiting', 'holding', 'exposed'].includes(decision.phase) && speed < .12) {
        fail('idle-hold-input-jitter', context, {time, phase: decision.phase, speed, wish});
      }
    }
    if (decision.phase === 'waiting' && decision.visible) metric.contactHoldSeconds += STEP;
    if (decision.phase === 'outbound' && previousPhase !== 'outbound') metric.outboundAttempts++;
    if (decision.phase === 'exposed' && previousPhase === 'outbound') metric.completedSwings++;
    if (takesAngle(this.plan) && previousPhase === 'exposed' && decision.phase === 'retreating' &&
      !(actor.weapon.reloadUntil > 0 || actor.weapon.ammo <= 3 && actor.weapon.reserve > 0)) {
      fail('take-angle-abandoned-without-reload', context, {time, ammo: actor.weapon.ammo, reserve: actor.weapon.reserve});
    }
    metric.lastCommand = {time, speed: Math.hypot(actor.velocity.x, actor.velocity.z), grounded: actor.grounded,
      duck: actor.duckAmount, reloading: actor.weapon.reloadUntil > 0, visible: decision.visible,
      seenAt: decision.seenAt, phase: decision.phase, nextShotAt: actor.weapon.nextShotAt,
      crouch: command.crouch, reactionMs: options.reactionMs, returnFire: options.returnFire,
      origin: {...actor.position}, player: {...player.position}};
    if (command.fireHeld && actor.weapon.nextShotAt <= time + STEP + 1e-9) {
      metric.firingOpportunities++;
      if (!hasPrefireSight({ray: nativeRay}, actor.position, headOf(player))) fail('blocked-fire-command', context, {time, ...metric.lastCommand});
      if (!decision.visible || decision.seenAt === undefined || time - decision.seenAt + 1e-9 < options.reactionMs / 1000) {
        fail('reaction-or-visibility', context, {time, ...metric.lastCommand});
      }
    }
    return command;
  };
  restoreController = () => {PrefireBotController.prototype.command = commandOriginal;};
  const verificationOriginal = PrefireBotController.prototype.verifyShot;
  if (verificationOriginal) {
    PrefireBotController.prototype.verifyShot = function(time, actor, player, terrain, reactionMs) {
      if (!activeRun) return verificationOriginal.call(this, time, actor, player, terrain, reactionMs);
      const probe = {rays: 0}; activeCommand = probe;
      const verifyStarted = performance.now();
      let ready;
      try {ready = verificationOriginal.call(this, time, actor, player, terrain, reactionMs);}
      finally {activeCommand = undefined;}
      const cost = performance.now() - verifyStarted, bot = activeRun.bots[actor.id - 1], decision = this.snapshot();
      activeRun.controllerMs += cost; activeRun.verificationMs += cost;
      activeRun.verificationCalls++; activeRun.controllerRays += probe.rays;
      if (activeRun.verificationCalls % 16 === 0) activeRun.verificationSamples.push(cost);
      if (decision.visible && probe.rays) {bot.lastContact = {...this.contact}; bot.lastContactAt = this.contactAt;}
      if (ready && (!hasPrefireSight({ray: nativeRay}, actor.position, headOf(player)) || decision.seenAt === undefined ||
        time - decision.seenAt + 1e-9 < reactionMs / 1000)) {
        fail('post-movement-fire-verification', {route: activeRun.route, seed: activeRun.seed, bot: this.plan.key}, {time, decision});
      }
      return ready;
    };
    restoreVerification = () => {PrefireBotController.prototype.verifyShot = verificationOriginal;};
  }

  const allPlans = [], routeCount = prefireRoutes.length, angleCount = prefireRoutes.reduce((n, route) => n + route.angles.length, 0);
  const uniqueSources = new Set(prefireRoutes.flatMap(route => route.angles.map(prefireBotKey))).size;
  if (!routeCount || new Set(prefireRoutes.map(route => route.id)).size !== routeCount || prefireRoutes.some(route => !route.id)) {
    fail('catalog-route-identities', {}, {routeCount, routeIds: prefireRoutes.map(route => route.id)});
  }
  for (const route of prefireRoutes) {
    const keys = route.angles.map(prefireBotKey), ids = route.angles.map(angle => angle.id ?? prefireBotKey(angle));
    if (!route.angles.length || route.angles.length > 5 || new Set(keys).size !== keys.length || new Set(ids).size !== ids.length) {
      fail('catalog-angle-budget-or-identities', {route: route.id}, {count: route.angles.length, keys, ids});
    }
    if (!validPoint(route.spawn) || !validPoint(route.look) || !route.path.length || !route.path.every(validPoint) ||
      route.angles.some(angle => !validPoint(angle.position) || angle.rotation && !validPoint(angle.rotation))) {
      fail('catalog-coordinate-contract', {route: route.id}, {});
    }
  }
  for (const route of selectedRoutes) {
    let warmup, targets, views, plans;
    const practice = sanitizePrefireConfig({routeId: route.id, population: 'all', botBehavior: 'angle-specific', returnFire: true, reactionMs: 1000});
    resetQueries();
    const coldStarted = performance.now();
    try {
      warmup = new PrefireSimulation(map, practice, route, seeds[0], defaults);
      const coldMs = performance.now() - coldStarted, coldQueries = {...queryCounts};
      plans = warmup.actors.slice(1).map((_, i) => warmup.controllers[i].plan);
      if (plans.length !== route.angles.length || plans.length > 5) {
        fail('exhaustive-roster-mismatch', {route: route.id}, {expected: route.angles.length, actual: plans.length});
      }
      // Runtime-private fields are inspected only by this offline audit; movement still goes through sim.step().
      allPlans.push(...plans);
      targets = route.path.map(point => placePrefireTarget(collision, point));
      views = prefireRouteViews([route.spawn, ...route.path], collision);
      resetQueries();
      const repeatStarted = performance.now();
      new PrefireSimulation(map, practice, route, seeds[0] + 1, defaults);
      const repeatMs = performance.now() - repeatStarted, repeatQueries = {...queryCounts};
      if (repeatQueries.ray || repeatQueries.sweep) fail('planning-cache-repeated', {route: route.id}, {repeatQueries});
      const randomStarted = performance.now(); resetQueries();
      new PrefireSimulation(map, {...practice, population: 'random'}, route, seeds[0] + 2, defaults);
      const randomMs = performance.now() - randomStarted, randomQueries = {...queryCounts};
      const cachedRandomStarted = performance.now(); resetQueries();
      new PrefireSimulation(map, {...practice, population: 'random'}, route, seeds[0] + 2, defaults);
      const cachedRandomMs = performance.now() - cachedRandomStarted, cachedRandomQueries = {...queryCounts};
      if (cachedRandomQueries.ray || cachedRandomQueries.sweep) fail('planning-cache-random-occupancy', {route: route.id}, {cachedRandomQueries});
      planning.push({route: route.id, coldMs: round(coldMs), coldQueries, cachedMs: round(repeatMs), cachedQueries: repeatQueries,
        coldRandomMs: round(randomMs), coldRandomQueries: randomQueries,
        cachedRandomMs: round(cachedRandomMs), cachedRandomQueries, kinds: countKinds(plans)});
    } catch (error) {fail('route-construction', {route: route.id}, {message: error.message}); continue;}

    const appropriateness = [];
    for (const [i, plan] of plans.entries()) {
      const angle = route.angles[i], context = {route: route.id, bot: plan.key}, sampled = sourcePoint(angle.position);
      const assessment = {key: plan.key, requestedKind: prefireBotCatalog[plan.key]?.kind, actualKind: plan.kind,
        lowCoverQualifyingViews: 0, genuineHideViews: 0, peekVisibilityChanges: 0};
      appropriateness.push(assessment);
      if (plan.key !== prefireBotKey(angle)) fail('catalog-identity', context, {expected: prefireBotKey(angle)});
      if (!prefireBotCatalog[plan.key] && !angle.moving && !angle.peek && plan.kind !== 'hold') {
        fail('unspecified-angle-not-holding', context, {kind: plan.kind});
      }
      if (plan.sourceCrouched !== !!angle.crouched) fail('source-stance-changed', context, {});
      const actor = warmup.actors[i + 1];
      const expectedYaw = plan.watchPoint ? Math.atan2(-(plan.watchPoint.x - actor.position.x), -(plan.watchPoint.z - actor.position.z))
        : angle.rotation ? (angle.rotation[1] - 90) * Math.PI / 180 : actor.yaw;
      const expectedPitch = plan.watchPoint ? Math.atan2(plan.watchPoint.y - actor.position.y,
        Math.hypot(plan.watchPoint.x - actor.position.x, plan.watchPoint.z - actor.position.z))
        : angle.rotation ? -angle.rotation[0] * Math.PI / 180 : 0;
      if (Math.abs(angleDelta(actor.yaw, expectedYaw)) > 1e-10 || Math.abs(actor.pitch - expectedPitch) > 1e-10)
        fail('authored-approach-facing-changed', context, {expectedYaw, expectedPitch, yaw: actor.yaw, pitch: actor.pitch});
      if (plan.watchPoint && !views.some(view => gap(view, plan.watchPoint) < 1e-8 && Math.abs(view.y - plan.watchPoint.y) < 1e-8)) {
        fail('watch-point-not-authored-route-view', context, {watchPoint: plan.watchPoint});
      }
      if (plan.anchor.x !== sampled.x || plan.anchor.z !== sampled.z || Math.abs(plan.anchor.y - sampled.y) > 6 * UNIT) {
        fail('source-anchor-relocated', context, {sampled, actual: plan.anchor});
      }
      if (plan.exposure && !validPrefireExcursion(collision, plan.anchor, plan.exposure, plan.sourceCrouched, plans.map(plan => plan.anchor))) {
        fail('unsupported-planned-lane', context, {anchor: plan.anchor, exposure: plan.exposure});
      }
      if (['periodic-peek', 'move-out'].includes(plan.kind) && !plan.exposure) fail('missing-motion-endpoint', context, {});
      if (plan.kind === 'periodic-peek' && plan.exposure) {
        const home = homeOf(plan), attack = attackOf(plan), eye = {...attack, y: attack.y + (plan.sourceCrouched ? 46 : 64) * UNIT};
        assessment.coherentPeekViews = views.filter(view => hasPrefireSight({ray: nativeRay}, eye, view) &&
          !visibleBody(view, home, plan.sourceCrouched, actor.yaw) && !!visibleBody(view, attack, plan.sourceCrouched, actor.yaw)).length;
        if (!assessment.coherentPeekViews) fail('periodic-peek-without-hidden-home-and-firing-view', context, assessment);
      }
      if (plan.kind === 'crouch-hide' && (!collision.fits(plan.anchor, plan.anchor.y, 72 * UNIT) ||
        !views.some(view => hasPrefireSight({ray: nativeRay}, {...plan.anchor, y: plan.anchor.y + 64 * UNIT}, view) &&
          !hasPrefireSight({ray: nativeRay}, {...plan.anchor, y: plan.anchor.y + 46 * UNIT}, view)))) {
        fail('not-actual-low-cover', context, {anchor: plan.anchor});
      }
      if (plan.kind === 'crouch-hide') {
        for (const [viewIndex, view] of views.entries()) {
          const qualifies = hasPrefireSight({ray: nativeRay}, {...plan.anchor, y: plan.anchor.y + 64 * UNIT}, view) &&
            !hasPrefireSight({ray: nativeRay}, {...plan.anchor, y: plan.anchor.y + 46 * UNIT}, view);
          if (!qualifies) continue;
          assessment.lowCoverQualifyingViews++;
          const leak = visibleBody(view, plan.anchor, true, warmup.actors[i + 1].yaw);
          if (!leak && visibleBody(view, plan.anchor, false, warmup.actors[i + 1].yaw)) assessment.genuineHideViews++;
          if (leak) observations.push({code: 'qualifying-low-cover-silhouette-leak', ...context, viewIndex, ...leak});
        }
        if (!assessment.genuineHideViews) fail('crouch-eye-hidden-but-silhouette-visible', context, assessment);
      }
      const laneSteps = plan.exposure ? Math.ceil(gap(plan.anchor, plan.exposure) / (8 * UNIT)) : 0;
      const anchorSight = plan.kind === 'periodic-peek' ? views.map(view => !!visibleBody(view, plan.anchor, plan.sourceCrouched, warmup.actors[i + 1].yaw)) : [];
      for (let step = 0; step <= laneSteps; step++) {
        const t = laneSteps ? step / laneSteps : 0;
        const p = plan.exposure ? {x: plan.anchor.x + (plan.exposure.x - plan.anchor.x) * t,
          y: plan.anchor.y + (plan.exposure.y - plan.anchor.y) * t, z: plan.anchor.z + (plan.exposure.z - plan.anchor.z) * t} : plan.anchor;
        const stances = plan.kind === 'crouch-hide' ? [true, false] : [plan.sourceCrouched];
        for (const crouched of stances) for (const eyeHeight of [46, 64]) {
          const spawnEye = {...views[0], y: views[0].y + (eyeHeight - 64) * UNIT};
          const leak = visibleBody(spawnEye, p, crouched, warmup.actors[i + 1].yaw);
          if (leak) fail('visible-from-covered-start', context, {laneFraction: t, crouched, ...leak});
        }
        if (plan.kind === 'periodic-peek' && step > 0) {
          for (const [index, view] of views.entries()) {
            if (!!visibleBody(view, p, plan.sourceCrouched, warmup.actors[i + 1].yaw) !== anchorSight[index]) assessment.peekVisibilityChanges++;
          }
        }
      }
    }
    planning[planning.length - 1].appropriateness = appropriateness;
    if (planningOnly) continue;

    for (const seed of seeds) {
      const sim = seed === seeds[0] ? warmup : new PrefireSimulation(map, practice, route, seed, defaults);
      sim.actors[0].health = 1e9;
      const metric = {route: route.id, seed, controllerMs: 0, controllerCalls: 0, controllerRays: 0, controllerSamples: [],
        verificationMs: 0, verificationCalls: 0, verificationSamples: [],
        stepSamples: [], botKinds: countKinds(plans), shots: 0, hitsOnPlayer: 0, reloads: 0, playerDistance: 0,
        waypointsReached: [], playerDetours: [], botDistance: 0, minSpacingUnits: Infinity, bots: plans.map((plan, i) => ({key: plan.key, kind: plan.kind,
          homeYaw: sim.actors[i + 1].yaw, homePitch: sim.actors[i + 1].pitch, phase: 'waiting', phaseAt: 0,
          exposed: 0, returns: 0, peekSightChanges: 0, peekBodyChanges: 0,
          maxExcursion: 0, maxSpeedUnits: 0, airborneTicks: 0, settledJitter: 0,
          shots: 0, bursts: [], shotTimes: [], firingOpportunities: 0, hiddenAimChecks: 0, stanceMin: 1, stanceMax: 0,
          phaseSeconds: {}, hiddenMemoryAimChecks: 0, routePreAimChecks: 0, sourceFacingChecks: 0,
          walkCommandTicks: 0, movementInputTicks: 0, counterstrafeTicks: 0, contactHoldSeconds: 0,
          outboundAttempts: 0, completedSwings: 0}))};
      let waypoint = 0, dwellUntil = 0, bestGap = Infinity, progressAt = 0, finished = false, detours = [], detourRetryAt = 0;
      activeRun = metric; resetQueries(); sim.start();
      const simStarted = performance.now();
      while (sim.time + 1e-9 < seconds && sim.phase === 'fighting') {
        const player = sim.actors[0], target = detours[0] ?? targets[waypoint];
        const remaining = gap(player.position, target), speed = Math.hypot(player.velocity.x, player.velocity.z);
        const command = idleCommand(); command.walk = true;
        const yaw = heading(player.position, target); command.yawDelta = angleDelta(player.yaw, yaw);
        const occupying = !detours.length && sim.actors.slice(1).find(bot => Math.abs(bot.feet - target.y) < 54 * UNIT &&
          Math.max(Math.abs(bot.position.x - target.x), Math.abs(bot.position.z - target.z)) < 32 * UNIT &&
          hasPrefireSight({ray: nativeRay}, player.position, bot.position));
        const stopRadius = occupying ? 32 * UNIT + gap(occupying.position, target) + .05 : .18;
        let advancedWaypoint = false;
        if (finished) {
          command.forward = 0;
        } else if (remaining < stopRadius && speed < .12) {
          if (detours.length) {detours.shift(); bestGap = Infinity; progressAt = sim.time; advancedWaypoint = true;}
          else {
            if (!dwellUntil) {dwellUntil = sim.time + 2; metric.waypointsReached.push({index: waypoint, at: round(sim.time),
              stopGapUnits: round(remaining / UNIT), occupiedBy: occupying ? sim.prefireBotDecision(occupying.id)?.key : undefined});}
            if (sim.time >= dwellUntil) {
              if (waypoint === targets.length - 1) {finished = true; metric.routeCompletedAt = round(sim.time);}
              else waypoint++;
              dwellUntil = 0; bestGap = Infinity; progressAt = sim.time; advancedWaypoint = true;
            }
          }
        } else if (remaining < stopRadius - .08 + speed * .075) command.forward = speed > .12 ? -1 : 0;
        else command.forward = 1;
        if (!advancedWaypoint && remaining < bestGap - .05) {bestGap = remaining; progressAt = sim.time;}
        if (!finished && !detours.length && !dwellUntil && sim.time >= detourRetryAt && sim.time - progressAt > 1) {
          detourRetryAt = sim.time + 1;
          const blocker = sim.actors.slice(1).filter(bot => gap(bot.position, player.position) < 1.7)
            .sort((a, b) => gap(a.position, player.position) - gap(b.position, player.position))[0];
          const bypass = blocker && detourAround(sim, blocker, target);
          if (bypass) {
            detours = bypass; bestGap = Infinity; progressAt = sim.time;
            metric.playerDetours.push({at: round(sim.time), waypoint, bot: sim.prefireBotDecision(blocker.id)?.key, points: bypass});
          }
        }
        if (!finished && sim.time - progressAt > 12 && !dwellUntil && !failureKeys.has(`blocked-player-route/${route.id}/${seed}/`)) {
          const staticSweep = collision.sweep(feetOf(player), target, 72 * UNIT);
          fail('blocked-player-route', {route: route.id, seed}, {time: round(sim.time), waypoint, target: route.path[waypoint],
            actual: feetOf(player), gap: round(remaining), nativeStaticSweepFraction: staticSweep.fraction,
            nearbyBots: sim.actors.slice(1).filter(bot => gap(bot.position, player.position) < 2)
              .map(bot => ({key: sim.prefireBotDecision(bot.id)?.key, feet: feetOf(bot)}))});
        }
        sim.command(0, command);
        const before = sim.actors.map(actor => ({position: {...actor.position}, feet: actor.feet}));
        const stepStarted = performance.now(); sim.step();
        if (sim.tick % 128 === 0) metric.stepSamples.push(performance.now() - stepStarted);
        metric.playerDistance += gap(player.position, before[0].position);
        for (const [i, actor] of sim.actors.slice(1).entries()) {
          const bot = metric.bots[i], decision = sim.prefireBotDecision(actor.id), context = {route: route.id, seed, bot: bot.key};
          const distance = gap(actor.position, before[actor.id].position), velocity = Math.hypot(actor.velocity.x, actor.velocity.z);
          metric.botDistance += distance; bot.maxSpeedUnits = Math.max(bot.maxSpeedUnits, velocity / UNIT);
          bot.maxExcursion = Math.max(bot.maxExcursion, gap(actor.position, plans[i].anchor));
          bot.stanceMin = Math.min(bot.stanceMin, actor.duckAmount ?? 0); bot.stanceMax = Math.max(bot.stanceMax, actor.duckAmount ?? 0);
          if (!actor.grounded) {bot.airborneTicks++; fail('bot-false-air-or-fall', context, {time: sim.time, feet: actor.feet, phase: decision.phase});}
          if (distance > 225 * UNIT * STEP + .002) fail('nonphysical-bot-displacement', context, {time: sim.time, distance, velocity});
          if (decision.phase !== bot.phase) {
            if (decision.phase === 'exposed') bot.exposed++;
            if (decision.phase === 'waiting' && bot.phase === 'retreating') bot.returns++;
            bot.phase = decision.phase; bot.phaseAt = sim.time;
          }
          if (['waiting', 'exposed', 'holding'].includes(bot.phase) && sim.time - bot.phaseAt > .3) {
            bot.settledJitter = Math.max(bot.settledJitter, distance);
            if (distance > .001 || velocity > .12) fail('endpoint-jitter', context, {time: sim.time, phase: bot.phase, distance, velocity});
          }
          if (sim.tick % 16 === 0) {
            const height = (72 - 18 * stanceCurve(actor.duckAmount ?? 0)) * UNIT;
            const support = collision.vertical(actor.position, actor.feet + .001, actor.feet - .02, height);
            if (!collision.fits(actor.position, actor.feet, height) || !support.grounded || Math.abs(support.feet - actor.feet) > .002) {
              fail('bot-native-hull-or-support', context, {time: sim.time, actual: feetOf(actor), height, support});
            }
          }
          if (bot.kind === 'periodic-peek' && sim.tick % 128 === 0) {
            const eye = p => ({...p, y: p.y + (plans[i].sourceCrouched ? 46 : 64) * UNIT});
            if (hasPrefireSight({ray: nativeRay}, player.position, eye(plans[i].anchor)) !==
              hasPrefireSight({ray: nativeRay}, player.position, eye(plans[i].exposure))) bot.peekSightChanges++;
            if (!bot.peekBodyChanges && !appropriateness[i].peekVisibilityChanges &&
              !!visibleBody(player.position, plans[i].anchor, plans[i].sourceCrouched, actor.yaw) !==
              !!visibleBody(player.position, plans[i].exposure, plans[i].sourceCrouched, actor.yaw)) bot.peekBodyChanges++;
          }
          for (const other of sim.actors.slice(actor.id + 1)) if (Math.abs(actor.feet - other.feet) < 54 * UNIT) {
            const separation = Math.max(Math.abs(actor.position.x - other.position.x), Math.abs(actor.position.z - other.position.z));
            metric.minSpacingUnits = Math.min(metric.minSpacingUnits, separation / UNIT);
            if (separation < 32 * UNIT - .002) fail('bot-overlap', context, {time: sim.time, other: other.id, separationUnits: separation / UNIT});
          }
        }
        for (const event of sim.drainEvents()) {
          if (event.kind === 'action' && event.actorId > 0 && event.action === 'reload-start') metric.reloads++;
          if (event.kind === 'hit' && event.victim === 0) metric.hitsOnPlayer++;
          if (event.kind !== 'fire' || event.actorId === 0) continue;
          const bot = metric.bots[event.actorId - 1], actor = sim.actors[event.actorId], intent = bot.lastCommand;
          const context = {route: route.id, seed, bot: bot.key};
          metric.shots++; bot.shots++; bot.shotTimes.push(sim.time);
          const priorBurst = bot.bursts[bot.bursts.length - 1];
          if (!priorBurst || sim.time - priorBurst.lastAt > .3) bot.bursts.push({count: 1, firstAt: sim.time, lastAt: sim.time});
          else {priorBurst.count++; priorBurst.lastAt = sim.time;}
          if (bot.bursts[bot.bursts.length - 1].count > 4) fail('unbounded-burst', context, {time: sim.time, burst: bot.bursts[bot.bursts.length - 1]});
          if (!hasPrefireSight({ray: nativeRay}, event.origin, headOf(player))) fail('actual-shot-blocked-los', context,
            {time: sim.time, origin: event.origin, player: {...player.position}, intent});
          if (intent.speed >= .12 || intent.grounded === false || intent.reloading ||
            !(['holding', 'exposed'].includes(intent.phase) || intent.phase === 'waiting' && bot.kind !== 'crouch-hide' && intent.visible)) {
            fail('shot-not-stopped-ready', context, {time: sim.time, intent});
          }
          if (bot.kind === 'crouch-hide' && intent.duck >= .05) fail('shot-during-unduck', context, {time: sim.time, intent});
          if (!actor.alive) fail('bot-dead-in-passive-audit', context, {time: sim.time});
        }
      }
      activeRun = undefined;
      if (sim.time + STEP < seconds) fail('early-round-end', {route: route.id, seed}, {seconds: sim.time, phase: sim.phase, playerAlive: sim.actors[0].alive});
      if (seconds >= 60 && !metric.shots) fail('no-native-return-fire', {route: route.id, seed}, {waypointsReached: metric.waypointsReached});
      if (seconds >= 60 && new Set(metric.waypointsReached.map(point => point.index)).size !== targets.length) fail('route-not-completed', {route: route.id, seed},
        {reached: metric.waypointsReached, expected: targets.length});
      for (const bot of metric.bots) {
        const context = {route: route.id, seed, bot: bot.key};
        const takes = takesAngle(plans[metric.bots.indexOf(bot)]);
        if (seconds >= 15 && ['periodic-peek', 'move-out'].includes(bot.kind) && bot.contactHoldSeconds === 0 &&
          (bot.maxExcursion < 16 * UNIT || !bot.exposed || !takes && !bot.returns)) {
          fail('movement-never-completes', context, {maxExcursion: bot.maxExcursion, exposed: bot.exposed, returns: bot.returns});
        }
        if (seconds >= 3 && bot.kind === 'crouch-hide' && (bot.stanceMin > .05 || bot.stanceMax < .95)) fail('not-actual-crouch-hide', context, {min: bot.stanceMin, max: bot.stanceMax});
        if (seconds >= 60 && bot.kind === 'periodic-peek' && !bot.peekBodyChanges && !appropriateness.find(item => item.key === bot.key)?.peekVisibilityChanges) {
          fail('periodic-peek-without-cover-change', context, {anchor: plans[metric.bots.indexOf(bot)].anchor, eyeOnlySightChanges: bot.peekSightChanges});
        }
      }
      const wallMs = performance.now() - simStarted;
      const output = {route: route.id, seed, seconds: sim.time, ticks: sim.tick, wallMs: round(wallMs),
        controller: {...distribution(metric.controllerSamples), calls: metric.controllerCalls, totalMs: round(metric.controllerMs),
          usPerBotTick: round(metric.controllerMs * 1000 / metric.controllerCalls), msPerFiveBotFrame60Hz: round(metric.controllerMs / sim.time / 60),
          nativeRaysPerBotSecond: round(metric.controllerRays / (sim.time * plans.length))},
        postMovementVerification: {...distribution(metric.verificationSamples), calls: metric.verificationCalls, totalMs: round(metric.verificationMs)},
        simStep: distribution(metric.stepSamples), nativeQueries: {...queryCounts}, kinds: metric.botKinds,
        shots: metric.shots, hitsOnPlayer: metric.hitsOnPlayer, reloads: metric.reloads, playerDistanceUnits: round(metric.playerDistance / UNIT),
        reached: metric.waypointsReached, routeCompletedAt: metric.routeCompletedAt, playerDetours: metric.playerDetours,
        minBotSpacingUnits: round(metric.minSpacingUnits),
        bots: metric.bots.map(bot => ({key: bot.key, kind: bot.kind, shots: bot.shots, burstSizes: bot.bursts.map(burst => burst.count),
          exposed: bot.exposed, returns: bot.returns, peekSightChanges: bot.peekSightChanges, peekBodyChanges: bot.peekBodyChanges,
          excursionUnits: round(bot.maxExcursion / UNIT), maxSpeedUnits: round(bot.maxSpeedUnits),
          airborneTicks: bot.airborneTicks, maxSettledJitterUnits: round(bot.settledJitter / UNIT), hiddenAimChecks: bot.hiddenAimChecks,
          phaseSeconds: bot.phaseSeconds, walkCommandTicks: bot.walkCommandTicks, counterstrafeTicks: bot.counterstrafeTicks,
          completedSwings: bot.completedSwings, contactHoldSeconds: bot.contactHoldSeconds,
          minDuck: round(bot.stanceMin), maxDuck: round(bot.stanceMax)}))};
      runs.push(output);
      console.error(JSON.stringify({route: route.id, seed, seconds: sim.time, wallMs: output.wallMs, shots: output.shots,
        kinds: output.kinds, failureCount: failures.length}));
    }
  }
  const kinds = countKinds(allPlans);
  const genuineCrouchHiders = planning.flatMap(item => item.appropriateness).filter(item => item.actualKind === 'crouch-hide' && item.genuineHideViews > 0).length;
  const coverChangingPeeks = new Set(planning.flatMap(item => item.appropriateness).filter(item => item.actualKind === 'periodic-peek' && item.peekVisibilityChanges > 0).map(item => item.key));
  for (const run of runs) for (const bot of run.bots) if (bot.kind === 'periodic-peek' && bot.peekBodyChanges) coverChangingPeeks.add(bot.key);
  if (selectedRoutes.length === routeCount) for (const [kind, count] of Object.entries(kinds)) {
    if (!count) fail('missing-actual-behavior', {}, {kind, counts: kinds});
  }
  const report = {version: 1, build: manifest.build, collisionSha256: binarySha256, sourceSha256, seeds, requestedSeconds: seconds,
    completeDuration: !planningOnly && seconds === 180, fullCoverage: !planningOnly && selectedRoutes.length === routeCount,
    allCoursesTraversed: !planningOnly && runs.length === selectedRoutes.length * seeds.length &&
      runs.every(run => run.routeCompletedAt !== undefined),
    selectedRoutes: selectedRoutes.map(route => route.id), planningOnly,
    routes: routeCount, angles: angleCount, uniqueSources, nativeLoadMs: round(nativeLoadMs),
    wallMs: round(performance.now() - started), actualKinds: kinds, genuineCrouchHiders,
    coverChangingPeriodicPeeks: coverChangingPeeks.size, planning, runs, observations, diagnostics, failures,
    notes: ['CPU timings are local Node/native-query timings, not browser render FPS.',
      'Silhouette grids run only offline; controller timings exclude audit validation.',
      'Player follows authored waypoints through real simulation commands with 1e9 health; no LOS or pawn relocation overrides.',
      'One forward course pass, then an end-position hold. Live bot-occupied waypoints are approached to hull clearance with native sight; supported local detours use shared native movement and actor hulls.',
      'Cold planning means first simulation construction per collision/route/mode; repeat seeds/random occupancy must issue zero planning rays/sweeps.']};
  if (arg('report')) {
    const reportPath = path.resolve(root, arg('report'));
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({reportPath, wallMs: report.wallMs, actualKinds: kinds, genuineCrouchHiders,
      coverChangingPeriodicPeeks: coverChangingPeeks.size, failures, observations, diagnostics}, null, 2));
  } else console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  restoreController?.(); restoreVerification?.(); collision?.dispose(); await vite.close();
}
