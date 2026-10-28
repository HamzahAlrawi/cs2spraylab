// Offline behavioral evidence, using real rosters, native collision and sim.step().
// node tools/audit-prefire-encounters.mjs --routes=long-doors,short-a,b-tunnels --seconds=90 --report=tmp/encounters.json
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {createServer} from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEG = Math.PI / 180;
export const qualityLimits = Object.freeze({
  sampleTicks: 8, settledYawDegrees: 5, oppositeYawDegrees: 90, contactGraceSeconds: .25,
  aimSettleSeconds: .6, responseExtraSeconds: .8, radialLaneFraction: .65,
  settledSpeedUnits: 10, settledPhaseSeconds: .35, stalledSeconds: 12,
});
export const horizontalGap = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
export const heading = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export const gazeError = (actor, point) => ({
  yaw: Math.abs(angleDelta(actor.yaw, heading(actor.position, point))) / DEG,
  pitch: Math.abs(actor.pitch - Math.atan2(point.y - actor.position.y, horizontalGap(actor.position, point))) / DEG,
});
export function lateralAlignment(from, to, threat) {
  const length = horizontalGap(from, to), range = horizontalGap(from, threat);
  if (length < 1e-8 || range < 1e-8) return null;
  const radial = ((to.x - from.x) * (threat.x - from.x) + (to.z - from.z) * (threat.z - from.z)) / (length * range);
  return {signedRadial: radial, radial: Math.abs(radial), lateral: Math.sqrt(Math.max(0, 1 - radial * radial))};
}
export function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = fraction => sorted.length ? sorted[Math.floor((sorted.length - 1) * fraction)] : null;
  return {samples: sorted.length, p50: at(.5), p95: at(.95), max: at(1)};
}
const round = value => Number.isFinite(value) ? +value.toFixed(4) : null;
const feetOf = actor => ({...actor.position, y: actor.feet});
const speedOf = actor => Math.hypot(actor.velocity.x, actor.velocity.z);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sourceFiles = [
  'src/range/prefire/bot-controller.ts', 'src/range/prefire/bot-behavior.ts', 'src/range/prefire/session.ts',
  'src/range/prefire/routes.ts', 'src/range/prefire/occupancy.ts', 'src/range/prefire/native-collision.ts',
  'src/range/prefire/placement.ts', 'src/range/duel/simulation.ts', 'src/range/actor-physics.ts',
  'src/range/actor-collision.ts', 'src/range/duel/geometry.ts', 'src/range/prefire/data/dust2-weighted-pools.json',
  'src/range/prefire/config.ts', 'src/range/config.ts', 'src/range/actor-contact.ts', 'src/range/duel/traversal.ts',
];
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]));

// Public body geometry plus native shot blockers, deliberately ignoring the
// controller's visibility, desired yaw, watch point and internal contact memory.
export function visiblePlayerPoint(observer, target, collision, traceActor, actorHeadPoint) {
  if (!target.alive) return undefined;
  const feet = feetOf(target), duck = target.duckAmount ?? 0;
  const head = actorHeadPoint(feet, duck, target.yaw);
  const chestY = feet.y + 1.27 - .35 * duck;
  const points = [head, {...feet, y: chestY}, {...feet, y: chestY, x: feet.x - .22},
    {...feet, y: chestY, x: feet.x + .22}, {...feet, y: feet.y + .92 - .3 * duck}];
  for (const point of points) {
    const distance = Math.hypot(point.x - observer.position.x, point.y - observer.position.y, point.z - observer.position.z);
    if (distance < .01) continue;
    const direction = {x: (point.x - observer.position.x) / distance, y: (point.y - observer.position.y) / distance,
      z: (point.z - observer.position.z) / distance};
    const hit = traceActor(observer.position, direction, feet, duck, distance + .4, target.yaw);
    if (!hit.group || !Number.isFinite(hit.distance) || collision.ray(observer.position, direction, hit.distance - .0001)) continue;
    return {point, hitgroup: hit.group};
  }
  return undefined;
}

