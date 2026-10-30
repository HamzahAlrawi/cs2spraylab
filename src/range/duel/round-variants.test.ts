import {describe, expect, it, vi} from 'vitest';
import {Group} from 'three';
import data from './real-map-round-data.json';
import {chunkBounds, createRealMapArena, realMapChunks} from './real-map';
import {installNativeNavigation} from './native-navigation';
import {sanitizeDuelConfig} from './config';
import {realMapApproaches, realMapHoldPool, type RoundCatalog} from './real-map-rounds';
import {angleIdentity, prefireAnglesIncompatible} from '../prefire/occupancy';
import type {PrefireMap} from '../prefire/map';
import {dust2Catalog} from '../prefire/routes';

const catalog = data as unknown as RoundCatalog;

describe('offline real-map round variety', () => {
  it('covers all ten Prefire approaches in eight small selectable chunks', () => {
    expect(realMapChunks).toHaveLength(8);
    expect(new Set(realMapChunks.flatMap(chunk => realMapApproaches(chunk,dust2Catalog).map(route => route.id))).size).toBe(10);
    for (const chunk of realMapChunks) {
      expect(realMapHoldPool(chunk,dust2Catalog).length).toBeGreaterThan(10);
      expect(catalog.chunks[chunk.id].collisionSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(catalog.chunks[chunk.id].courses.length).toBeGreaterThan(0);
    }
  });

  it.each(realMapChunks)('$id varies covered starts and compatible rosters without runtime physics authoring', chunk => {
    const baked = catalog.chunks[chunk.id], query = vi.fn(() => {throw new Error('Round creation must use the offline catalog');});
    const collision = {collisionSha256: baked.collisionSha256, vertical: query, fits: query, ray: query, sweep: query};
    const bounds = chunkBounds(chunk);
    installNativeNavigation({...bounds, solids: [], native: collision}, {version: 1,
      nodes: [{point: {x: (bounds.minX + bounds.maxX) / 2, y: 0, z: (bounds.minZ + bounds.maxZ) / 2}, links: []}]});
    const map = {collision, scene: new Group()} as unknown as PrefireMap;
    const starts = new Set<string>(), occupied = new Set<string>();
    for (let seed = 0; seed < 16; seed++) {
      const arena = createRealMapArena(map, chunk, sanitizeDuelConfig({botCount: 5,realMapCourse:'shuffle'}), seed,catalog.chunks[chunk.id],dust2Catalog);
      const course = baked.courses.find(course => course.id === arena.roundSetup!.course)!;
      const start = course.starts.find(start => start.viewIndex === arena.roundSetup!.start)!;
      starts.add(`${course.id}:${start.viewIndex}`);
      expect(arena.spawns!.player.feet).toEqual(start.feet);
      expect(arena.lanes!.length).toBeGreaterThan(5); expect(arena.lanes!.length).toBeLessThanOrEqual(32);
      expect(arena.spawns!.bots).toHaveLength(5);
      const angles = arena.roundSetup!.holds.map(id => {
        occupied.add(id); expect(start.holds).toContain(id);
        return course.holds.find(hold => angleIdentity(hold.angle) === id)!.angle;
      });
      for (let i = 0; i < angles.length; i++) for (let j = i + 1; j < angles.length; j++)
        expect(prefireAnglesIncompatible(angles[i], angles[j])).toBe(false);
      expect(createRealMapArena(map, chunk, sanitizeDuelConfig({botCount: 5,realMapCourse:'shuffle'}), seed,catalog.chunks[chunk.id],dust2Catalog).roundSetup).toEqual(arena.roundSetup);
    }
    expect(starts.size).toBeGreaterThan(3);
    expect(occupied.size).toBeGreaterThan(8);
    expect(query).not.toHaveBeenCalled();
  });
});
