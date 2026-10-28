import {advanceActor, idleInput, stanceCurve, UNIT, type ActorKinematics, type MoveInput} from './actor-physics';
import type {TerrainSolid} from './terrain';

export const MOVEMENT_SCHEMA = 'spraylab.movement-reference/v1';
export const MOVEMENT_MODEL = 'shared-actor-motor/trajectory-v1';
export type MovementScenario = {id: string; stepSeconds: number; durationSeconds: number; weaponSpeedUnits: number;
  initial: {x: number; z: number; feet: number; vx: number; vz: number; vy: number; duck: number; yaw: number};
  terrain: 'flat' | 'slope' | 'edge'; commands: {at: number; input: Partial<MoveInput>}[]; brakeAt?: number};
export type MovementSample = {time: number; x: number; z: number; feet: number; vx: number; vz: number; speed: number; verticalSpeed: number;
  eye: number; hull: number; grounded: boolean};
export type MovementTolerances = {timeSeconds: number; positionUnits: number; speedUnitsPerSecond: number;
  heightUnits: number; stoppingDistanceUnits: number; landingDisplacementUnits: number; stopSpeedUnitsPerSecond: number; rationale: string};
export type MovementReference = {schema: typeof MOVEMENT_SCHEMA; modelVersion: string;
  provenance: {kind: 'synthetic-regression' | 'manual-cs2-capture'; source: string; build: string;
    recordedAt: string; method: string; sha256: string; precision: string};
  tolerances: MovementTolerances; scenarios: {scenario: MovementScenario; samples: MovementSample[]}[]};

const initial = {x: 0, z: 0, feet: 0, vx: 0, vz: 0, vy: 0, duck: 0, yaw: 0};
export const movementScenarios: MovementScenario[] = [
  {id: 'run-release', commands: [{at: 0, input: {side: 1}}, {at: 1, input: {}}], brakeAt: 1},
  {id: 'run-reversal', commands: [{at: 0, input: {side: 1}}, {at: 1, input: {side: -1}}], brakeAt: 1},
  {id: 'walk-run', commands: [{at: 0, input: {side: 1, walk: true}}, {at: 1, input: {side: 1}}]},
  {id: 'crouch-moving', commands: [{at: 0, input: {side: 1}}, {at: .5, input: {side: 1, crouch: true}}, {at: 1.5, input: {}}]},
  {id: 'jump-crouch', commands: [{at: 0, input: {side: 1, jump: true}}, {at: .125, input: {side: 1, crouch: true}}, {at: .625, input: {}}]},
  {id: 'slope-landing', terrain: 'slope', initial: {...initial, x: 16, feet: 96, vx: 120}, commands: [{at: 0, input: {side: 1}}]},
  {id: 'edge-landing', terrain: 'edge', initial: {...initial, feet: 32}, commands: [{at: 0, input: {side: 1}}]},
].map(scenario => ({stepSeconds: 1 / 128, durationSeconds: 2, weaponSpeedUnits: 215,
  terrain: 'flat', initial: {...initial}, ...scenario} as MovementScenario));

/** Authored diagnostic geometry, not a reconstruction of any measured CS2 map. */
function solids(terrain: MovementScenario['terrain']): TerrainSolid[] {
  if (terrain === 'flat') return [];
  if (terrain === 'edge') return [{center: {x: 0, y: 16 * UNIT, z: 0}, size: {x: 64 * UNIT, y: 32 * UNIT, z: 128 * UNIT}}];
  return [{center: {x: 64 * UNIT, y: 16 * UNIT, z: 0}, size: {x: 128 * UNIT, y: 32 * UNIT, z: 128 * UNIT},
    traversal: {kind: 'ramp', axis: 'x', rise: 32 * UNIT}}];
}

