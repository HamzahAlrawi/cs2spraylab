import type {Vec} from '../actor-physics';
import type {DuelEvent} from './types';
import {UTILITY_RULES, type UtilityEffect, type UtilityEvent, type UtilityProjectile} from './utilities';
import {utilityKinds, type UtilityKind} from './utility-loadout';
import type {UtilityPresentation} from './utility-view';
import type {UtilityDropPresentation} from './utility-render';
import {UTILITY_THROW_PRESENTATION_DELAY} from './utility-view';
import {MAX_SMOKE_CELLS} from './smoke-volume';

export const UTILITY_REPLAY_LIMITS = Object.freeze({frames: 1281, events: 4096, cells: 24, smokeCells: MAX_SMOKE_CELLS, drops: 64});
export type ReplayUtilityDrop = Omit<UtilityDropPresentation, 'owner'> & {owner?: number};
export type ReplayUtilityState = {projectiles: UtilityProjectile[]; effects: UtilityEffect[]; drops?: ReplayUtilityDrop[]};
export type ReplayUtilitySnapshot = ReplayUtilityState & {tick: number; time: number};
export type UtilityCellCache = Map<number, {source: readonly Vec[]; cells: Vec[]}>;
export type ReplayUtilityEvent = {
  time: number; actorId: number; kind: UtilityKind; position: Vec;
  action: UtilityEvent['type'] | 'throw' | 'decoy';
  utilityId?: number; strength?: number; throwStartedAt?: number; sound?: string; equipment?: string;
  targetId?: number; exposure?: number; duration?: number; hold?:number;fade?:number; smokeId?: number;
  damage?: number; healthDamage?: number; armorDamage?: number; radius?: number;
  normal?: Vec; direction?: Vec; point?: Vec;
};
export type ReplayUtilities = {
  frames: {tick: number; time: number; projectiles: UtilityProjectile[]; effects: number[]; drops?: ReplayUtilityDrop[]}[];
  effects: (Omit<UtilityEffect, 'cells'> & {cells: number})[];
  cells: Vec[][];
  events: ReplayUtilityEvent[];
};
export type ReplayUtilityPose = {kind: UtilityKind; action: 'idle' | 'draw' | 'pullpin' | 'throw-high' | 'throw-low';
  startedAt: number; duration?: number;crouched?:boolean};