export function parseOptions(argv) {
  const arg = name => argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const list = (name, fallback) => (arg(name) ?? fallback).split(',');
  const options = {routes: list('routes', 'long-doors,short-a,b-tunnels'), seeds: list('seeds', '7').map(Number),
    populations: list('population', 'all,random'), returnFire: list('return-fire', 'off,on'),
    seconds: Number(arg('seconds') ?? 90), reactionMs: Number(arg('reaction-ms') ?? 750),
    dwellSeconds: Number(arg('dwell') ?? 3), report: arg('report'), enforce: argv.includes('--enforce')};
  if (!options.seeds.length || options.seeds.some(seed => !Number.isSafeInteger(seed)) ||
    new Set(options.seeds).size !== options.seeds.length || !Number.isFinite(options.seconds) || options.seconds <= 0 || options.seconds > 180 ||
    options.populations.some(value => !['all', 'random'].includes(value)) || options.returnFire.some(value => !['off', 'on'].includes(value)) ||
    !(options.reactionMs >= 300 && options.reactionMs <= 2500) || !(options.dwellSeconds >= 1 && options.dwellSeconds <= 10)) {
    throw new Error('Invalid audit options: integer seeds, seconds (0,180], population all/random, return-fire off/on, reaction 300..2500 ms, dwell 1..10 s.');
  }
  return options;
}