export function runMovementScenario(scenario: MovementScenario): MovementSample[] {
  const a = scenario.initial, environment = {solids: solids(scenario.terrain)};
  let actor: ActorKinematics = {position: {x: a.x * UNIT, y: (a.feet + 64 - 18 * stanceCurve(a.duck)) * UNIT, z: a.z * UNIT},
    feet: a.feet * UNIT, velocity: {x: a.vx * UNIT, z: a.vz * UNIT}, verticalVelocity: a.vy * UNIT,
    eyeHeight: (64 - 18 * stanceCurve(a.duck)) * UNIT, yaw: a.yaw, duckAmount: a.duck, jumpHeld: false, crouchHeld: a.duck > 0};
  const samples: MovementSample[] = [];
  const record = (time: number) => samples.push({time, x: actor.position.x / UNIT, z: actor.position.z / UNIT,
    feet: actor.feet / UNIT, vx: actor.velocity.x / UNIT, vz: actor.velocity.z / UNIT, speed: Math.hypot(actor.velocity.x, actor.velocity.z) / UNIT,
    verticalSpeed: actor.verticalVelocity / UNIT, eye: actor.eyeHeight / UNIT,
    hull: 72 - 18 * stanceCurve(actor.duckAmount ?? 0), grounded: actor.grounded ?? (a.feet === 0 || scenario.terrain === 'edge' && a.feet === 32)});
  record(0);
  let command = 0;
  // Split at command edges as well as ticks; never silently round capture inputs.
  for (let time = 0; time < scenario.durationSeconds - 1e-10;) {
    while (command + 1 < scenario.commands.length && scenario.commands[command + 1].at <= time + 1e-10) command++;
    const end = Math.min(scenario.durationSeconds, time + scenario.stepSeconds, scenario.commands[command + 1]?.at ?? Infinity);
    actor = advanceActor(actor, {...idleInput(), ...scenario.commands[command].input}, scenario.weaponSpeedUnits * UNIT,
      end - time, undefined, undefined, undefined, environment);
    time = end; record(time);
  }
  return samples;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return value as Record<string, unknown>;
}
function label(value: unknown) {if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new Error('Missing/bounded provenance label');}
function number(value: unknown, min = -1e6, max = 1e6) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid finite numeric value');
}
/** Strict import boundary. No capture classification, units, or tolerances are inferred. */
export function parseMovementReference(value: unknown): MovementReference {
  const root = object(value), provenance = object(root.provenance), tolerances = object(root.tolerances);
  if (root.schema !== MOVEMENT_SCHEMA) throw new Error('Unsupported movement schema');
  label(root.modelVersion);
  if (!['synthetic-regression', 'manual-cs2-capture'].includes(String(provenance.kind))) throw new Error('Explicit provenance kind required');
  for (const key of ['source', 'build', 'recordedAt', 'method', 'precision']) label(provenance[key]);
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(provenance.recordedAt)) || !Number.isFinite(Date.parse(String(provenance.recordedAt)))) throw new Error('ISO capture date required');
  if (!/^[a-f0-9]{64}$/.test(String(provenance.sha256))) throw new Error('SHA-256 required');
  label(tolerances.rationale);
  for (const key of ['timeSeconds', 'positionUnits', 'speedUnitsPerSecond', 'heightUnits', 'stoppingDistanceUnits',
    'landingDisplacementUnits', 'stopSpeedUnitsPerSecond']) number(tolerances[key], 0, key === 'timeSeconds' ? .1 : 1000);
  if (!Array.isArray(root.scenarios) || !root.scenarios.length || root.scenarios.length > 32) throw new Error('Expected 1..32 scenarios');
  const ids = new Set();
  for (const raw of root.scenarios) {
    const entry = object(raw), scenario = object(entry.scenario), a = object(scenario.initial);
    label(scenario.id); if (ids.has(scenario.id)) throw new Error('Duplicate scenario'); ids.add(scenario.id);
    number(scenario.stepSeconds, 1 / 256, 1 / 32); number(scenario.durationSeconds, .01, 30); number(scenario.weaponSpeedUnits, 1, 500);
    for (const key of ['x', 'z', 'feet', 'vx', 'vz', 'vy', 'yaw']) number(a[key]); number(a.duck, 0, 1);
    if (!['flat', 'slope', 'edge'].includes(String(scenario.terrain))) throw new Error('Unknown diagnostic terrain');
    if (scenario.brakeAt !== undefined) number(scenario.brakeAt, 0, scenario.durationSeconds as number);
    if (!Array.isArray(scenario.commands) || !scenario.commands.length || scenario.commands.length > 256) throw new Error('Invalid commands');
    let previous = -1;
    for (const rawCommand of scenario.commands) {
      const command = object(rawCommand); number(command.at, 0, scenario.durationSeconds as number);
      if ((command.at as number) <= previous || previous === -1 && command.at !== 0) throw new Error('Commands must start at zero and increase');
      previous = command.at as number;
      for (const [key, val] of Object.entries(object(command.input))) {
        if (['side', 'forward'].includes(key)) number(val, -1, 1);
        else if (['walk', 'crouch', 'jump', 'jumpPressed'].includes(key)) {if (typeof val !== 'boolean') throw new Error('Boolean input required');}
        else throw new Error(`Unsupported command field ${key}`);
      }
    }
    if (!Array.isArray(entry.samples) || entry.samples.length < 2 || entry.samples.length > 8192) throw new Error('Expected 2..8192 samples');
    previous = -1;
    for (const rawSample of entry.samples) {
      const sample = object(rawSample); number(sample.time, 0, scenario.durationSeconds as number);
      if ((sample.time as number) <= previous) throw new Error('Sample times must increase'); previous = sample.time as number;
      for (const key of ['x', 'z', 'feet', 'vx', 'vz', 'speed', 'verticalSpeed', 'eye', 'hull']) number(sample[key]);
      if (typeof sample.grounded !== 'boolean') throw new Error('Grounded observation required');
    }
    if (entry.samples[0].time !== 0 || Math.abs(entry.samples[entry.samples.length - 1].time - (scenario.durationSeconds as number)) > 1e-8)
      throw new Error('Reference must cover the entire scenario; no extrapolation');
  }
  return value as MovementReference;
}

