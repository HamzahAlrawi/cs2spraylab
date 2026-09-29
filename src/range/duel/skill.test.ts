import {describe, expect, it} from 'vitest';
import {weaponIds} from '../config';
import {createBotTraits, peekDistribution, peekPrior, peekTypes, samplePeek, skilledFamilyWeights,
  type PeekType} from './skill';
import type {SkillLevel} from './config';
import {randomStream} from './rng';

const levels: SkillLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, '10+'];
const advanced: PeekType[] = ['shoulder', 'ferrari', 'prefire', 'slice', 'jump', 'crouchWide'];
const caps = new Map([[1, [0, 0]], [3, [.04, .01]], [6, [.25, .08]], [9, [.45, .18]], [10, [1, 1]]]);

describe('rank repertoire', () => {
  it('keeps all authored family and anchor priors normalized', () => {
    for (const weights of Object.values(skilledFamilyWeights))
      expect(peekTypes.reduce((total, type) => total + weights[type], 0)).toBe(100);
    for (const level of levels)
      expect(peekTypes.reduce((total, type) => total + peekPrior(level).weights[type], 0)).toBeCloseTo(100);
  });

  it('gives level 1 basic peeks with running and wide swings dominant', () => {
    const distribution = peekDistribution(1, 'ak47');
    expect(distribution.run).toBeCloseTo(.48);
    expect(distribution.wide).toBeCloseTo(.30);
    for (const type of advanced) expect(distribution[type]).toBe(0);
    expect(peekDistribution(3, 'ak47').shoulder).toBeLessThanOrEqual(.01);
  });

  it('enforces caps after weapon/context/eligibility for every level and firearm', () => {
    for (const level of levels) for (const weapon of weaponIds) {
      for (const mask of [0, 1, 2, 17, 511, 512, 1023]) {
        const eligible = Object.fromEntries(peekTypes.map((type, index) => [type, Boolean(mask & (1 << index))]));
        const distribution = peekDistribution(level, weapon, eligible, {shoulder: 100, prefire: 20, run: .1});
        expect(Object.values(distribution).every(value => Number.isFinite(value) && value >= 0)).toBe(true);
        expect(Object.values(distribution).reduce((total, value) => total + value, 0)).toBeCloseTo(1);
        const rank = level === '10+' ? 10 : level;
        const ceiling = caps.get(rank);
        if (ceiling) {
          expect(advanced.reduce((total, type) => total + distribution[type], 0)).toBeLessThanOrEqual(ceiling[0] + 1e-10);
          expect(distribution.shoulder).toBeLessThanOrEqual(ceiling[1] + 1e-10);
        }
        if (rank <= 3) {
          expect(distribution.ferrari + distribution.jump + distribution.crouchWide).toBe(0);
        }
      }
    }
  });

  it('holds rather than promoting a lone advanced choice for beginners', () => {
    const onlyShoulder = Object.fromEntries(peekTypes.map(type => [type, type === 'shoulder']));
    for (const level of [1, 2, 3, 6, 9] as SkillLevel[]) {
      expect(peekDistribution(level, 'ak47', onlyShoulder).hold).toBe(1);
    }
    expect(peekDistribution(10, 'ak47', onlyShoulder).shoulder).toBe(1);
    expect(peekDistribution(5, 'ak47', {}, {shoulder: Infinity}).shoulder).toBe(0);
  });

  it('samples only selected actions using a reproducible tactic stream', () => {
    const distribution = peekDistribution(1, 'ak47');
    const draw = () => {
      const random = randomStream(44, 'tactics:1');
      return Array.from({length: 100}, () => samplePeek(distribution, random));
    };
    expect(draw()).toEqual(draw());
    expect(draw().every(type => ['quick', 'wide', 'crouch', 'run'].includes(type))).toBe(true);
  });
});

describe('provisional individual variance', () => {
  it('keeps identity traits stable by seed while allowing uneven strengths', () => {
    const first = createBotTraits(5, 100, 1);
    expect(first).toEqual(createBotTraits(5, 100, 1));
    expect(first).not.toEqual(createBotTraits(5, 100, 2));
    expect(first.recognitionMedianMs).toBeGreaterThan(100);
    expect(first.stopTendency).toBeGreaterThan(0);
    expect(first.stopTendency).toBeLessThan(1);
  });

  it('makes low ranks worse on average while preserving overlap', () => {
    const mean = (level: SkillLevel, key: 'preaimErrorDegrees' | 'brakeErrorMs' | 'recognitionMedianMs') =>
      Array.from({length: 200}, (_, id) => createBotTraits(level, 17, id)[key]).reduce((a, b) => a + b, 0) / 200;
    for (const key of ['preaimErrorDegrees', 'brakeErrorMs', 'recognitionMedianMs'] as const)
      expect(mean(1, key)).toBeGreaterThan(mean(10, key));
    const level5 = Array.from({length: 200}, (_, id) => createBotTraits(5, 17, id).preaimErrorDegrees);
    expect(Math.max(...level5)).toBeGreaterThan(Math.min(...level5));
  });
});
