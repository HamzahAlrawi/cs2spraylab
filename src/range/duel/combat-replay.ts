import type {Vec} from '../actor-physics';
import type {Equipment} from '../equipment';
import type {ShotState} from '../shot-state';
import type {ActorHitPose} from './actor-hitboxes';
import type {ActorCommand, DuelActorSnapshot, DuelEvent, Hitgroup} from './types';
import {traceActor} from './geometry';
import type {AttentionDecision} from './awareness';
import type {DuelConfig} from './config';
import type {Arena, Solid} from './geometry';
import {environmentSolids, type EnvironmentState} from './environment';
import {copyUtilityDrops, copyUtilityEvent, copyUtilityPresentation, copyUtilityState, packReplayUtilities, UTILITY_REPLAY_LIMITS,
  type ReplayUtilities, type ReplayUtilitySnapshot, type ReplayUtilityEvent, type UtilityCellCache} from './utility-replay';
import type {UtilityEffect, UtilityEvent, UtilityProjectile} from './utilities';
import type {UtilityPresentation} from './utility-view';
import type {UtilityDropPresentation} from './utility-render';

export const REPLAY_VERSION = 'spraylab-combat-v1';
export type ReplayTarget = {actor: DuelActorSnapshot; pose?: ActorHitPose};
export type ReplayShot = {
  id: number; tick: number; time: number; shooter: number; weapon: Equipment;
  origin: Vec; direction: Vec; aimDirection: Vec; range: number; pellets?: Vec[];
  accuracy?: ShotState; targets: ReplayTarget[];
  randomState?: {before: number; after: number};
  contacts: Extract<DuelEvent, {kind: 'hit' | 'surface'}>[];
  world?: number;
};
export type ReplayDecision = {phase?: string; peek?: string; role?: string; intent?: string; visible?: boolean; attention?: AttentionDecision;
  gazeOwner?: string | null; fireBlockedReason?: string | null; sensorAge?: number | null; loadoutReason?: string;
  utilityIntent?: string};
export type ReplayActor = DuelActorSnapshot & {bodyYaw?: number; view?: {yaw: number; pitch: number; roll: number; fov: number};
  flashAmount?: number; utilityState?: UtilityPresentation};
export type ReplayFrame = {tick: number; time: number; actors: ReplayActor[]; decisions?: {actor: number; decision: ReplayDecision}[]; world?: number};
export type ReplayWorld = {revision: number; native: boolean; solids: Solid[]; bounds: Pick<Arena, 'minX' | 'maxX' | 'minZ' | 'maxZ'>};
export type ReplayInput = {tick: number; actor: number; command: ActorCommand};
export type CombatRecording = {
  version: typeof REPLAY_VERSION; seed: number; map?: string; source: string; randomAlgorithm: string;
  setup?: {gameBuild: string; config: DuelConfig; loadout: {primary: string | null; sidearm: string}; nativeBuild?: string; geometrySha256?: string};
  initialInputs: ReplayInput[];
  seconds: number; frames: ReplayFrame[]; shots: ReplayShot[]; inputs: ReplayInput[];
  worlds?: ReplayWorld[];
  utilities?: ReplayUtilities;
};
const vec = (v: Vec): Vec => ({...v});
const cloneActor = (actor: ReplayActor): ReplayActor => ({...actor, view: actor.view ? {...actor.view} : undefined, position: vec(actor.position),
  utilityState: copyUtilityPresentation(actor.utilityState),
  flashAmount: Number.isFinite(actor.flashAmount) ? Math.max(0, Math.min(1, actor.flashAmount!)) : undefined,
  velocity: {...actor.velocity}, aimPunch: actor.aimPunch ? {...actor.aimPunch} : undefined,
  recentHits:actor.recentHits?.map(hit=>({...hit,incoming:{...hit.incoming}})),
  deathDirection: actor.deathDirection ? vec(actor.deathDirection) : undefined});
