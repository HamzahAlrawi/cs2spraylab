import {describe, expect, it} from 'vitest';
import {pistolIds,weaponIds} from '../config';
import {combatStyle, createBotTraits, peekDistribution, peekPrior, peekTypes, samplePeek, skilledFamilyWeights,
  weaponFamily,type PeekType} from './skill';
import type {SkillLevel} from './config';
import {randomStream} from './rng';

const levels: SkillLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, '10+'];
const advanced: PeekType[] = ['shoulder', 'ferrari', 'prefire', 'slice', 'jump', 'crouchWide'];
const caps = new Map([[1, [0, 0]], [3, [.04, .01]], [6, [.25, .08]], [9, [.45, .18]], [10, [1, 1]]]);

describe('rank repertoire', () => {
  it.each(pistolIds)('%s uses pistol peek priors rather than rifle defaults',weapon=>{
    expect(weaponFamily(weapon)).toBe('pistol');
    expect(peekDistribution(10,weapon)).toEqual(peekDistribution(10,'cz75a'));
  });
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

describe('heuristic difficulty rebalance', () => {
  it('preserves pre-rebalance 10 and 10+ identity fixtures and combat style', () => {
    const fixtures = [
      {level: 10 as const, recognitionMedianMs: 233.29582801364438, motorSettlingMs: 144.6864424048991,
        endpointErrorDegrees: .4263020121239995, preaimErrorDegrees: .852604024247999,
        brakeErrorMs: 21.24283242351702, lowAimTendency: .1, stopTendency: .918782844403387},
      {level: '10+' as const, recognitionMedianMs: 202.59900853816487, motorSettlingMs: 120.57203533741594,
        endpointErrorDegrees: .2842013414159997, preaimErrorDegrees: .6631364633039992,
        brakeErrorMs: 16.994265938813616, lowAimTendency: .08, stopTendency: .9533490488860945},
    ];
    for (const {level, ...fixture} of fixtures) {
      const actual = createBotTraits(level, 17, 1);
      for (const key of Object.keys(fixture) as (keyof typeof fixture)[]) expect(actual[key]).toBeCloseTo(fixture[key], 12);
    }
    expect(combatStyle(10)).toMatchObject({recoilControl: .98, recoilResponse: .018, recoilVariation: .022, fireTolerance: .55});
    expect(combatStyle('10+')).toMatchObject({recoilControl: .99, recoilResponse: .014, recoilVariation: .012, fireTolerance: .4});
    expect(peekDistribution(10, 'ak47')).toEqual(peekDistribution('10+', 'ak47'));
    for (const weapon of ['ak47', 'mp9', 'cz75a', 'negev'] as const) for (const type of peekTypes) {
      const expected = skilledFamilyWeights[weaponFamily(weapon)][type] / 100;
      expect(peekDistribution(10, weapon)[type]).toBeCloseTo(expected, 12);
      expect(peekDistribution('10+', weapon)[type]).toBeCloseTo(expected, 12);
    }
  });

  it.each([5, 6, 7, 8] as const)('moderately weakens level %s identity without touching recoil', level => {
    const index = level - 5;
    const before = {
      recognitionMedianMs: [319.24692254498706, 302.05670363871855, 284.86648473245, 267.67626582618146][index],
      motorSettlingMs: [212.20678219385204, 198.70271423606147, 185.19864627827087, 171.6945783204803][index],
      endpointErrorDegrees: [.947337804719999, .843130646200799, .7389234876815992, .6347163291623993][index],
      preaimErrorDegrees: [2.652545853215997, 2.2925574874223975, 1.932569121628798, 1.5725807558351983][index],
      brakeErrorMs: [69.03920537643032, 59.47993078584766, 49.920656195264996, 40.361381604682336][index],
    };
    const actual = createBotTraits(level, 17, 1), elite = createBotTraits(10, 17, 1);
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      expect(actual[key] / before[key]).toBeGreaterThanOrEqual(1.079999);
      expect(actual[key] / before[key]).toBeLessThanOrEqual(1.160001);
      expect(actual[key]).toBeGreaterThan(elite[key]);
    }
    expect(actual.stopTendency).toBeLessThan(elite.stopTendency);
    expect(combatStyle(level).recoilControl).toBeCloseTo(.84 + (.98 - .84) * index / 5);
  });

  it('keeps seeded novice advanced-peek frequency rare even in favorable contexts', () => {
    for (const level of [1, 2, 3] as const) for (const weapon of ['ak47', 'mp9', 'cz75a', 'm249'] as const) {
      const distribution = peekDistribution(level, weapon, {}, {shoulder: 80, slice: 30, prefire: 40});
      const draw = () => {
        const random = randomStream(731, `novice:${level}:${weapon}`);
        return Array.from({length: 10000}, () => samplePeek(distribution, random));
      };
      const samples = draw();
      expect(samples).toEqual(draw());
      expect(samples.filter(type => advanced.includes(type as PeekType)).length / samples.length).toBeLessThan(.03);
      expect(samples.filter(type => type === 'shoulder').length / samples.length).toBeLessThan(.009);
      expect(samples.some(type => ['ferrari', 'jump', 'crouchWide'].includes(type))).toBe(false);
    }
  });
});
