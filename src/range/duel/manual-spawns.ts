import {UNIT, type Vec} from '../actor-physics';
import type {NativeMapCollision} from '../prefire/native-collision';
import {revealsPrefireStart} from '../prefire/bot-behavior';
import catalog from './real-map-catalog.json';
import type {Arena, ArenaSpawn, CoverLane} from './geometry';

export type SpawnPose = {feet: Vec; yaw: number; pitch: number};
export type ManualSpawn = SpawnPose & {id: string; name: string};
export type SpawnContext = {chunkId: string; collisionSha256: string};
export type ManualLineup = SpawnContext & {
  id: string; name: string; entry: ManualSpawn; bots: ManualSpawn[]; allowImmediateSight: boolean;
};
export type ManualLineupDraft = Omit<ManualLineup, 'entry'> & {entry?: ManualSpawn};
export type SpawnAuthoringEngine = {
  captureSpawnPose(): SpawnPose | undefined;
  setSpawnAuthoring(enabled: boolean): boolean;
};
export type LineupValidation = {errors: string[]; warnings: string[]};
export const MANUAL_SPAWN_KEY = 'spraylab.duel.manual-spawns.v1';
export const MANUAL_SPAWN_LIMITS = {bytes: 192 * 1024, lineups: 64, perChunk: 12, bots: 5, name: 64} as const;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 &&
  value.trim().length <= max && !/[\u0000-\u001f]/.test(value) ? value.trim() : undefined;
const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,80}$/.test(value) ? value : undefined;
const number = (value: unknown, limit: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

export function parseSpawnPose(raw: unknown): SpawnPose | undefined {
  const value = record(raw), feet = record(value.feet);
  if (![feet.x, feet.y, feet.z].every(n => number(n, 10000)) || !number(value.yaw, 1000000) ||
    !number(value.pitch, Math.PI / 2)) return;
  return {feet: {x: feet.x as number, y: feet.y as number, z: feet.z as number}, yaw: value.yaw, pitch: value.pitch};
}
function parseSpawn(raw: unknown): ManualSpawn | undefined {
  const value = record(raw), pose = parseSpawnPose(value), key = id(value.id), name = text(value.name, MANUAL_SPAWN_LIMITS.name);
  return pose && key && name ? {...pose, id: key, name} : undefined;
}
export function parseManualLineup(raw: unknown): ManualLineup | undefined {
  const value = record(raw), key = id(value.id), name = text(value.name, MANUAL_SPAWN_LIMITS.name), entry = parseSpawn(value.entry);
  if (!key || !name || !entry || !catalog.chunks.some(chunk => chunk.id === value.chunkId) ||
    typeof value.collisionSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.collisionSha256) ||
    typeof value.allowImmediateSight !== 'boolean' || !Array.isArray(value.bots) ||
    value.bots.length < 1 || value.bots.length > MANUAL_SPAWN_LIMITS.bots) return;
  const bots = value.bots.map(parseSpawn);
  if (bots.some(bot => !bot) || new Set([entry.id, ...bots.map(bot => bot!.id)]).size !== bots.length + 1) return;
  return {id: key, name, chunkId: value.chunkId as string, collisionSha256: value.collisionSha256,
    entry, bots: bots as ManualSpawn[], allowImmediateSight: value.allowImmediateSight};
}