export async function audit(options) {
  const initialHashes = hashes(), auditSha256 = sha256(fs.readFileSync(fileURLToPath(import.meta.url))), started = performance.now();
  const vite = await createServer({root, server: {middlewareMode: true, hmr: false, ws: false}, appType: 'custom', logLevel: 'error'});
  let collision;
  try {
    const {NativeMapCollision} = await vite.ssrLoadModule('/src/range/prefire/native-collision.ts');
    const {PrefireSimulation} = await vite.ssrLoadModule('/src/range/prefire/session.ts');
    const {dust2Catalog, prefireRoutes} = await vite.ssrLoadModule('/src/range/prefire/routes.ts');
    const {placePrefireTarget} = await vite.ssrLoadModule('/src/range/prefire/placement.ts');
    const {sanitizePrefireConfig} = await vite.ssrLoadModule('/src/range/prefire/config.ts');
    const {defaults} = await vite.ssrLoadModule('/src/range/config.ts');
    const {STEP, UNIT, groundVelocity} = await vite.ssrLoadModule('/src/range/actor-physics.ts');
    const {moveOnTerrain} = await vite.ssrLoadModule('/src/range/actor-collision.ts');
    const {actorContactSolids} = await vite.ssrLoadModule('/src/range/actor-contact.ts');
    const {idleCommand} = await vite.ssrLoadModule('/src/range/duel/types.ts');
    const {actorHeadPoint, traceActor} = await vite.ssrLoadModule('/src/range/duel/geometry.ts');
    const importedHashes = hashes();
    if (options.routes.some(id => !prefireRoutes.some(route => route.id === id))) throw new Error('Unknown route ID. Use a current consolidated approach ID.');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/revamp/maps/dust2/collision.json'), 'utf8'));
    const bytes = fs.readFileSync(path.join(root, 'public/revamp/maps/dust2/collision.bin'));
    const collisionSha256 = sha256(bytes);
    if (manifest.collisionSha256 !== collisionSha256) throw new Error('Native collision checksum mismatch.');
    collision = await NativeMapCollision.create(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const queries = {ray: 0, sweep: 0, fits: 0, vertical: 0};
    for (const name of Object.keys(queries)) {
      const native = collision[name].bind(collision);
      collision[name] = (...args) => {queries[name]++; return native(...args);};
    }
    const map = {scene: new THREE.Group(), collision, dispose() {}, settle: point => placePrefireTarget(collision, point)};
    const runs = [], failures = [], observations = [];
    const context = (run, metric) => ({route: run.route, seed: run.seed, population: run.population,
      returnFire: run.returnFire, bot: metric?.key});
    const emit = (code, run, metric, frame, detail = {}) => {
      const item = {code, ...context(run, metric), ...frame, ...detail};
      const existing = failures.find(failure => failure.code === code && failure.route === run.route &&
        failure.seed === run.seed && failure.population === run.population && failure.returnFire === run.returnFire && failure.bot === metric?.key);
      if (!existing) failures.push(item);
    };
    const worldWish = (command, yaw, x, z) => {
      command.side = x * Math.cos(yaw) - z * Math.sin(yaw);
      command.forward = -x * Math.sin(yaw) - z * Math.cos(yaw);
    };
    const playerBrake = (actor, command) => {
      const speed = speedOf(actor);
      if (speed < .12) return;
      const maximum = actor.weapon.actions.stats.speed * UNIT;
      const next = groundVelocity(actor.velocity.x, actor.velocity.z, -actor.velocity.x / speed, -actor.velocity.z / speed,
        maximum * .52 * actor.velocityModifier, STEP, {weaponSpeed: maximum, walking: true, ducking: false});
      if (next.x * actor.velocity.x + next.z * actor.velocity.z > 0) worldWish(command, actor.yaw + command.yawDelta,
        -actor.velocity.x / speed, -actor.velocity.z / speed);
    };
    const walkable = (from, to, sim) => {
      let p = {...from};
      const world = {floor: null, solids: actorContactSolids(sim.actors, 0), native: collision};
      const steps = Math.ceil(horizontalGap(p, to) / .05);
      if (steps > 500) return undefined;
      for (let i = 0; i < steps; i++) {
        const distance = horizontalGap(p, to), step = Math.min(.05, distance);
        if (distance < .01) break;
        const next = moveOnTerrain(p, {x: p.x + (to.x - p.x) / distance * step, y: p.y,
          z: p.z + (to.z - p.z) / distance * step}, 72 * UNIT, world, true);
        if (!next.grounded || horizontalGap(p, next.position) < .0001) return undefined;
        p = next.position;
      }
      return horizontalGap(p, to) < .05 ? p : undefined;
    };
    const bypass = (sim, blocker, target) => {
      const start = feetOf(sim.actors[0]), alongZ = Math.abs(target.z - start.z) >= Math.abs(target.x - start.x), candidates = [];
      for (const radius of [1.15, 1.45, 1.8]) for (const side of [-1, 1]) {
        const a = alongZ ? {...start, x: blocker.position.x + side * radius} : {...start, z: blocker.position.z + side * radius};
        const b = alongZ ? {...a, z: blocker.position.z + Math.sign(target.z - blocker.position.z) * radius}
          : {...a, x: blocker.position.x + Math.sign(target.x - blocker.position.x) * radius};
        const first = walkable(start, a, sim), second = first && walkable(first, b, sim);
        if (second && walkable(second, target, sim)) candidates.push({points: [first, second],
          length: horizontalGap(start, first) + horizontalGap(first, second) + horizontalGap(second, target)});
      }
      return candidates.sort((a, b) => a.length - b.length)[0]?.points;
    };
    const sampleInterval = qualityLimits.sampleTicks * STEP;
    for (const id of options.routes) for (const population of options.populations) for (const seed of options.seeds) for (const fire of options.returnFire) {
      const route = prefireRoutes.find(route => route.id === id), returnFire = fire === 'on';
      const practice = sanitizePrefireConfig({routeId: id, population, botsPerRun: 5, botBehavior: 'angle-specific',
        returnFire, tradeEnabled: false, reactionMs: options.reactionMs});
      const beforePlanningQueries = {...queries};
      const constructionAt = performance.now();
      const sim = new PrefireSimulation(map, practice, route, seed, defaults, dust2Catalog.density);
      // Offline survival fixture only: shots, recoil, reload, tagging, punch and
      // movement still run normally. The player never damages/kills test bots.
      sim.actors[0].health = 1e9;
      const controllers = sim.controllers;
      if (!controllers || controllers.length !== sim.actors.length - 1 || controllers.length > 5) throw new Error('Roster/controller contract changed.');
      const run = {route: id, seed, population, returnFire, planningMs: round(performance.now() - constructionAt),
        planningQueries: Object.fromEntries(Object.keys(queries).map(name => [name, queries[name] - beforePlanningQueries[name]])),
        roster: controllers.map(controller => controller.plan.key), reached: [], detours: [], events: {shots: 0, hits: 0, reloads: 0},
        bots: controllers.map((controller, index) => {
          const actor = sim.actors[index + 1], plan = controller.plan;
          const home = plan.attackFromAnchor && plan.exposure ? plan.exposure : plan.anchor;
          const attack = plan.attackFromAnchor ? plan.anchor : plan.exposure;
          return {key: plan.key, kind: plan.kind, intent: plan.intent ?? null, anchor: plan.anchor, home, attack,
            watchPoint: plan.watchPoint ?? null, plannedAlignment: attack && plan.watchPoint ? lateralAlignment(home, attack, plan.watchPoint) : null,
            phase: sim.prefireBotDecision(actor.id).phase, phaseAt: 0, phaseSeconds: {},
            observedSeconds: 0, headVisibleSeconds: 0, oppositeSeconds: 0, wrongAfterGraceSeconds: 0, frontContactSeconds: 0,
            yawErrors: [], settledYawErrors: [], pitchErrors: [], settlingMs: [], firstShotMs: [],
            unansweredContacts: [], contacts: [], currentContact: null, worstFrames: [],
            playerSeesBotSeconds: 0, exposureChanges: 0, returns: 0, swings: 0, shots: 0,
            distanceUnits: 0, maxExcursionUnits: 0, speedUnits: [], observedRadial: [], outboundRadial: [],
            settledMaxSpeedUnits: 0, settledDriftUnits: 0, brakingReversals: [], reverseWindow: [],
            lastSampleVelocity: {...actor.velocity}, lastSeenFromPlayer: null, movementLeg: null, legs: []};
        })};
      const targets = sim.route.path.map(point => placePrefireTarget(collision, point));
      let waypoint = 0, dwellUntil = 0, finished = false, bestGap = Infinity, progressedAt = 0, detours = [], retryAt = 0;
      sim.start();
      const simStarted = performance.now();
      while (sim.time + 1e-9 < options.seconds && sim.phase === 'fighting') {
        const player = sim.actors[0], target = detours[0] ?? targets[waypoint], command = idleCommand();
        const distance = horizontalGap(player.position, target), speed = speedOf(player);
        command.walk = true; command.yawDelta = angleDelta(player.yaw, heading(player.position, target));
        const occupied = !detours.length && sim.actors.slice(1).find(actor => actor.alive && Math.abs(actor.feet - target.y) < 54 * UNIT &&
          Math.max(Math.abs(actor.position.x - target.x), Math.abs(actor.position.z - target.z)) < 32 * UNIT);
        const radius = occupied ? 32 * UNIT + horizontalGap(occupied.position, target) + .08 : .16;
        let advanced = false;
        if (finished || dwellUntil > sim.time) playerBrake(player, command);
        else if (distance <= radius && speed < .12) {
          if (detours.length) {detours.shift(); advanced = true;}
          else if (!dwellUntil) {
            dwellUntil = sim.time + options.dwellSeconds;
            run.reached.push({index: waypoint, time: round(sim.time), gapUnits: round(distance / UNIT), occupiedBy: occupied?.id});
          } else {
            if (waypoint === targets.length - 1) {finished = true; run.completedAt = round(sim.time);}
            else waypoint++;
            dwellUntil = 0; advanced = true;
          }
        } else if (distance < radius + speed * .075) playerBrake(player, command);
        else command.forward = 1;
        if (advanced) {bestGap = Infinity; progressedAt = sim.time;}
        if (distance < bestGap - .05) {bestGap = distance; progressedAt = sim.time;}
        if (!finished && !detours.length && !dwellUntil && sim.time - progressedAt > 1 && sim.time >= retryAt) {
          retryAt = sim.time + 1;
          const blocker = sim.actors.slice(1).filter(actor => actor.alive && horizontalGap(actor.position, player.position) < 1.7)
            .sort((a, b) => horizontalGap(a.position, player.position) - horizontalGap(b.position, player.position))[0];
          const points = blocker && bypass(sim, blocker, target);
          if (points) {detours = points; bestGap = Infinity; progressedAt = sim.time;
            run.detours.push({time: round(sim.time), waypoint, bot: sim.prefireBotDecision(blocker.id).key, points});}
        }
        if (!finished && !dwellUntil && sim.time - progressedAt > qualityLimits.stalledSeconds) emit('player-route-stalled', run, null,
          {time: round(sim.time), tick: sim.tick, waypoint, player: feetOf(player), target, gapUnits: round(distance / UNIT)});
        sim.command(0, command);
        const before = sim.actors.map(actor => ({position: {...actor.position}, velocity: {...actor.velocity}, feet: actor.feet}));
        sim.step();
        const events = sim.drainEvents();
        for (const event of events) {
          if (event.kind === 'fire' && event.actorId > 0) {
            run.events.shots++; const metric = run.bots[event.actorId - 1]; metric.shots++;
            if (!returnFire) emit('silent-bot-fired', run, metric, {time: round(sim.time), tick: sim.tick});
            if (metric.currentContact && metric.currentContact.shotAt === null) {
              metric.currentContact.shotAt = sim.time; metric.firstShotMs.push((sim.time - metric.currentContact.startedAt) * 1000);
            }
          }
          if (event.kind === 'hit' && event.victim === 0) run.events.hits++;
          if (event.kind === 'action' && event.actorId > 0 && event.action === 'reload-start') run.events.reloads++;
        }
        for (const actor of sim.actors.slice(1)) {
          const metric = run.bots[actor.id - 1], decision = sim.prefireBotDecision(actor.id);
          const delta = horizontalGap(before[actor.id].position, actor.position), speedUnits = speedOf(actor) / UNIT;
          metric.distanceUnits += delta / UNIT;
          metric.maxExcursionUnits = Math.max(metric.maxExcursionUnits, horizontalGap(actor.position, metric.home) / UNIT);
          metric.phaseSeconds[decision.phase] = (metric.phaseSeconds[decision.phase] ?? 0) + STEP;
          if (delta > 250 * UNIT * STEP + .002) emit('nonphysical-displacement', run, metric, {time: round(sim.time), tick: sim.tick, deltaUnits: delta / UNIT});
          if (!actor.grounded) emit('lost-native-support', run, metric, {time: round(sim.time), tick: sim.tick, feet: actor.feet});
          if (decision.phase !== metric.phase) {
            if (metric.movementLeg) {metric.movementLeg.end = feetOf(actor); metric.movementLeg.endAt = sim.time;
              metric.movementLeg.displacementUnits = horizontalGap(metric.movementLeg.start, metric.movementLeg.end) / UNIT;
              metric.legs.push(metric.movementLeg); metric.movementLeg = null;}
            if (decision.phase === 'outbound') {metric.swings++; metric.movementLeg = {phase: 'outbound', start: feetOf(actor), startedAt: sim.time};}
            if (decision.phase === 'retreating') metric.movementLeg = {phase: 'retreating', start: feetOf(actor), startedAt: sim.time};
            if (metric.phase === 'retreating' && ['holding', 'waiting'].includes(decision.phase)) metric.returns++;
            metric.phase = decision.phase; metric.phaseAt = sim.time;
          }
          if (['holding', 'waiting', 'exposed'].includes(metric.phase) && sim.time - metric.phaseAt > qualityLimits.settledPhaseSeconds) {
            metric.settledMaxSpeedUnits = Math.max(metric.settledMaxSpeedUnits, speedUnits);
            metric.settledDriftUnits = Math.max(metric.settledDriftUnits, delta / UNIT);
            if (speedUnits > qualityLimits.settledSpeedUnits) emit('settled-endpoint-jitter', run, metric,
              {time: round(sim.time), tick: sim.tick, phase: decision.phase, speedUnits: round(speedUnits), deltaUnits: round(delta / UNIT)});
          }
          if (sim.tick % qualityLimits.sampleTicks !== 0) continue;
          const visible = visiblePlayerPoint(actor, player, collision, traceActor, actorHeadPoint);
          const playerView = visiblePlayerPoint(player, actor, collision, traceActor, actorHeadPoint);
          metric.speedUnits.push(speedUnits);
          if (playerView) metric.playerSeesBotSeconds += sampleInterval;
          if (metric.lastSeenFromPlayer !== null && metric.lastSeenFromPlayer !== !!playerView) metric.exposureChanges++;
          metric.lastSeenFromPlayer = !!playerView;
          const sampleFrame = {time: round(sim.time), tick: sim.tick, phase: decision.phase, actor: {...actor.position},
            player: {...player.position}, yawDegrees: round(actor.yaw / DEG), speedUnits: round(speedUnits),
            controllerVisible: decision.visible, controllerSeenAt: decision.seenAt, playerVisible: !!visible, playerSeesBot: !!playerView,
            ammo: actor.weapon.ammo, reserve: actor.weapon.reserve, reloadUntil: actor.weapon.reloadUntil,
            nextShotAt: actor.weapon.nextShotAt, equipReadyAt: actor.equipReadyAt, duckAmount: actor.duckAmount,
            command: {forward: actor.command.forward, side: actor.command.side, crouch: actor.command.crouch,
              fireHeld: actor.command.fireHeld, reloadPressed: actor.command.reloadPressed}};
          const previousSpeed = Math.hypot(metric.lastSampleVelocity.x, metric.lastSampleVelocity.z) / UNIT;
          if (speedUnits > 5 && previousSpeed > 5 && actor.velocity.x * metric.lastSampleVelocity.x + actor.velocity.z * metric.lastSampleVelocity.z < 0) {
            metric.reverseWindow = metric.reverseWindow.filter(time => sim.time - time < .4);
            metric.reverseWindow.push(sim.time);
            metric.brakingReversals.push(sampleFrame);
            if (metric.reverseWindow.length > 2 && sim.time - metric.phaseAt > .35) emit('repeated-velocity-reversal', run, metric, sampleFrame);
          }
          metric.lastSampleVelocity = {...actor.velocity};
          if (!visible) {
            if (metric.currentContact) {metric.currentContact.endedAt = sim.time; metric.contacts.push(metric.currentContact); metric.currentContact = null;}
            continue;
          }
          metric.observedSeconds += sampleInterval;
          if (visible.hitgroup === 'head') metric.headVisibleSeconds += sampleInterval;
          metric.currentContact ??= {startedAt: sim.time, endedAt: null, settledAt: null, shotAt: null, eligibleSince: null,
            frontContactAt: null, wrongSince: null};
          const contact = metric.currentContact, error = gazeError(actor, visible.point);
          // A body visible behind an unaware pawn is not an omniscient response
          // obligation. Preserve LOS-bearing evidence, but label whether this
          // episode ever entered a conservative 106-degree horizontal view.
          if (error.yaw < 53 && error.pitch < 37) {
            contact.frontContactAt ??= sim.time; metric.frontContactSeconds += sampleInterval;
          }
          metric.yawErrors.push(error.yaw); metric.pitchErrors.push(error.pitch);
          const frame = {...sampleFrame, point: visible.point, hitgroup: visible.hitgroup, yawErrorDegrees: round(error.yaw),
            pitchErrorDegrees: round(error.pitch), contactSeconds: round(sim.time - contact.startedAt)};
          metric.worstFrames.push(frame); metric.worstFrames.sort((a, b) => b.yawErrorDegrees - a.yawErrorDegrees);
          metric.worstFrames.length = Math.min(metric.worstFrames.length, 4);
          if (error.yaw <= qualityLimits.settledYawDegrees && contact.settledAt === null) {
            contact.settledAt = sim.time; metric.settlingMs.push((sim.time - contact.startedAt) * 1000);
          }
          const grace = options.reactionMs / 1000 + qualityLimits.contactGraceSeconds;
          if (sim.time - contact.startedAt >= grace) {
            metric.settledYawErrors.push(error.yaw);
            if (error.yaw > qualityLimits.oppositeYawDegrees) {metric.oppositeSeconds += sampleInterval;
              emit('opposite-side-visible-gaze', run, metric, frame);}
            if (error.yaw > qualityLimits.settledYawDegrees) metric.wrongAfterGraceSeconds += sampleInterval;
          }
          if (sim.time - contact.startedAt > grace + qualityLimits.aimSettleSeconds && contact.settledAt === null)
            emit('visible-aim-never-settled', run, metric, frame);
          if (error.yaw > qualityLimits.settledYawDegrees && contact.frontContactAt !== null) contact.wrongSince ??= sim.time;
          else contact.wrongSince = null;
          if (contact.wrongSince !== null && sim.time - contact.wrongSince > grace + qualityLimits.aimSettleSeconds)
            emit('noticed-contact-aim-drift', run, metric, {...frame, frontContactAt: contact.frontContactAt});
          const alignment = lateralAlignment(actor.position, {x: actor.position.x + actor.velocity.x, y: actor.position.y,
            z: actor.position.z + actor.velocity.z}, visible.point);
          if (alignment && speedUnits > 20) {
            metric.observedRadial.push(alignment.radial);
            if (decision.phase === 'outbound') metric.outboundRadial.push(alignment.radial);
          }
          const eligible = returnFire && ['holding', 'waiting', 'exposed'].includes(decision.phase) && actor.grounded && speedUnits < 5 &&
            actor.weapon.reloadUntil <= 0 && !(actor.weapon.ammo <= 3 && actor.weapon.reserve > 0) && actor.weapon.ammo > 0 &&
            actor.equipReadyAt <= sim.time && (actor.duckAmount < .05 || actor.duckAmount > .95);
          if (!eligible) contact.eligibleSince = null;
          else contact.eligibleSince ??= sim.time;
          if (eligible && contact.shotAt === null && sim.time - contact.eligibleSince >
            options.reactionMs / 1000 + qualityLimits.responseExtraSeconds) {
            if (!metric.unansweredContacts.some(item => item.startedAt === contact.startedAt)) metric.unansweredContacts.push({...frame, startedAt: contact.startedAt});
            emit('settled-visible-no-response', run, metric, frame);
          }
        }
      }
      for (const metric of run.bots) {
        if (metric.currentContact) {metric.currentContact.endedAt = sim.time; metric.contacts.push(metric.currentContact);}
        if (metric.movementLeg) {metric.movementLeg.endAt = sim.time; metric.movementLeg.end = feetOf(sim.actors[run.bots.indexOf(metric) + 1]);
          metric.movementLeg.displacementUnits = horizontalGap(metric.movementLeg.start, metric.movementLeg.end) / UNIT;
          metric.movementLeg.incomplete = true; metric.legs.push(metric.movementLeg);}
        if (metric.attack && metric.plannedAlignment && metric.plannedAlignment.radial > qualityLimits.radialLaneFraction)
          emit('forward-back-planned-peek', run, metric, {home: metric.home, attack: metric.attack, watchPoint: metric.watchPoint,
            radialFraction: round(metric.plannedAlignment.radial), lateralFraction: round(metric.plannedAlignment.lateral)});
        if (metric.outboundRadial.length >= 4 && summarize(metric.outboundRadial).p50 > qualityLimits.radialLaneFraction)
          observations.push({code: 'forward-back-visible-travel', ...context(run, metric), radial: summarize(metric.outboundRadial)});
        if (!metric.observedSeconds) observations.push({code: 'not-encountered-no-quality-claim', ...context(run, metric)});
        metric.yawErrorDegrees = summarize(metric.yawErrors); metric.settledYawErrorDegrees = summarize(metric.settledYawErrors);
        metric.pitchErrorDegrees = summarize(metric.pitchErrors); metric.aimSettleMs = summarize(metric.settlingMs);
        metric.firstShotMsSummary = summarize(metric.firstShotMs); metric.velocityUnits = summarize(metric.speedUnits);
        metric.visibleMovementRadial = summarize(metric.observedRadial); metric.outboundMovementRadial = summarize(metric.outboundRadial);
        for (const key of ['yawErrors', 'settledYawErrors', 'pitchErrors', 'settlingMs', 'speedUnits', 'observedRadial', 'outboundRadial',
          'currentContact', 'movementLeg', 'lastSampleVelocity', 'reverseWindow', 'lastSeenFromPlayer', 'phase', 'phaseAt']) delete metric[key];
      }
      run.seconds = round(sim.time); run.wallMs = round(performance.now() - simStarted);
      run.completed = finished; run.allWaypointsReached = run.reached.length === targets.length;
      run.coverage = {bots: run.bots.length, encountered: run.bots.filter(bot => bot.observedSeconds > 0).length};
      if (!finished) observations.push({code: 'approach-not-completed', ...context(run), seconds: run.seconds, reached: run.reached.length, expected: targets.length});
      runs.push(run);
      console.error(JSON.stringify({route: id, population, returnFire, seed, seconds: run.seconds, completed: run.completed,
        encountered: run.coverage.encountered, roster: run.roster, shots: run.events.shots,
        worst: run.bots.filter(bot => bot.wrongAfterGraceSeconds > 0).sort((a, b) => b.wrongAfterGraceSeconds - a.wrongAfterGraceSeconds)
          .slice(0, 3).map(bot => ({key: bot.key, wrongSeconds: round(bot.wrongAfterGraceSeconds), oppositeSeconds: round(bot.oppositeSeconds),
            yawP95: round(bot.settledYawErrorDegrees.p95), firstWorstFrame: bot.worstFrames[0]})), failures: failures.filter(item => item.route === id &&
            item.population === population && item.returnFire === returnFire && item.seed === seed)}));
    }
    const finalHashes = hashes(), changedSources = sourceFiles.filter(file => initialHashes[file] !== importedHashes[file] || importedHashes[file] !== finalHashes[file]);
    const report = {version: 1, auditSha256,
      build: manifest.build, collisionSha256, catalogRevision: dust2Catalog.revision, sourceSha256: initialHashes,
      importedSourceSha256: importedHashes, finalSourceSha256: finalHashes,
      snapshotStable: !changedSources.length, changedSources, options, qualityLimits, wallMs: round(performance.now() - started),
      runs, failures, observations, notes: [
        'Actual PrefireSimulation fixed/weighted rosters, at most five actors; no handpicked replacement placements.',
        'Player physically walks authored approaches with ordinary yaw/movement commands and optional native-supported local body detours. No mid-run relocation.',
        'Health 1e9 is a survival fixture only. Bot shots, shared movement, recoil, reloads, tagging and punch are unchanged; player never fires.',
        'Public head/chest/shoulder hit geometry plus native blocker rays is independent of controller FOV, visibility, contact and desired angles.',
        'Visibility probes at 16 Hz are offline only. Unobserved/blocked/unfinished cases are not passed as encounters.',
        'Plan watch points are used only for separately labelled planned-lane geometry, never visible aim correctness.',
        'Hold and crouch-hide roles are not required to roam; take-angle roles are not required to retreat from ongoing contact.',
        'This is physical behavior evidence, not browser animation/render quality or a measured professional-human benchmark.',
      ]};
    if (options.report) {
      const destination = path.resolve(root, options.report);
      if (!destination.startsWith(root + path.sep)) throw new Error('Report must be within the repository.');
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({report: destination, runs: runs.length, failures: failures.length, observations: observations.length,
        snapshotStable: report.snapshotStable, wallMs: report.wallMs}));
    } else console.log(JSON.stringify(report, null, 2));
    return report;
  } finally {collision?.dispose(); await vite.close();}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await audit(parseOptions(process.argv.slice(2)));
  if (!report.snapshotStable || report.options.enforce && report.failures.length) process.exitCode = 1;
}