const clonePose = (pose: ActorHitPose): ActorHitPose => ({capsules: pose.capsules.map(c => ({...c,
  point0: vec(c.point0), point1: vec(c.point1)}))});

/** Bounded overwrite buffer. Recording never changes RNG, shot resolution, or live poses. */
class Ring<T> {
  private values: (T | undefined)[];
  private start = 0;
  private count = 0;
  constructor(readonly capacity: number) {this.values = new Array(capacity);}
  push(value: T) {
    const removed = this.count === this.capacity ? this.values[this.start] : undefined;
    this.values[(this.start + this.count) % this.capacity] = value;
    if (this.count < this.capacity) this.count++; else this.start = (this.start + 1) % this.capacity;
    return removed;
  }
  list() {return Array.from({length: this.count}, (_, i) => this.values[(this.start + i) % this.capacity]!);}
  newest() {return this.count ? this.values[(this.start + this.count - 1) % this.capacity] : undefined;}
  replaceNewest(value: T) {if (this.count) this.values[(this.start + this.count - 1) % this.capacity] = value; else this.push(value);}
  get size() {return this.count;}
}

export class CombatReplay {
  private frames = new Ring<ReplayFrame>(321);
  private shots = new Ring<ReplayShot>(160);
  private inputs = new Ring<ReplayInput>(8192);
  private lastInput = new Map<number, string>();
  private inputBaseline = new Map<number, ReplayInput>();
  private activeShots = new Map<number, ReplayShot>();
  private count = 0;
  private worlds = new Map<number, ReplayWorld>();
  private worldRevision?: number;
  private utilityFrames = new Ring<ReplayUtilitySnapshot>(UTILITY_REPLAY_LIMITS.frames);
  private utilityEvents = new Ring<ReplayUtilityEvent>(UTILITY_REPLAY_LIMITS.events);
  private utilityEffects = new Map<number, {key: string; effect: UtilityEffect}>();
  private utilityCells: UtilityCellCache = new Map();
  get shotCount() {return Math.min(this.count, 160);}
  get frameCount() {return this.frames.size;}
  constructor(private readonly seed: number, private readonly map?: string, readonly seconds = 10, private readonly setup?: CombatRecording['setup']) {}
  world(revision: number, arena: Arena, state?: EnvironmentState) {
    if (revision === this.worldRevision) return;
    this.worldRevision = revision;
    this.worlds.set(revision, {revision, native: !!arena.native,
      solids: arena.native ? [] : structuredClone(environmentSolids(arena, state)),
      bounds: {minX: arena.minX, maxX: arena.maxX, minZ: arena.minZ, maxZ: arena.maxZ}});
    // Retain only states that can still be referenced by a bounded frame/shot ring.
    const used = new Set([...this.frames.list(), ...this.shots.list()].map(item => item.world));
    for (const key of this.worlds.keys()) if (key !== revision && !used.has(key)) this.worlds.delete(key);
  }
  frame(tick: number, time: number, actors: ReplayActor[], decisions?: ReplayFrame['decisions'], force = false) {
    if (!force && tick % 4 !== 0 && this.frames.newest()) return;
    this.frames.push({tick, time, actors: actors.map(cloneActor), decisions: decisions ? structuredClone(decisions) : undefined, world: this.worldRevision});
    for (const [id, shot] of this.activeShots) if (time - shot.time > this.seconds) this.activeShots.delete(id);
  }
  /** Call after utility simulation at recording ticks and after state-changing utility events. */
  utility(tick: number, time: number, projectiles: readonly UtilityProjectile[], effects: readonly UtilityEffect[], force = false,
    utilityDrops: readonly UtilityDropPresentation[] = []) {
    if (!Number.isFinite(tick) || !Number.isFinite(time)) return;
    const previous = this.utilityFrames.newest();
    if (!force && tick % 4 !== 0 && previous) return;
    if (!projectiles.length && !effects.length && !utilityDrops.length && previous && !previous.projectiles.length && !previous.effects.length && !previous.drops?.length) return;
    const state = copyUtilityState(projectiles, effects, this.utilityCells), active = new Set<number>();
    if (utilityDrops.length || previous?.drops?.length) state.drops = copyUtilityDrops(utilityDrops);
    state.effects = state.effects.map(effect => {
      active.add(effect.id);
      const key = JSON.stringify({...effect, cells: undefined}), cached = this.utilityEffects.get(effect.id);
      if (cached?.key === key && cached.effect.cells === effect.cells) return cached.effect;
      this.utilityEffects.set(effect.id, {key, effect}); return effect;
    });
    for (const id of this.utilityEffects.keys()) if (!active.has(id)) this.utilityEffects.delete(id);
    for (const id of this.utilityCells.keys()) if (!active.has(id)) this.utilityCells.delete(id);
    const frame = {tick, time, ...state};
    if (previous?.time === time) this.utilityFrames.replaceNewest(frame); else this.utilityFrames.push(frame);
  }
  utilityEvent(event: UtilityEvent | Extract<DuelEvent, {kind: 'utility'}>) {
    const copy = copyUtilityEvent(event);
    if (copy) this.utilityEvents.push(copy);
  }
  input(tick: number, actor: number, command: ActorCommand) {
    // Most idle/held commands do not change. Serialize primitives only when comparing inputs.
    const key = Object.values(command).join('|');
    if (this.lastInput.get(actor) === key) return;
    this.lastInput.set(actor, key);
    const removed = this.inputs.push({tick, actor, command: {...command}});
    if (removed) this.inputBaseline.set(removed.actor, removed);
  }
  shot(shot: Omit<ReplayShot, 'contacts'>) {
    this.count++;
    const copy: ReplayShot = {...shot, world: this.worldRevision, origin: vec(shot.origin), direction: vec(shot.direction), aimDirection: vec(shot.aimDirection),
      pellets: shot.pellets?.map(vec), accuracy: shot.accuracy ? {...shot.accuracy, recoil: {...shot.accuracy.recoil}} : undefined,
      randomState: shot.randomState ? {...shot.randomState} : undefined,
      targets: shot.targets.map(target => ({actor: cloneActor(target.actor), pose: target.pose ? clonePose(target.pose) : undefined})), contacts: []};
    this.shots.push(copy); this.activeShots.set(copy.id, copy);
    if (this.activeShots.size > 160) this.activeShots.delete(this.activeShots.keys().next().value!);
  }
  contact(event: Extract<DuelEvent, {kind: 'hit' | 'surface'}>) {
    const shot = this.activeShots.get(event.shotId);
    if (shot && shot.contacts.length < 128) shot.contacts.push({...event, point: vec(event.point)});
  }
  private snapshot(): CombatRecording {
    const frames = this.frames.list(), shots = this.shots.list();
    const end = Math.max(frames[frames.length - 1]?.time ?? 0, shots[shots.length - 1]?.time ?? 0,
      this.utilityFrames.newest()?.time ?? 0, this.utilityEvents.newest()?.time ?? 0), start = Math.max(0, end - this.seconds);
    const inputs = this.inputs.list(), initialInputs = new Map<number, ReplayInput>(
      [...this.inputBaseline].filter(([, input]) => input.tick / 128 < start));
    for (const input of inputs) if (input.tick / 128 < start) initialInputs.set(input.actor,input);
    const keptFrames = frames.filter(frame => frame.time >= start), keptShots = shots.filter(shot => shot.time >= start);
    const used = new Set([...keptFrames, ...keptShots].map(item => item.world));
    const utilityFrames = this.utilityFrames.list(), baseline = utilityFrames.filter(frame => frame.time < start).pop();
    const utilityEvents = this.utilityEvents.list().filter(event => event.time >= start - 1);
    const utilities = utilityFrames.length || utilityEvents.length ? packReplayUtilities(
      [...(baseline ? [baseline] : []), ...utilityFrames.filter(frame => frame.time >= start)], utilityEvents) : undefined;
    return {version: REPLAY_VERSION, seed: this.seed, map: this.map, setup: this.setup, initialInputs: [...initialInputs.values()],
      source: 'Authoritative browser simulation; not a CS2 demo', randomAlgorithm: 'xorshift32-labelled-v1', seconds: this.seconds,
      frames: keptFrames, shots: keptShots, worlds: [...this.worlds.values()].filter(world => used.has(world.revision)),
      utilities,
      inputs: inputs.filter(input => input.tick / 128 >= start)};
  }
  export(): CombatRecording {
    // Live exports cannot mutate authoritative records still being collected.
    return structuredClone(this.snapshot());
  }
  /** Consume the completed recording before its simulation is discarded.
   * Recorded poses/commands already own their data; transfer those buffers
   * instead of deeply copying thousands of objects on the chunk handoff.
   */
  release(): CombatRecording {
    const recording=this.snapshot();
    recording.setup=recording.setup?structuredClone(recording.setup):undefined;
    this.frames=new Ring<ReplayFrame>(321);this.shots=new Ring<ReplayShot>(160);this.inputs=new Ring<ReplayInput>(8192);
    this.lastInput.clear();this.inputBaseline.clear();this.activeShots.clear();this.worlds.clear();
    this.worldRevision=undefined;this.count=0;
    this.utilityFrames = new Ring<ReplayUtilitySnapshot>(UTILITY_REPLAY_LIMITS.frames);
    this.utilityEvents = new Ring<ReplayUtilityEvent>(UTILITY_REPLAY_LIMITS.events); this.utilityEffects.clear(); this.utilityCells.clear();
    return recording;
  }
}

