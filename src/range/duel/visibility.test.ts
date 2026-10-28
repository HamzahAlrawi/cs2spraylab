import {describe, expect, it} from 'vitest';
import {fullyOccluded} from './visibility';
import {testArena, type Arena} from './geometry';
import {DuelSimulation} from './simulation';

describe('render occlusion surface namespaces', () => {
  it('never indexes native surface IDs as generated arena solids', () => {
    const sim = new DuelSimulation(), actor = sim.snapshot()[1], eye = sim.snapshot()[0].position;
    const native = {ray: () => ({distance: 1, normal: {x: 0, y: 0, z: 1}, surfaceId: 0}), fits: () => true,
      sweep: () => undefined, vertical: () => ({feet: 0, grounded: true, ceiling: false})} as unknown as Arena['native'];
    const arena = {...testArena(), native};
    expect(fullyOccluded(eye, actor, arena)).toBe(false);
    arena.solids.push({center: {x: 0, y: 1, z: 0}, size: {x: 100, y: 100, z: 100}});
    expect(fullyOccluded(eye, actor, arena)).toBe(false);
  });
  it('retains conservative occlusion by one authored convex box', () => {
    const sim = new DuelSimulation(), actor = {...sim.snapshot()[1], position: {x: 0, y: 1.6256, z: -8}, feet: 0};
    const arena = {...testArena(), solids: [{center: {x: 0, y: 2, z: -3}, size: {x: 8, y: 4, z: .5}}]};
    expect(fullyOccluded({x: 0, y: 1.6256, z: 0}, actor, arena)).toBe(true);
  });
  it('does not use a ramp bounding box as if its empty upper half were opaque', () => {
    const sim = new DuelSimulation(), actor = {...sim.snapshot()[1], position: {x: 3, y: 1.6256, z: -8}, feet: 0};
    const arena: Arena = {...testArena(), solids: [{center: {x: 0, y: 1, z: -3}, size: {x: 8, y: 2, z: .5},
      shape: {kind: 'ramp', axis: 'x', highSide: 1}}]};
    expect(fullyOccluded({x: 3, y: 1.6256, z: 0}, actor, arena)).toBe(false);
  });
});