export function replayUtilityPose(state: UtilityPresentation | undefined, thrown: ReplayUtilityEvent | undefined, time = -Infinity): ReplayUtilityPose | undefined {
  const throwAt = state?.throwStartedAt ?? (state?.releaseAt === undefined ? undefined : state.releaseAt - UTILITY_THROW_PRESENTATION_DELAY);
  if (state && throwAt !== undefined && time >= throwAt) return {kind: state.kind,
    action: (state.strength ?? 1) < .25 ? 'throw-low' : 'throw-high', startedAt: throwAt};
  if (state) {const primed = state.primedAt !== undefined && time >= state.primedAt;
    if(!primed&&time>=state.readyAt)return{kind:state.kind,action:'idle',startedAt:state.readyAt};
    return {kind: state.kind, action: primed ? 'pullpin' : 'draw',
      startedAt: primed ? state.primedAt! : state.selectedAt, duration: primed ? undefined : Math.max(.01, state.readyAt - state.selectedAt)};}
  if (thrown) return {kind: thrown.kind, action: (thrown.strength ?? 1) < .25 ? 'throw-low' : 'throw-high',
    startedAt: thrown.throwStartedAt ?? thrown.time - UTILITY_THROW_PRESENTATION_DELAY};
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const positive = (value: unknown): value is number => finite(value) && value >= 0;
const kind = (value: unknown): value is UtilityKind => utilityKinds.includes(value as UtilityKind);
const vector = (value: Vec | undefined): value is Vec => !!value && finite(value.x) && finite(value.y) && finite(value.z);
const copyVec = (value: Vec): Vec => ({x: value.x, y: value.y, z: value.z});
const attribution = (value: UtilityProjectile | UtilityEffect) => positive(value.id) && positive(value.actorId) &&
  kind(value.kind) && (value.side === 'player' || value.side === 'enemy') && vector(value.position) && positive(value.radius);

export function copyUtilityPresentation(state?: UtilityPresentation): UtilityPresentation | undefined {
  if (!state || !kind(state.kind) || !finite(state.selectedAt) || !finite(state.readyAt)) return;
  return {kind: state.kind, selectedAt: state.selectedAt, readyAt: state.readyAt,
    primedAt: finite(state.primedAt) ? state.primedAt : undefined,
    releaseAt: finite(state.releaseAt) ? state.releaseAt : undefined,
    throwStartedAt: finite(state.throwStartedAt) ? state.throwStartedAt : undefined,
    drawPlaybackRate: positive(state.drawPlaybackRate) && state.drawPlaybackRate > 0 ? Math.min(10, state.drawPlaybackRate) : undefined,
    strength: finite(state.strength) ? Math.max(0, Math.min(1, state.strength)) : undefined};
}

/** Allowlisted copies: never serialize kernel clocks, unbounded arrays, or foreign properties. */
export function copyUtilityState(projectiles: readonly UtilityProjectile[], effects: readonly UtilityEffect[], cellCache?: UtilityCellCache): ReplayUtilityState {
  const cells = (effect: UtilityEffect) => {
    const source = Array.isArray(effect.cells) ? effect.cells : [], cached = cellCache?.get(effect.id);
    if (cached?.source === source) return cached.cells;
    const copied = source.slice(0, effect.type === 'smoke' ? UTILITY_REPLAY_LIMITS.smokeCells : UTILITY_REPLAY_LIMITS.cells).filter(vector).map(copyVec);
    cellCache?.set(effect.id, {source, cells: copied}); return copied;
  };
  return {
    projectiles: projectiles.slice(0, UTILITY_RULES.maxProjectiles).filter(p => p && attribution(p) && vector(p.velocity) && finite(p.thrownAt)).map(p => ({
      id: p.id, actorId: p.actorId, side: p.side, kind: p.kind, position: copyVec(p.position), velocity: copyVec(p.velocity),
      radius: p.radius, thrownAt: p.thrownAt, resting: p.resting === true, bounces: positive(p.bounces) ? Math.min(128, p.bounces) : 0})),
    effects: effects.slice(0, UTILITY_RULES.maxEffects).filter(e => e && attribution(e) &&
      ['smoke', 'fire', 'decoy', 'burst'].includes(e.type) && finite(e.startedAt) && finite(e.expiresAt) && e.expiresAt > e.startedAt).map(e => ({
      id: e.id, actorId: e.actorId, side: e.side, kind: e.kind, type: e.type, position: copyVec(e.position), radius: e.radius,
      startedAt: e.startedAt, expiresAt: e.expiresAt,
      cells: cells(e),
      holes: (Array.isArray(e.holes) ? e.holes : []).slice(0, UTILITY_RULES.maxHoles).filter(h => h && vector(h.from) && vector(h.to) &&
        positive(h.radius) && finite(h.startedAt) && finite(h.expiresAt) && h.expiresAt > h.startedAt).map(h => ({
          from: copyVec(h.from), to: copyVec(h.to), radius: h.radius, startedAt: h.startedAt, expiresAt: h.expiresAt}))})),
  };
}

export function copyUtilityDrops(drops: readonly UtilityDropPresentation[]) {
  return drops.slice(0, UTILITY_REPLAY_LIMITS.drops).filter(drop => drop && positive(drop.id) && kind(drop.utility) && vector(drop.position)).map(drop => ({
    id: drop.id, utility: drop.utility, position: copyVec(drop.position), picked: drop.picked === true,
    droppedAt: finite(drop.droppedAt) ? drop.droppedAt : undefined, owner: positive(drop.owner) ? drop.owner : undefined}));
}

export function copyUtilityEvent(event: UtilityEvent | Extract<DuelEvent, {kind: 'utility'}>): ReplayUtilityEvent | undefined {
  const duel = event.kind === 'utility';
  const time = duel ? event.tick / 128 : event.time, position = duel ? event.point : event.position;
  const utility = duel ? event.utility : event.kind;
  if (!finite(time) || !positive(event.actorId) || !kind(utility) || !vector(position)) return;
  const result: ReplayUtilityEvent = {time, actorId: event.actorId, kind: utility, position: copyVec(position), action: duel ? event.action : event.type};
  if (duel) {
    if (finite(event.strength)) result.strength = Math.max(0, Math.min(1, event.strength));
    if (finite(event.throwStartedAt)) result.throwStartedAt = event.throwStartedAt;
    if (event.equipment) result.equipment = event.equipment;
    if (event.sound) result.sound = event.sound.slice(0, 32);
  } else {
    if (!positive(event.utilityId)) return;
    result.utilityId = event.utilityId;
    if (event.type === 'sound') {result.sound = event.sound; result.radius = event.radius;}
    if (event.type === 'flash') {result.targetId = event.targetId; result.exposure = event.exposure; result.duration = event.duration;
      if(event.hold!==undefined)result.hold=event.hold;if(event.fade!==undefined)result.fade=event.fade;}
    if (event.type === 'bounce') {if (!vector(event.normal)) return; result.normal = copyVec(event.normal);}
    if (event.type === 'extinguish') result.smokeId = event.smokeId;
    if (event.type === 'damage') {
      if (!vector(event.point) || !vector(event.direction)) return;
      result.targetId = event.targetId; result.damage = event.damage; result.healthDamage = event.healthDamage;
      result.armorDamage = event.armorDamage; result.point = copyVec(event.point); result.direction = copyVec(event.direction);
    }
  }
  // Malformed optional event payloads must not leak NaN/Infinity into JSON.
  for (const value of Object.values(result)) if (typeof value === 'number' && !finite(value)) return;
  for (const value of [result.normal, result.direction, result.point]) if (value && !vector(value)) return;
  return result;
}

/** Intern unchanged smoke/fire payloads once per export rather than once per 32-Hz frame. */
export function packReplayUtilities(snapshots: ReplayUtilitySnapshot[], events: ReplayUtilityEvent[]): ReplayUtilities {
  const effects: ReplayUtilities['effects'] = [], indices = new Map<UtilityEffect, number>();
  const cells: Vec[][] = [], cellIndices = new Map<Vec[], number>();
  return {frames: snapshots.map(frame => ({tick: frame.tick, time: frame.time, projectiles: frame.projectiles,
    drops: frame.drops,
    effects: frame.effects.map(effect => {
      let index = indices.get(effect);
      if (index === undefined) {
        let cellIndex = cellIndices.get(effect.cells);
        if (cellIndex === undefined) {cellIndex = cells.length; cells.push(effect.cells); cellIndices.set(effect.cells, cellIndex);}
        index = effects.length; effects.push({...effect, cells: cellIndex}); indices.set(effect, index);
      }
      return index;
    })})), effects, cells, events};
}

/** Absolute-time sampling only. No simulation advance, random draws, or playback-owned clocks. */
export function sampleReplayUtilities(data: ReplayUtilities | undefined, time: number): ReplayUtilityState {
  if (!data || !Number.isFinite(time)) return {projectiles: [], effects: []};
  let before: ReplayUtilities['frames'][number] | undefined, after: typeof before;
  for (const frame of data.frames) {
    if (frame.time <= time) before = frame;
    else {after = frame; break;}
  }
  if (!before) return {projectiles: [], effects: []};
  const alpha = after ? Math.max(0, Math.min(1, (time - before.time) / (after.time - before.time))) : 0;
  const ended = new Set<number>(), detonated = new Set<number>();
  for (const event of data.events) if (event.utilityId !== undefined && event.time >= before.time && event.time <= time) {
    if (event.action === 'expire' || event.action === 'extinguish') ended.add(event.utilityId);
    if (event.action === 'detonate') detonated.add(event.utilityId);
  }
  const effects = before.effects.map(index => data.effects[index]).filter(e => !!e && e.startedAt <= time && e.expiresAt > time &&
    !ended.has(e.id));
  const projectiles = before.projectiles.filter(p => p.thrownAt <= time && time - p.thrownAt < UTILITY_RULES.projectileLifetime &&
    !ended.has(p.id) && !detonated.has(p.id)).map(p => {
    const next = after?.projectiles.find(n => n.id === p.id && n.thrownAt === p.thrownAt);
    // Never smooth a bounce/rest transition or invent a flight path beyond the last sample.
    if (!next || p.resting || next.bounces !== p.bounces || next.resting !== p.resting) return p;
    return {...p, position: {x: p.position.x + (next.position.x - p.position.x) * alpha,
      y: p.position.y + (next.position.y - p.position.y) * alpha, z: p.position.z + (next.position.z - p.position.z) * alpha}};
  });
  return {projectiles, effects: effects.map(effect => ({...effect, cells: data.cells[effect.cells] ?? []})), drops: before.drops};
}

export function replayUtilityThrow(data: ReplayUtilities | undefined, actorId: number, time: number) {
  let latest: ReplayUtilityEvent | undefined;
  for (const event of data?.events ?? []) if (event.action === 'throw' && event.actorId === actorId && event.time <= time &&
    time - event.time < 1 && (!latest || event.time >= latest.time)) latest = event;
  return latest;
}