function targetHit(shot: ReplayShot, target: ReplayTarget, direction: Vec) {
  return traceActor(shot.origin, direction, {...target.actor.position, y: target.actor.feet},
    target.actor.duckAmount, shot.range, target.actor.yaw, target.pose);
}
export type ShotDiagnosis = {label: string; detail: string; group?: Hitgroup};
export function diagnoseShot(shot: ReplayShot): ShotDiagnosis {
  const hit = shot.contacts.find((event): event is Extract<DuelEvent, {kind: 'hit'}> => event.kind === 'hit');
  if (hit) return {label: hit.group === 'head' ? 'Head hit' : 'Body hit', group: hit.group,
    detail: `${Math.round(shot.contacts.reduce((sum, e) => sum + (e.kind === 'hit' ? e.healthDamage : 0), 0))} damage recorded. The displayed result is the actual shot outcome.`};
  const opposing = shot.targets.filter(target => target.actor.alive && target.actor.side !== (shot.shooter === 0 ? 'player' : 'enemy'));
  const actual = (shot.pellets ?? [shot.direction]).flatMap(direction => {
    const hit = opposing.map(target => targetHit(shot, target, direction)).filter(hit => !!hit.group)
      .sort((a, b) => a.distance - b.distance)[0];
    return hit ? [{hit, direction}] : [];
  });
  const entries = shot.contacts.filter((e): e is Extract<DuelEvent, {kind: 'surface'}> => e.kind === 'surface' && e.phase !== 'exit');
  const blocking = entries.find(entry => actual.some(({hit, direction}) => {
    const dx = entry.point.x - shot.origin.x, dy = entry.point.y - shot.origin.y, dz = entry.point.z - shot.origin.z;
    const along = dx * direction.x + dy * direction.y + dz * direction.z;
    const perpendicular = Math.hypot(dx - direction.x * along, dy - direction.y * along, dz - direction.z * along);
    return along > 0 && along < hit.distance && perpendicular < .001;
  }));
  if (blocking) return {label: 'Cover intercepted the ray', detail: `${blocking.material ?? 'A surface'} was intersected before the target. Check the entry/exit contacts and remaining damage.`};
  const centered = opposing.some(target => !!targetHit(shot, target, shot.aimDirection).group);
  if (centered && !actual.length) return {label: 'Spread moved this shot off target', detail: 'The pre-spread ray crossed a target hit shape; none of the sampled bullets did. Movement and recovery can enlarge the cone.'};
  if (!centered && !actual.length) return {label: 'Aim and recoil missed the target shape', detail: 'The pre-spread ray did not cross a recorded enemy hit shape. Use the aim ray to check placement and recoil compensation.'};
  return {label: 'Inspect this shot', detail: 'The recorded ray and target shape overlap without a damage event. Export this recording to investigate; the cause is not inferred.'};
}

