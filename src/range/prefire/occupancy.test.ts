import {describe, expect, it} from 'vitest';
import {randomStream} from '../duel/rng';
import {choosePrefireAngles, holdingEvidence, matchBalancedSupport, selectionWeights, PREFIRE_WEIGHT_POLICY} from './occupancy';
import type {HoldingDensity, PrefireRoute} from './schema';

const route: PrefireRoute = {id: 'fixture', name: 'Fixture', enemySide: 'ct', phase: 'preplant',
  spawn: [0, -200, 0], look: [0, 0, 0], path: [[0, 0, 0]],
  angles: Array.from({length: 5}, (_, index) => ({id: `angle-${index}`, name: `Angle ${index}`, position: [index * 512, 300, 0] as const}))};
const density: HoldingDensity = {schemaVersion: 1, mapId: 'fixture',
  source: {url: 'https://example.test/pinned', revision: 'fixture', license: 'CC-BY-4.0', author: 'Fixture'},
  sample: {matches: 8, rounds: 48, povs: 480},
  layers: [{side: 'ct', context: 'preplant', rounds: 48, roundKeys: Array.from({length: 48}, (_, i) => `match/${i}`)}],
  cells: [{position: route.angles[0].position, side: 'ct', context: 'preplant',
    episodeAnchors: 81, seconds: 150, rounds: 20, matches: 8, roundKeys: Array.from({length: 20}, (_, i) => `match/${i}`)}]};