export function importManualLineups(serialized: string): ManualLineup[] {
  if (new TextEncoder().encode(serialized).byteLength > MANUAL_SPAWN_LIMITS.bytes) throw new Error('Lineup file exceeds 192 KiB.');
  const value = record(JSON.parse(serialized));
  if (value.version !== 1 || !Array.isArray(value.lineups) || value.lineups.length > MANUAL_SPAWN_LIMITS.lineups)
    throw new Error('Unsupported lineup library.');
  const parsed = value.lineups.map(parseManualLineup);
  if (parsed.some(lineup => !lineup)) throw new Error('Invalid lineup or spawn coordinates.');
  const lineups = parsed as ManualLineup[];
  if (new Set(lineups.map(lineup => `${lineup.chunkId}:${lineup.id}`)).size !== lineups.length ||
    catalog.chunks.some(chunk => lineups.filter(lineup => lineup.chunkId === chunk.id).length > MANUAL_SPAWN_LIMITS.perChunk))
    throw new Error('Duplicate lineups or too many lineups for one chunk.');
  return lineups;
}
export function exportManualLineups(lineups: readonly ManualLineup[]): string {
  const serialized = JSON.stringify({version: 1, lineups}, null, 2);
  importManualLineups(serialized);
  return serialized;
}
export function mergeManualLineups(current: readonly ManualLineup[], incoming: readonly ManualLineup[]): ManualLineup[] {
  const merged = current.filter(old => !incoming.some(next => old.id === next.id && old.chunkId === next.chunkId));
  return importManualLineups(exportManualLineups([...merged, ...incoming]));
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
export function loadManualLineups(storage: Storage): {lineups: ManualLineup[]; error?: string} {
  try {const saved = storage.getItem(MANUAL_SPAWN_KEY); return {lineups: saved === null ? [] : importManualLineups(saved)};}
  catch {return {lineups: [], error: 'Saved lineups could not be read. Existing storage was not changed.'};}
}
export function saveManualLineups(storage: Storage, lineups: readonly ManualLineup[]) {
  storage.setItem(MANUAL_SPAWN_KEY, exportManualLineups(lineups));
}

type Collision = Pick<NativeMapCollision, 'collisionSha256' | 'fits' | 'vertical' | 'ray' | 'sweep'>;
export function validateManualLineup(raw: unknown, context: SpawnContext, collision: Collision): LineupValidation {
  const errors: string[] = [], warnings: string[] = [], lineup = parseManualLineup(raw);
  if (!lineup) return {errors: ['Name the lineup, capture a player entry and add one to five named holds.'], warnings};
  if (lineup.chunkId !== context.chunkId || lineup.collisionSha256 !== context.collisionSha256 ||
    collision.collisionSha256 !== context.collisionSha256)
    return {errors: ['This lineup belongs to a different chunk or collision revision. Recapture it on the loaded map.'], warnings};
  const chunk = catalog.chunks.find(chunk => chunk.id === context.chunkId)!;
  const points = [lineup.entry, ...lineup.bots];
  for (const point of points) {
    const {feet} = point, source = [feet.x / UNIT, -feet.z / UNIT, feet.y / UNIT];
    if (source.some((n, axis) => n < chunk.sourceMin[axis] + (axis < 2 ? 17 : 0) ||
      n > chunk.sourceMax[axis] - (axis < 2 ? 17 : 0))) {errors.push(`${point.name}: outside the playable chunk.`); continue;}
    const floor = collision.vertical(feet, feet.y + UNIT, feet.y - UNIT, 72 * UNIT);
    if (!floor.grounded || Math.abs(floor.feet - feet.y) > UNIT || !collision.fits(feet, feet.y, 72 * UNIT))
      errors.push(`${point.name}: no supported standing hull at the captured feet.`);
  }
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const a = points[i].feet, b = points[j].feet;
    if (Math.abs(a.x - b.x) < 32 * UNIT && Math.abs(a.z - b.z) < 32 * UNIT && Math.abs(a.y - b.y) < 72 * UNIT)
      errors.push(`${points[i].name} overlaps ${points[j].name}.`);
  }
  if (!errors.length) {
    const eye = {...lineup.entry.feet, y: lineup.entry.feet.y + 64 * UNIT};
    for (const bot of lineup.bots) if (revealsPrefireStart(collision, bot.feet, false, eye, bot.yaw))
      warnings.push(`${bot.name} is visible from the player entry.`);
  }
  if (warnings.length && !lineup.allowImmediateSight) errors.push('Acknowledge immediate sightlines to use this intentional setup.');
  return {errors, warnings};
}

export function manualLineupFromArena(context: SpawnContext, arena: Arena, key: string): ManualLineup {
  if (!arena.spawns) throw new Error('No native round spawns are available.');
  const point = (spawn: ArenaSpawn, id: string, name: string): ManualSpawn => ({id, name,
    feet: {...spawn.feet}, yaw: spawn.yaw, pitch: spawn.pitch ?? 0});
  return {...context, id: key, name: 'My lineup', allowImmediateSight: false,
    entry: point(arena.spawns.player, 'entry', 'Player entry'), bots: arena.spawns.bots.map((spawn, index) =>
      point(spawn, `hold-${index + 1}`, `Hold ${index + 1}`))};
}

// Called only before simulation/brain construction. Captured coordinates are
// never snapped, randomized, or assigned to existing actors.
export function applyManualLineup(arena: Arena, lineup: ManualLineup): Arena {
  const lanes: CoverLane[] = lineup.bots.map((bot, index) => ({side: index % 2 ? -1 : 1,
    anchor: {...bot.feet}, edge: {...bot.feet}, retreat: {...bot.feet}, role: 'camp',
    axis: {x: Math.cos(bot.yaw), z: -Math.sin(bot.yaw)},
    watch: {x: bot.feet.x - Math.sin(bot.yaw) * 8, y: bot.feet.y + 64 * UNIT + Math.tan(bot.pitch) * 8,
      z: bot.feet.z - Math.cos(bot.yaw) * 8}}));
  return {...arena, lanes, spawns: {player: {...lineup.entry, feet: {...lineup.entry.feet}},
    bots: lineup.bots.map((bot, lane) => ({...bot, feet: {...bot.feet}, lane}))},
    roundSetup: {course: `manual:${lineup.id}`, start: 0, holds: lineup.bots.map(bot => bot.id)},
    tactical: {entry: {...lineup.entry.feet}, watchPoints: lanes.map(lane => lane.watch!),
      searchPoints: lineup.bots.map(bot => ({...bot.feet}))}};
}
