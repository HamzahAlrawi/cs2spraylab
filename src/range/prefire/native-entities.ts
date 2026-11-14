import RAPIER from '@dimforge/rapier3d-compat';
import type {Vec} from '../actor-physics';
import type {HullSweep} from '../actor-collision';
import type {NativeSurfaceInterval} from './native-surfaces';

export type NativeEntityDefinition = Readonly<{id: string; model: string; health: number; active: boolean;
  movement?: boolean; shots?: boolean; grenades?: boolean;
  targetname: string; enableOnBreak: readonly string[]; vertices: readonly number[]; indices: readonly number[]}>;
export type NativeEntityManifest = Readonly<{schema: number; mapId: string; entities: readonly NativeEntityDefinition[]}>;
export type NativeEntityBreak = {id: string; point: Vec};
export type NativeEntityControls = {
  resetEntities?(): void;
  damageEntity?(id: string, damage: number): NativeEntityBreak | undefined;
  damageEntitiesInRadius?(point: Vec, radius: number, damageAtDistance: (distance: number) => number): NativeEntityBreak[];
};
const rotation = {x: 0, y: 0, z: 0, w: 1};
const movementGroup = (1 << 16) | 1, shotGroup = (2 << 16) | 2, grenadeGroup = (4 << 16) | 4;

