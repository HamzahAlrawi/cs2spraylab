import {describe, expect, it} from 'vitest';
import {dust2Catalog, prefireRoutes} from './routes';
import {choosePrefireEncounter} from './encounters';
import {prefireAnglesIncompatible} from './occupancy';
import {randomStream} from '../duel/rng';
import {sanitizePrefireConfig} from './config';

describe('contextual selection in the shipped catalog', () => {
  it('preserves the saved mode and uses a labeled fallback when no certified corpus exists', () => {
    expect(sanitizePrefireConfig({population: 'contextual'}).population).toBe('contextual');
    expect(dust2Catalog.encounters).toBeUndefined();
  });
  it.each(prefireRoutes)('has complete compatible authored fallback lineups for $name', route => {
    for (let seed = 1; seed <= 8; seed++) {
      const selected = choosePrefireEncounter(dust2Catalog, route, randomStream(seed, 'encounter'), {build: {
        mapId: dust2Catalog.id, catalogRevision: dust2Catalog.revision, gameBuild: 'unmeasured-test', geometrySha256: '0'.repeat(64)}});
      expect(selected.mode).toBe('authored-coverage'); expect(selected.fallbackReason).toBe('no-evidence');
      expect(selected.angles.length).toBeGreaterThan(0); expect(selected.angles.length).toBeLessThanOrEqual(5);
      expect(selected.evidence.confidence).toBe('unknown');
      expect(selected.angles.every((angle, index) => selected.angles.slice(0, index).every(other => !prefireAnglesIncompatible(angle, other)))).toBe(true);
    }
  });
});