export function recordingFrame(recording: CombatRecording, time: number) {
  return recording.frames.reduce<ReplayFrame | undefined>((best, frame) =>
    frame.time <= time && (!best || frame.time >= best.time) ? frame : best, undefined) ?? recording.frames[0];
}

export function recordingBounds(recording: CombatRecording) {
  const first = recording.frames[0]?.time ?? recording.shots[0]?.time ?? recording.utilities?.frames[0]?.time ?? recording.utilities?.events[0]?.time ?? 0;
  const last = Math.max(first, recording.frames[recording.frames.length - 1]?.time ?? 0, recording.shots[recording.shots.length - 1]?.time ?? 0,
    recording.utilities?.frames[recording.utilities.frames.length - 1]?.time ?? 0, recording.utilities?.events[recording.utilities.events.length - 1]?.time ?? 0);
  return {first, last};
}

/** Interpolate positions, never outcomes: a hit/death/equipment change occurs on its recorded frame. */
export function recordingActors(recording: CombatRecording, time: number): ReplayActor[] {
  const before = recordingFrame(recording, time);
  if (!before) return [];
  const after = recording.frames.find(frame => frame.time > time);
  if (!after || after.time <= before.time) return before.actors;
  const alpha = Math.max(0, Math.min(1, (time - before.time) / (after.time - before.time)));
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  const angle = (a: number, b: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * alpha;
  return before.actors.map(actor => {
    const next = after.actors.find(item => item.id === actor.id && item.generation === actor.generation);
    if (!next || !actor.alive || !next.alive) return actor;
    return {...actor, position: {x: lerp(actor.position.x, next.position.x), y: lerp(actor.position.y, next.position.y), z: lerp(actor.position.z, next.position.z)},
      flashAmount: (next.flashAmount ?? 0) <= (actor.flashAmount ?? 0) ? lerp(actor.flashAmount ?? 0, next.flashAmount ?? 0) : actor.flashAmount,
      feet: lerp(actor.feet, next.feet), duckAmount: lerp(actor.duckAmount, next.duckAmount),
      velocity: {x: lerp(actor.velocity.x, next.velocity.x), z: lerp(actor.velocity.z, next.velocity.z)},
      yaw: angle(actor.yaw, next.yaw), pitch: lerp(actor.pitch, next.pitch),
      view: actor.view && next.view ? {yaw: angle(actor.view.yaw, next.view.yaw), pitch: lerp(actor.view.pitch, next.view.pitch), roll: lerp(actor.view.roll, next.view.roll), fov: actor.view.fov} : actor.view,
      bodyYaw: angle(actor.bodyYaw ?? actor.yaw, next.bodyYaw ?? next.yaw)};
  });
}

export function recordingWorld(recording: CombatRecording, time: number) {
  const revision = recordingFrame(recording, time)?.world;
  return recording.worlds?.find(world => world.revision === revision) ?? recording.worlds?.[0];
}

export function shotAtTime(recording: CombatRecording, time: number) {
  return recording.shots.reduce<ReplayShot | undefined>((best, shot) =>
    shot.time <= time && (!best || shot.time >= best.time) ? shot : best, undefined);
}

export function downloadRecording(recording: CombatRecording, performanceReport?: unknown) {
  const blob = new Blob([JSON.stringify({...recording, performance: performanceReport})], {type: 'application/json'});
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `spraylab-combat-${recording.seed}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