/** Separate mutable native PHYS. Never edits the immutable map/query-cache mesh. */
export class NativeMapEntities {
  private readonly world = new RAPIER.World({x: 0, y: 0, z: 0});
  private readonly pieces: {definition: NativeEntityDefinition; collider: RAPIER.Collider; health: number; active: boolean; center: Vec}[] = [];
  private readonly handles = new Map<number, number>();
  constructor(manifest: NativeEntityManifest, private readonly visibility: (id: string, visible: boolean) => void) {
    try {
      if (manifest.schema !== 1 || !/^de_[a-z0-9_]+$/.test(manifest.mapId) || !Array.isArray(manifest.entities) || manifest.entities.length > 128)
        throw Error('Invalid native entity manifest');
      const ids = new Set<string>(); let total = 0;
      for (const definition of manifest.entities) {
        const {vertices, indices} = definition; total += vertices.length + indices.length;
        if (!definition.id.startsWith(`native:${manifest.mapId}:`) || ids.has(definition.id) ||
          !Number.isFinite(definition.health) || definition.health < 0 || typeof definition.active !== 'boolean' ||
          [definition.movement, definition.shots, definition.grenades].some(value => value !== undefined && typeof value !== 'boolean') ||
          typeof definition.targetname !== 'string' || !Array.isArray(definition.enableOnBreak) ||
          definition.enableOnBreak.some((name: unknown) => typeof name !== 'string') ||
          !Array.isArray(vertices) || vertices.length < 9 || vertices.length % 3 || vertices.some(n => !Number.isFinite(n)) ||
          !Array.isArray(indices) || indices.length < 3 || indices.length % 3 ||
          indices.some(n => !Number.isSafeInteger(n) || n < 0 || n >= vertices.length / 3) || total > 1_000_000)
          throw Error('Invalid native entity geometry');
        ids.add(definition.id);
        const bits = Number(definition.movement !== false) | Number(definition.shots !== false) * 2 | Number(definition.grenades !== false) * 4;
        const collider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices))
          .setCollisionGroups((bits << 16) | bits));
        const min = {x: Infinity, y: Infinity, z: Infinity}, max = {x: -Infinity, y: -Infinity, z: -Infinity};
        for (let i = 0; i < vertices.length; i += 3) for (const [j, axis] of ['x', 'y', 'z'].entries()) {
          min[axis as keyof Vec] = Math.min(min[axis as keyof Vec], vertices[i + j]);
          max[axis as keyof Vec] = Math.max(max[axis as keyof Vec], vertices[i + j]);
        }
        this.handles.set(collider.handle, this.pieces.length);
        this.pieces.push({definition, collider, health: definition.health, active: definition.active,
          center: {x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2}});
      }
      this.reset();
    } catch (error) {this.world.free(); throw error;}
  }
  reset() {
    for (const piece of this.pieces) {piece.health = piece.definition.health; this.setActive(piece, piece.definition.active);}
    this.world.step();
  }
  private setActive(piece: typeof this.pieces[number], active: boolean) {
    piece.active = active; piece.collider.setEnabled(active); this.visibility(piece.definition.id, active);
  }
  isActive(id: string) {return this.pieces.find(piece => piece.definition.id === id)?.active ?? true;}
  damage(id: string, damage: number): NativeEntityBreak | undefined {
    const piece = this.pieces.find(piece => piece.definition.id === id);
    if (!piece?.active || piece.definition.health <= 0 || !(damage > 0) || !Number.isFinite(damage)) return;
    piece.health = Math.max(0, piece.health - damage);
    if (piece.health > 0) return;
    this.setActive(piece, false);
    for (const other of this.pieces) if (piece.definition.enableOnBreak.includes(other.definition.targetname)) this.setActive(other, true);
    this.world.step();
    return {id, point: {...piece.center}};
  }
  damageInRadius(point: Vec, radius: number, damageAtDistance: (distance: number) => number,
    visible: (center: Vec, id: string) => boolean) {
    const events: NativeEntityBreak[] = [];
    for (const piece of this.pieces) {
      const distance = Math.hypot(point.x - piece.center.x, point.y - piece.center.y, point.z - piece.center.z);
      if (distance >= radius || !visible(piece.center, piece.definition.id)) continue;
      const event = this.damage(piece.definition.id, damageAtDistance(distance));
      if (event) events.push(event);
    }
    return events;
  }
  ray(origin: Vec, direction: Vec, range: number) {
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(origin, direction), range, true, undefined, shotGroup);
    if (!hit) return;
    const index = this.handles.get(hit.collider.handle)!;
    return {distance: hit.timeOfImpact, normal: {...hit.normal}, surfaceId: -1000 - index, entityId: this.pieces[index].definition.id};
  }
  traceSolid(origin: Vec, direction: Vec, range: number): NativeSurfaceInterval[] {
    return this.pieces.flatMap((piece, index) => {
      if (!piece.active || piece.definition.shots === false) return [];
      const hit = piece.collider.castRayAndGetNormal(new RAPIER.Ray(origin, direction), range, true);
      // Unknown surface inheritance/exit arithmetic stays opaque, never guessed.
      return hit ? [{entry: hit.timeOfImpact, entryNormal: {...hit.normal}, surfaceId: -1000 - index,
        entityId: piece.definition.id, validated: false}] : [];
    });
  }
  fits(position: Vec, height: number, radius: number) {
    return !this.world.intersectionWithShape({x: position.x, y: position.y + height / 2, z: position.z}, rotation,
      new RAPIER.Cuboid(radius, height / 2, radius), undefined, movementGroup);
  }
  sweep(from: Vec, to: Vec, shape: RAPIER.Shape, grenade = false): HullSweep {
    const delta = {x: to.x - from.x, y: to.y - from.y, z: to.z - from.z}, length = Math.hypot(delta.x, delta.y, delta.z);
    if (length < 1e-10) return {position: {...to}, fraction: 1, startSolid: false};
    const hit = this.world.castShape(from, rotation, delta, shape, .0001, 1, false, undefined, grenade ? grenadeGroup : movementGroup);
    if (!hit) return {position: {...to}, fraction: 1, startSolid: false};
    const fraction = Math.max(0, Math.min(1, hit.time_of_impact - .001 / length));
    return {position: {x: from.x + delta.x * fraction, y: from.y + delta.y * fraction, z: from.z + delta.z * fraction}, fraction,
      startSolid: false, contact: {normal: {...hit.normal1}}};
  }
  dispose() {this.world.free(); this.pieces.length = 0; this.handles.clear();}
}