const interpolate = (samples: MovementSample[], time: number): MovementSample => {
  let low = 0, high = samples.length - 1;
  while (low + 1 < high) {const mid = (low + high) >>> 1; if (samples[mid].time <= time) low = mid; else high = mid;}
  const a = samples[low], b = samples[high], alpha = (time - a.time) / (b.time - a.time);
  const sample = {...a, time, grounded: alpha >= 1 - 1e-10 ? b.grounded : a.grounded};
  for (const key of ['x', 'z', 'feet', 'vx', 'vz', 'speed', 'verticalSpeed', 'eye', 'hull'] as const) sample[key] += (b[key] - a[key]) * alpha;
  return sample;
};
function events(samples: MovementSample[], scenario: MovementScenario, stopSpeed: number) {
  const start = scenario.brakeAt === undefined ? undefined : interpolate(samples, scenario.brakeAt);
  let stopped = start && samples.find(s => s.time >= start.time && s.speed <= stopSpeed);
  if (start && start.speed > stopSpeed) for (let n = 1; n < samples.length; n++) {
    const a = samples[n - 1], b = samples[n];
    if (a.time < start.time) continue;
    const before = a.vx * start.vx + a.vz * start.vz, after = b.vx * start.vx + b.vz * start.vz;
    if (before > 0 && after <= 0) {
      const crossing = interpolate(samples, a.time + (b.time - a.time) * before / (before - after));
      if (!stopped || crossing.time < stopped.time) stopped = crossing;
      break;
    }
  }
  const contacts = samples.filter((s, i) => i > 0 && s.grounded !== samples[i - 1].grounded);
  const landings = contacts.filter(s => s.grounded);
  return {stopTime: stopped?.time, stoppingDistance: start && stopped ? Math.hypot(stopped.x - start.x, stopped.z - start.z) : undefined,
    landings: landings.map(s => ({time: s.time, x: s.x, z: s.z})), contacts: contacts.map(s => ({time: s.time, grounded: s.grounded}))};
}
export function compareMovementReference(reference: MovementReference) {
  const t = reference.tolerances;
  const scenarios = reference.scenarios.map(({scenario, samples}) => {
    const actual = runMovementScenario(scenario), errors = {position: 0, speed: 0, height: 0, verticalSpeed: 0};
    const curves = samples.map(expected => {
      const observed = interpolate(actual, expected.time);
      errors.position = Math.max(errors.position, Math.hypot(observed.x - expected.x, observed.z - expected.z, observed.feet - expected.feet));
      errors.speed = Math.max(errors.speed, Math.abs(observed.speed - expected.speed), Math.hypot(observed.vx - expected.vx, observed.vz - expected.vz));
      errors.verticalSpeed = Math.max(errors.verticalSpeed, Math.abs(observed.verticalSpeed - expected.verticalSpeed));
      errors.height = Math.max(errors.height, Math.abs(observed.eye - expected.eye), Math.abs(observed.hull - expected.hull));
      return {expected, actual: observed};
    });
    const expectedEvents = events(samples, scenario, t.stopSpeedUnitsPerSecond), actualEvents = events(actual, scenario, t.stopSpeedUnitsPerSecond);
    const failures: string[] = [];
    if (errors.position > t.positionUnits) failures.push('position');
    if (errors.speed > t.speedUnitsPerSecond || errors.verticalSpeed > t.speedUnitsPerSecond) failures.push('speed');
    if (errors.height > t.heightUnits) failures.push('eye/hull');
    if (scenario.brakeAt !== undefined) {
      if (expectedEvents.stopTime === undefined || actualEvents.stopTime === undefined) failures.push('stop not observed');
      else if (Math.abs(actualEvents.stopTime - expectedEvents.stopTime) > t.timeSeconds ||
        Math.abs(actualEvents.stoppingDistance! - expectedEvents.stoppingDistance!) > t.stoppingDistanceUnits) failures.push('stopping');
    }
    if (expectedEvents.landings.length !== actualEvents.landings.length) failures.push('landing count');
    else expectedEvents.landings.forEach((landing, i) => {
      const observed = actualEvents.landings[i];
      if (Math.abs(landing.time - observed.time) > t.timeSeconds || Math.hypot(landing.x - observed.x, landing.z - observed.z) > t.landingDisplacementUnits) failures.push('landing');
    });
    // Ground contact differences away from event timestamp uncertainty are real failures.
    if (expectedEvents.contacts.length !== actualEvents.contacts.length || expectedEvents.contacts.some((event, n) => {
      const observed = actualEvents.contacts[n];
      return !observed || event.grounded !== observed.grounded || Math.abs(event.time - observed.time) > t.timeSeconds;
    }) || curves.some(({expected, actual: observed}) => expected.grounded !== observed.grounded &&
      ![...expectedEvents.contacts, ...actualEvents.contacts].some(event => Math.abs(event.time - expected.time) <= t.timeSeconds))) failures.push('ground contact');
    return {id: scenario.id, passed: failures.length === 0, failures, maxErrors: errors, expectedEvents, actualEvents, curves};
  });
  return {schema: 'spraylab.movement-comparison/v1', modelVersion: MOVEMENT_MODEL, referenceModelVersion: reference.modelVersion,
    provenance: reference.provenance, tolerances: t, passed: scenarios.every(s => s.passed), scenarios};
}