describe('regional evidence and coverage-first training selection', () => {
  it('uses Source-unit positions and the correct side/phase without promoting a kill heatmap to holding evidence', () => {
    expect(holdingEvidence(route.angles[0], route, density)).toMatchObject({episodes: 81, seconds: 150, rounds: 20, sampleRounds: 48, weight: 21});
    expect(holdingEvidence(route.angles[0], {...route, enemySide: 't'}, density).weight).toBe(1);
    expect(holdingEvidence(route.angles[0], {...route, phase: 'postplant'}, density).weight).toBe(1);
    expect(holdingEvidence(route.angles[1], route, density)).toMatchObject({episodes: 0, matchedCells: 0, weight: 1});
    expect(holdingEvidence({...route.angles[0], position: [0, 300, 64]}, route, density).weight).toBe(1);
  });
  it('unions distinct rounds, not cells, repeat episodes, time or unverified cell counts', () => {
    const cells = [density.cells[0], {...density.cells[0], position: [32, 300, 0], episodeAnchors: 10000,
      rounds: 1000, roundKeys: ['match/0', 'match/19', 'match/20', 'not-an-eligible-round']}];
    expect(holdingEvidence(route.angles[0], route, {...density, cells})).toMatchObject({rounds: 21, sampleRounds: 48, weight: 22});
    expect(holdingEvidence(route.angles[0], route, {...density, layers: undefined}).weight).toBe(1);
    expect(holdingEvidence(route.angles[0], route, {...density, cells: [{...density.cells[0], roundKeys: undefined}]}).weight).toBe(1);
    expect(holdingEvidence(route.angles[0], route, {...density, cells: [{...density.cells[0], episodeAnchors: 0}]}).rounds).toBe(20);
    const layers = [{...density.layers![0], rounds: 999, roundKeys: ['match/0', 'match/0', 'match/1']}];
    expect(holdingEvidence(route.angles[0], route, {...density, layers})).toMatchObject({rounds: 2, sampleRounds: 2});
  });
  it('counts independent supporting matches separately from repeated rounds', () => {
    const layers = [{...density.layers![0], roundKeys: ['one/1', 'one/2', 'two/1', 'three/1']}];
    const cells = [{...density.cells[0], roundKeys: ['one/1', 'one/2', 'two/1', 'excluded/1']}];
    expect(holdingEvidence(route.angles[0], route, {...density, layers, cells})).toMatchObject({
      rounds: 3, matches: 2, sampleRounds: 4, sampleMatches: 3,
    });
  });
  it('does not smear nearby corners or a separate floor into the candidate', () => {
    for (const position of [[97, 300, 0], [0, 300, 25], [0, 300, -25]]) {
      expect(holdingEvidence(route.angles[0], route, {...density, cells: [{...density.cells[0], position}]}).rounds).toBe(0);
    }
  });
  it('retains an explicit exploration prior without inventing observations for absent or malformed data', () => {
    expect(holdingEvidence(route.angles[0], route)).toMatchObject({episodes: 0, weight: 1});
    const cells = [density.cells[0], {...density.cells[0], episodeAnchors: Infinity},
      {...density.cells[0], position: [NaN, 300, 0]}];
    expect(holdingEvidence(route.angles[0], route, {...density, cells}).episodes).toBe(81);
    expect(holdingEvidence(route.angles[0], route, {...density, schemaVersion: 999}).episodes).toBe(0);
  });
  it('is reproducible, never empty, and preserves authored clearing order and actor budget', () => {
    for (let seed = 0; seed < 100; seed++) {
      const selected = choosePrefireAngles(route, 'random', randomStream(seed, 'occupancy'), density);
      expect(selected).toEqual(choosePrefireAngles(route, 'random', randomStream(seed, 'occupancy'), density));
      expect(selected.length).toBeGreaterThanOrEqual(1); expect(selected.length).toBeLessThanOrEqual(5);
      expect(selected).toEqual(route.angles.filter(angle => selected.includes(angle)));
    }
  });
  it('makes observed common holds more likely but still leaves empty and rare angles across runs', () => {
    const counts = [0, 0, 0, 0, 0];
    for (let seed = 0; seed < 12000; seed++) {
      const selected = choosePrefireAngles(route, 'random', randomStream(seed, 'weighted-statistics'), density, 3);
      expect(selected).toHaveLength(3);
      for (const angle of selected) counts[route.angles.indexOf(angle)]++;
    }
    expect(counts[0]).toBeGreaterThan(counts[1] * 1.7);
    expect(counts[1]).toBeGreaterThan(1000); expect(counts[0]).toBeLessThan(12000);
  }, 15000);
  it('deduplicates source identities and prevents overlapping or mutually exclusive holds', () => {
    const alternatives = {...route, angles: [route.angles[0], {...route.angles[0]},
      {...route.angles[1], exclusionGroup: 'corner'}, {...route.angles[2], exclusionGroup: 'corner'},
      {...route.angles[3], position: [10, 300, 0] as const}]};
    let observedGroups = 0;
    for (let seed = 0; seed < 30; seed++) {
      const selected = choosePrefireAngles(alternatives, 'random', randomStream(seed, 'groups'), density);
      const groups = selected.filter(angle => angle.exclusionGroup === 'corner').length;
      expect(groups).toBeLessThanOrEqual(1); observedGroups += groups;
      expect(selected.filter(angle => angle.position[0] < 20).length).toBeLessThanOrEqual(1);
    }
    expect(observedGroups).toBeGreaterThan(0);
    expect(() => choosePrefireAngles(alternatives, 'all', () => 0)).toThrow('incompatible holds');
    expect(() => choosePrefireAngles({...route, angles: [...route.angles, {...route.angles[0], id: 'sixth'}]}, 'all', () => 0)).toThrow('actor budget');
    expect(() => choosePrefireAngles({...route, angles: []}, 'random', () => 0)).toThrow('no validated angles');
  });
  it('keeps exhaustive learning explicit rather than applying occupancy draws to every angle', () => {
    expect(choosePrefireAngles(route, 'all', () => {throw new Error('Unexpected draw');}, density)).toEqual(route.angles);
  });
  it('uses a wider pool only in weighted practice and maintains density despite blocking alternatives', () => {
    const alternate = {...route.angles[0], id: 'alternate', position: [512 - 20, 300, 0] as const};
    const expanded = {...route, alternatives: [alternate, ...route.angles]};
    let alternatives = 0;
    for (let seed = 0; seed < 100; seed++) {
      const selected = choosePrefireAngles(expanded, 'random', randomStream(seed, 'alternates'), density, 5);
      expect(selected).toHaveLength(5);
      alternatives += Number(selected.includes(alternate));
    }
    expect(alternatives).toBeGreaterThan(0);
    expect(choosePrefireAngles(expanded, 'all', () => 0)).toEqual(route.angles);
    // A bridge overlapping two compatible holds cannot be picked at the expense of density.
    const compact = {...route, angles: [route.angles[0], {...route.angles[1], position: [50, 300, 0] as const}],
      alternatives: [{...alternate, position: [25, 300, 0] as const}]};
    for (let seed = 0; seed < 20; seed++) expect(choosePrefireAngles(compact, 'random', randomStream(seed, 'bridge'), undefined, 2))
      .toEqual(compact.angles);
  });
  it('does not silently leave an arbitrary number of slots empty', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(choosePrefireAngles(route, 'random', randomStream(seed, 'dense'), density)).toHaveLength(4);
      expect(choosePrefireAngles(route, 'random', randomStream(seed, 'dense'), density, 5)).toHaveLength(5);
    }
  });
  it('does not inflate a corner probability merely by adding source stance variants', () => {
    const corner = {...route.angles[0], exclusionGroup: 'corner'};
    const base = {...route, angles: [corner, ...route.angles.slice(1)]};
    const expanded = {...base, alternatives: [{...corner, id: 'corner-crouched', crouched: true, position: [40, 300, 0] as const}]};
    const counts = [0, 0];
    for (let seed = 0; seed < 6000; seed++) for (const [index, course] of [base, expanded].entries()) {
      const selected = choosePrefireAngles(course, 'random', randomStream(seed, 'family'), density, 1);
      counts[index] += Number(selected[0].exclusionGroup === 'corner');
    }
    expect(Math.abs(counts[0] - counts[1])).toBeLessThan(150);
    expect(counts[0] / 6000).toBeCloseTo(.6, 1);
  });
  it('keeps half the selection mass for family coverage, with uniform fallback when evidence is absent', () => {
    const entries = route.angles.map(angle => ({angle, evidence: holdingEvidence(angle, route, density)}));
    const weights = selectionWeights(entries).map(entry => entry.weight);
    expect(weights).toEqual([.6, .1, .1, .1, .1]);
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    expect(selectionWeights(entries.map(entry => ({...entry, evidence: holdingEvidence(entry.angle, route)})))
      .map(entry => entry.weight)).toEqual([.2, .2, .2, .2, .2]);
    expect(PREFIRE_WEIGHT_POLICY.interpretation).toContain('not pocket or encounter probability');
    // Broad displayed round/match support and legacy ticket diagnostics stay unchanged.
    expect(entries[0].evidence).toMatchObject({rounds: 20, sampleRounds: 48, matches: 1, sampleMatches: 1, weight: 21});
  });
  it('balances by sampled match and never promotes repeated episodes or duplicate rounds to independent evidence', () => {
    const eligible = ['one/1', 'one/2', 'one/3', 'one/4', 'two/1'];
    expect(matchBalancedSupport(['one/1', 'one/2', 'one/3', 'one/4'], eligible)).toBe(.5);
    expect(matchBalancedSupport(['two/1', 'two/1', 'outside/1'], eligible)).toBe(.5);
    expect(matchBalancedSupport(['one/1'], eligible)).toBe(.125);
    expect(matchBalancedSupport([], [])).toBe(0);
    const layers = [{...density.layers![0], roundKeys: eligible}];
    const cells = [{...density.cells[0], roundKeys: ['one/1']},
      {...density.cells[0], position: route.angles[1].position, roundKeys: ['two/1']}];
    const weights = selectionWeights(route.angles.map(angle => ({angle, evidence: holdingEvidence(angle, route, {...density, layers, cells})})));
    expect(weights[1].weight).toBeGreaterThan(weights[0].weight);
    expect(weights[0].evidence.rounds).toBe(weights[1].evidence.rounds);
  });
  it('unions family evidence once and shares its coverage floor across unknown variants', () => {
    const a = {...route.angles[0], exclusionGroup: 'corner'}, b = {...route.angles[1], exclusionGroup: 'corner'};
    const layers = [{...density.layers![0], roundKeys: ['one/1', 'one/2', 'two/1', 'two/2']}];
    const cells = [{...density.cells[0], roundKeys: ['one/1', 'two/1']},
      {...density.cells[0], position: b.position, roundKeys: ['one/1', 'two/2']}];
    const sampled = {...density, layers, cells};
    const weights = selectionWeights([a, b, route.angles[2]].map(angle => ({angle, evidence: holdingEvidence(angle, route, sampled)})));
    expect(weights[0].weight + weights[1].weight).toBe(.75);
    expect(weights[2].weight).toBe(.25);
    const unknown = {...b, id: 'unknown-variant', position: [5000, 300, 0] as const};
    const expanded = selectionWeights([a, b, unknown, route.angles[2]].map(angle => ({angle, evidence: holdingEvidence(angle, route, sampled)})));
    expect(expanded.slice(0, 3).reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(.75);
    expect(expanded[2].weight).toBeGreaterThan(0);
  });
});
