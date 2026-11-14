import {describe, expect, it, vi} from 'vitest';
import {BoxGeometry} from 'three';
import {NativeMapCollision, type NativeCollisionManifest} from './native-collision';
import type {NativeEntityDefinition} from './native-entities';
import {resolveBulletRay} from '../duel/penetration';
import {DuelSimulation} from '../duel/simulation';
import {sanitizeDuelConfig} from '../duel/config';
import {testArena} from '../duel/geometry';

const p = (x: number, y: number, z: number) => ({x, y, z});
function piece(id: string, x = 0, active = true): NativeEntityDefinition {
  const geometry = new BoxGeometry(.1, 2, 2).translate(x, 1, 0);
  const result = {id: `native:de_fixture:${id}`, model: 'fixture.vmdl', health: 10, active,
    targetname: id, enableOnBreak: [] as string[], vertices: Array.from(geometry.attributes.position.array), indices: Array.from(geometry.index!.array)};
  geometry.dispose(); return result;
}
async function map() {
  const floor = new BoxGeometry(20, .2, 20).translate(0, -.1, 0);
  const vertices = new Float32Array(floor.attributes.position.array), indices = new Uint32Array(floor.index!.array);
  const bytes = Buffer.concat([Buffer.from(vertices.buffer), Buffer.from(indices.buffer)]); floor.dispose();
  const manifest: NativeCollisionManifest = {version: 2, unit: .0254, build: 'fixture', collisionSha256: '',
    surfaces: [{id: 0, hash: 1}], groups: [{id: 0, offset: 0, vertexCount: vertices.length / 3, indexCount: indices.length,
      shots: true, movement: true, primitives: [{id: 0, firstTriangle: 0, triangleCount: indices.length / 3, surfaceId: 0, kind: 'convex-hull'}]}]};
  return NativeMapCollision.create(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
describe('mutable native map breakables', () => {
  it('breaks a native cover through a live Duel shot and restores it on the next simulation', async () => {
    const collision = await map(), cover = piece('cover');
    try {
      collision.installEntities({schema: 1, mapId: 'de_fixture', entities: [cover]}, () => {});
      const arena = {...testArena(), native: collision, spawns: {player: {feet: p(-2, 0, 0), yaw: -Math.PI / 2}, bots: [{feet: p(8, 0, -8), yaw: 0}]}};
      const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 1, botUtilities: false}), 2, arena);
      sim.start(); sim.command(1, {}); sim.command(0, {fireHeld: true, firePressed: true});
      sim.advance(.05);
      expect(collision.entityActive(cover.id)).toBe(false);
      expect(sim.drainEvents().some(event => event.kind === 'environment' && event.action === 'break' && event.environmentId === cover.id)).toBe(true);
      new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 3, arena);
      expect(collision.entityActive(cover.id)).toBe(true);
    } finally {collision.dispose();}
  });
  it('removes exact collision from shots, movement and grenades together; reset restores it', async () => {
    const collision = await map(), glass = piece('cover'), visibility = vi.fn();
    try {
      collision.installEntities({schema: 1, mapId: 'de_fixture', entities: [glass]}, visibility);
      const from = p(-2, 1, 0), to = p(2, 1, 0), dir = p(1, 0, 0);
      const prepared = collision.exportPrepared();
      expect(collision.ray(from, dir, 4)?.entityId).toBe(glass.id);
      expect(collision.traceSolid(from, dir, 4)[0].entityId).toBe(glass.id);
      expect(collision.sweep(p(-2, 0, 0), p(2, 0, 0), 1.8).fraction).toBeLessThan(1);
      expect(collision.sweepGrenade(from, to, .05).fraction).toBeLessThan(1);
      expect(collision.sweepSphere(from, to, .05).fraction).toBeLessThan(1);
      expect(collision.fits(p(0, 0, 0), 0, 1.8)).toBe(false);
      expect(collision.damageEntity(glass.id, 9)).toBeUndefined();
      expect(collision.damageEntity(glass.id, 1)?.id).toBe(glass.id);
      expect(visibility).toHaveBeenLastCalledWith(glass.id, false);
      expect(collision.ray(from, dir, 4)).toBeUndefined();
      expect(collision.sweep(p(-2, 0, 0), p(2, 0, 0), 1.8).fraction).toBe(1);
      expect(collision.sweepGrenade(from, to, .05).fraction).toBe(1);
      expect(collision.sweepSphere(from, to, .05).fraction).toBe(1);
      expect(collision.fits(p(0, 0, 0), 0, 1.8)).toBe(true);
      expect(collision.exportPrepared()).toEqual(prepared);
      collision.resetEntities(); expect(collision.ray(from, dir, 4)?.entityId).toBe(glass.id);
    } finally {collision.dispose();}
  });
  it('propagates native entity identity through bullet surface contacts', async () => {
    const collision = await map(), cover = piece('cover');
    try {
      collision.installEntities({schema: 1, mapId: 'de_fixture', entities: [cover]}, () => {});
      const ray = resolveBulletRay({origin: p(-2, 1, 0), direction: p(1, 0, 0), range: 4,
        equipment: 'ak47', arena: {solids: [], native: collision}, actors: []});
      expect(ray.contacts[0]).toMatchObject({kind: 'surface', phase: 'entry', environmentId: cover.id});
      expect(ray.stopped).toBe('surface');
    } finally {collision.dispose();}
  });
  it('enables native linked remainder only when the parent breaks and resets both', async () => {
    const collision = await map(), cover = {...piece('cover'), enableOnBreak: ['remainder']}, remainder = {...piece('remainder', 1, false), health: 0};
    try {
      collision.installEntities({schema: 1, mapId: 'de_fixture', entities: [cover, remainder]}, () => {});
      expect(collision.entityActive(remainder.id)).toBe(false);
      collision.damageEntity(cover.id, 10);
      expect(collision.entityActive(cover.id)).toBe(false); expect(collision.entityActive(remainder.id)).toBe(true);
      collision.resetEntities();
      expect(collision.entityActive(cover.id)).toBe(true); expect(collision.entityActive(remainder.id)).toBe(false);
    } finally {collision.dispose();}
  });
  it('does not let blast damage pass through another opaque cover', async () => {
    const collision = await map(), front = piece('front'), back = piece('back', 1);
    try {
      collision.installEntities({schema: 1, mapId: 'de_fixture', entities: [front, back]}, () => {});
      collision.damageEntitiesInRadius(p(-2, 1, 0), 8, () => 3);
      expect(collision.damageEntity(back.id, 7)).toBeUndefined();
      expect(collision.damageEntity(front.id, 7)?.id).toBe(front.id);
    } finally {collision.dispose();}
  });
  it('rejects corrupt native entity indices', async () => {
    const collision = await map();
    try {
      const valid = piece('valid');
      collision.installEntities({schema: 1, mapId: 'de_fixture', entities: [valid]}, () => {});
      expect(() => collision.installEntities({schema: 1, mapId: 'de_fixture', entities: [{...piece('bad'), indices: [0, 1, 999]}]}, () => {})).toThrow('Invalid native entity geometry');
      expect(collision.ray(p(-2, 1, 0), p(1, 0, 0), 4)?.entityId).toBe(valid.id);
    } finally {collision.dispose();}
  });
  it('never makes a native solid=0 visual remainder block bullets, players or grenades', async () => {
    const collision = await map(), cover = {...piece('cover'), enableOnBreak: ['remnant']};
    const remnant = {...piece('remnant', 1, false), health: 0, movement: false, shots: false, grenades: false};
    try {
      collision.installEntities({schema: 1, mapId: 'de_fixture', entities: [cover, remnant]}, () => {});
      collision.damageEntity(cover.id, 10); expect(collision.entityActive(remnant.id)).toBe(true);
      expect(collision.ray(p(-2, 1, 0), p(1, 0, 0), 4)).toBeUndefined();
      expect(collision.fits(p(1, 0, 0), 0, 1.8)).toBe(true);
      expect(collision.sweepGrenade(p(-2, 1, 0), p(2, 1, 0), .05).fraction).toBe(1);
    } finally {collision.dispose();}
  });
});
