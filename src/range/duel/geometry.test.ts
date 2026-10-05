import {describe, expect, it} from 'vitest';
import {UNIT} from '../actor-physics';
import {arenaPOIs, environmentPOIs, placePOI} from './arena-pois';
import {createEnvironmentState, damageEnvironmentPiece, environmentTerrainWorld} from './environment';
import {surfaceHeight} from '../terrain';
import {canFitInArena, materialForSurface, rayBox, rayBoxInterval, raySolidInterval, solidTopAt,
  testArena, traceSolid, traceSolidEntries, type Solid} from './geometry';

const p = (x = 0, y = 0, z = 0) => ({x, y, z});
const box: Solid = {id: 'box', material: 'wood', center: p(0, 1), size: p(2, 2, 2)};

describe('environment ray entry and exit contract', () => {
  it('returns geometric thickness, ordered surfaces and face normals without clipping exits to weapon range', () => {
    const arena = {...testArena(), solids: [box, {...box, id: 'back', material: 'metal' as const, center: p(0, 1, 4)}]};
    const hit = traceSolid(p(0, 1, -4), p(0, 0, 1), arena, 3.1);
    expect(hit.distance).toBe(3); expect(hit.exitDistance).toBe(5); expect(hit.thickness).toBe(2);
    expect(hit.entry).toEqual(p(0, 1, -1)); expect(hit.exit).toEqual(p(0, 1, 1));
    expect(hit.normal).toEqual(p(0, 0, -1)); expect(hit.exitNormal).toEqual(p(0, 0, 1));
    expect(hit.pieceId).toBe('box'); expect(hit.material).toBe('wood'); expect(hit.surfaceId).toBe(0);
    expect(materialForSurface(arena, 1)).toBe('metal'); expect(materialForSurface(arena, -1)).toBeUndefined();
    expect(traceSolidEntries(p(0, 1, -4), p(0, 0, 1), arena).map(h => h.pieceId)).toEqual(['box', 'back']);
  });
  it('handles inside starts, parallel misses, negative axes and non-unit ray thickness', () => {
    const min = p(-1, 0, -1), max = p(1, 2, 1);
    expect(rayBoxInterval(p(0, 1), p(0, 0, 1), min, max)?.entryDistance).toBe(0);
    expect(rayBoxInterval(p(0, 1), p(0, 0, 1), min, max)?.exitDistance).toBe(1);
    expect(rayBox(p(2, 1, -4), p(0, 0, 1), min, max)).toBe(Infinity);
    expect(rayBox(p(0, 1, 4), p(0, 0, -1), min, max)).toBe(3);
    expect(rayBox(p(0, 1, -4), p(), min, max)).toBe(Infinity);
    const hit = traceSolid(p(0, 1, -4), p(0, 0, 2), {...testArena(), solids: [box]});
    expect(hit.thickness).toBe(2); expect(hit.distance).toBe(1.5);
  });
  it('keeps numeric indices stable after destroyed pieces are skipped', () => {
    const glass: Solid = {...box, id: 'glass', material: 'glass', health: 10, interaction: {kind: 'breakable', debris: 'glass'}};
    const arena = {...testArena(), solids: [glass, {...box, id: 'back', center: p(0, 1, 4)}]}, state = createEnvironmentState(arena);
    const damaged = damageEnvironmentPiece(arena, state, 'glass', 10).state;
    const hit = traceSolid(p(0, 1, -4), p(0, 0, 1), arena, 20, damaged);
    expect(hit.surfaceId).toBe(1); expect(hit.pieceId).toBe('back'); expect(arena.solids).toHaveLength(2);
  });
  it('preserves tangent hull clearance without admitting actual overlap', () => {
    const arena = {...testArena(), solids: [box]};
    expect(canFitInArena(p(1 + 16 * UNIT, 0), 0, 72 * UNIT, arena)).toBe(true);
    expect(canFitInArena(p(1 + 16 * UNIT - .001, 0), 0, 72 * UNIT, arena)).toBe(false);
    expect(rayBoxInterval(p(0, 1), p(NaN, 0, 1), p(-1, 0, -1), p(1, 2, 1))).toBeUndefined();
  });
  it.each(['x', 'z'] as const)('clips the actual %s wedge with matching collision and terrain-worker heights', axis => {
    for (const highSide of [-1, 1] as const) {
      const ramp: Solid = {id: 'ramp', material: 'concrete', center: p(0, 1), size: p(4, 2, 4), shape: {kind: 'ramp', axis, highSide}};
      const arena = {...testArena(), solids: [ramp]}, terrain = environmentTerrainWorld(arena).solids[0];
      expect(terrain.traversal).toMatchObject({kind: 'ramp', axis, rise: 2, direction: highSide});
      for (const at of [-1.8, 0, 1.8]) {
        const x = axis === 'x' ? at : 0, z = axis === 'z' ? at : 0;
        const top = solidTopAt(ramp, x, z)!;
        expect(top).toBeCloseTo(1 + highSide * at / 2);
        expect(surfaceHeight(terrain, x, z, 0)).toBeCloseTo(top);
        const hit = raySolidInterval(p(x, 4, z), p(0, -1), ramp)!;
        expect(hit.entryDistance).toBeCloseTo(4 - top); expect(hit.exitDistance).toBe(4);
        expect(hit.entryNormal.y).toBeCloseTo(1 / Math.hypot(1, .5));
        const hullTop = solidTopAt(ramp, x, z, 16 * UNIT)!;
        expect(canFitInArena(p(x, hullTop, z), hullTop, 72 * UNIT, arena)).toBe(true);
      }
      const along = p(0, 1.8); along[axis] = -highSide * 3;
      const direction = p(); direction[axis] = highSide;
      expect(raySolidInterval(along, direction, ramp)!.entryDistance).toBeCloseTo(4.6);
    }
  });
  it('maps ladder/water volumes without including them in bullet or solid arrays', () => {
    for (const template of environmentPOIs.filter(t => t.volumes?.length)) {
      const placed = placePOI(template, p(), -1, -1, 'terrain', 0);
      const arena = {...testArena(), solids: placed.solids, traversalVolumes: placed.volumes};
      const world = environmentTerrainWorld(arena);
      expect(world.solids.length).toBe(arena.solids.length + placed.volumes.length);
      for (const volume of placed.volumes) {
        const collider = world.solids.find(s => s.id === volume.id)!;
        expect(collider.traversal?.kind).toBe(volume.kind);
        if (volume.ladder) expect(collider.traversal).toMatchObject({normal: p(0, 0, 1)});
      }
    }
    expect(arenaPOIs.every(t => t.parts.every(s => s.material !== undefined))).toBe(true);
  });
});
