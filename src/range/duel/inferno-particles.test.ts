import {describe, expect, it} from 'vitest';
import native from './inferno-presentation-native.json';
import {infernoParticle, type InfernoLayer} from './inferno-particles';

describe('bounded native fire sequence playback', () => {
  it.each(Object.keys(native.assets) as InfernoLayer[])('keeps %s frames inside one native sequence and fades at rebirth', layer => {
    const variants = new Set<number>();
    for (let i = 0; i < 24; i++) for (let tick = 0; tick < 400; tick++) {
      const particle = infernoParticle(layer, 4, i, 0, tick / 60);
      if (!particle) continue;
      expect(Number.isFinite(particle.frame)).toBe(true);
      const sequence = native.assets[layer].sequences.find(sequence => particle.lastFrame === sequence.start + sequence.count - 1)!;
      expect(sequence).toBeDefined(); variants.add(sequence.start);
      expect(particle.frame).toBeGreaterThanOrEqual(sequence.start); expect(particle.frame).toBeLessThanOrEqual(particle.lastFrame);
      if (particle.progress < .01 || particle.progress > .999) expect(particle.opacity).toBeLessThan(.03);
    }
    expect(variants.size).toBeGreaterThan(1);
  });
  it('is deterministic for seek/replay and does not start a delayed emitter early', () => {
    expect(infernoParticle('center', 2, 1, 1, 0)).toBeUndefined();
    expect(infernoParticle('center', 2, 1, 1, 5)).toEqual(infernoParticle('center', 2, 1, 1, 5));
  });
});
