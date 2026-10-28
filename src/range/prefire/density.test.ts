import {describe, expect, it} from 'vitest';
import density from './data/dust2-hold-density.json';
import {dust2Catalog, prefireRoutes} from './routes';
import {holdingEvidence, prefireCandidates} from './occupancy';

describe('published Dust 2 observed-round evidence', () => {
  it('publishes a complete bounded sample with pinned provenance, not invented population rates', () => {
    expect(density.sample).toMatchObject({matches: 32, rounds: 256, povs: 2560});
    expect(density.source.revision).toBe('8d7deddcd30c081fb197b75f58b4a0fba1117b9d');
    expect(density.source.files).toHaveLength(2564);
    expect(new Set(density.source.files.map(file => file[0])).size).toBe(2564);
    for (const file of density.source.files) expect(file[2]).toMatch(/^[a-f0-9]{64}$/);
    expect(density.confidence.population_probability).toBeNull();
    expect(density.confidence.confidence_interval).toBeNull();
    expect(density.source_diagnostics.site_conditioning_available).toBe(false);
    expect(density.quality.invalid_state_rows).toBe(0);
    expect(dust2Catalog.density).toBe(density);
  });
  it('keeps exact unionable round IDs, honest phase denominators and no duplicate observed cells', () => {
    expect(density.layers).toHaveLength(4);
    const cellKeys = new Set<string>();
    for (const layer of density.layers) {
      const sampled = new Set(layer.roundKeys), held = new Set<string>();
      expect(sampled.size).toBe(layer.rounds);
      expect(layer.rounds).toBe(layer.context === 'postplant' ? density.sample.plant_rounds : density.sample.rounds);
      for (const cell of density.cells.filter(cell => cell.side === layer.side && cell.context === layer.context)) {
        const key = JSON.stringify([cell.side, cell.context, cell.bin]);
        expect(cellKeys.has(key)).toBe(false); cellKeys.add(key);
        expect(new Set(cell.roundKeys).size).toBe(cell.rounds);
        expect(new Set(cell.roundKeys.map(key => key.split('/')[0])).size).toBe(cell.matches);
        for (const round of cell.roundKeys) {expect(sampled.has(round)).toBe(true); held.add(round);}
        expect(cell.position).toHaveLength(3); expect(cell.position.every(Number.isFinite)).toBe(true);
      }
      expect(held).toEqual(new Set(layer.holdingRoundKeys));
      expect(held.size).toBe(layer.roundsWithHolds);
    }
    expect(cellKeys.size).toBe(density.cells.length);
  });
  it('uses observed support, never a multiplier from repeated episode counts', () => {
    const samples = prefireRoutes.flatMap(route => prefireCandidates(route).map(angle => holdingEvidence(angle, route, density)));
    expect(samples.some(sample => sample.rounds > 10)).toBe(true);
    expect(samples.every(sample => sample.rounds <= sample.sampleRounds && sample.weight === 1 + sample.rounds)).toBe(true);
    expect(samples.every(sample => [density.sample.rounds, density.sample.plant_rounds].includes(sample.sampleRounds))).toBe(true);
  });
});
