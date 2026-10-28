import {describe, expect, it} from 'vitest';
import {pistolIds,weaponIds} from '../config';
import {combatStyle, createBotTraits, peekDistribution, peekPrior, peekTypes, samplePeek, skilledFamilyWeights,
  weaponFamily,type BotTraits,type PeekType} from './skill';
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

  it.each([5, 6, 7, 8] as const)('retains the earlier level %s curve underneath low-rank assistance without touching recoil', level => {
    const index = level - 5;
    const before = {
      recognitionMedianMs: [319.24692254498706, 302.05670363871855, 284.86648473245, 267.67626582618146][index],
      motorSettlingMs: [212.20678219385204, 198.70271423606147, 185.19864627827087, 171.6945783204803][index],
      endpointErrorDegrees: [.947337804719999, .843130646200799, .7389234876815992, .6347163291623993][index],
      preaimErrorDegrees: [2.652545853215997, 2.2925574874223975, 1.932569121628798, 1.5725807558351983][index],
      brakeErrorMs: [69.03920537643032, 59.47993078584766, 49.920656195264996, 40.361381604682336][index],
    };
    const actual = createBotTraits(level, 17, 1), elite = createBotTraits(10, 17, 1);
    const assistance = Math.max(0, (7 - level) / 6);
    const extra = {recognitionMedianMs: 1 + .28 * assistance, motorSettlingMs: 1 + .2 * assistance,
      endpointErrorDegrees: 1 + .45 * assistance, preaimErrorDegrees: 1 + .25 * assistance, brakeErrorMs: 1 + .2 * assistance};
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      expect(actual[key] / extra[key] / before[key]).toBeGreaterThanOrEqual(1.079999);
      expect(actual[key] / extra[key] / before[key]).toBeLessThanOrEqual(1.160001);
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

  it('softens default/lower-mid acquisition modestly and retains the already gentler upper-mid calibration', () => {
    // Dividing out the prior level-5 curve recovers this seed's identity factors.
    const identity = {recognition: 319.24692254498706 / 260, motor: 212.20678219385204 / 220,
      endpoint: .947337804719999, preaim: 2.652545853215997 / 2.8};
    const before = createBotTraits(3, 17, 1);
    expect(before.recognitionMedianMs / (310 * identity.recognition)).toBeCloseTo(1.08 * (1 + .28 * 4 / 6), 12);
    expect(before.motorSettlingMs / (260 * identity.motor)).toBeCloseTo(1.08 * (1 + .2 * 4 / 6), 12);
    expect(before.endpointErrorDegrees / (1.4 * identity.endpoint)).toBeCloseTo(1.12 * (1 + .45 * 4 / 6), 12);
    expect(before.preaimErrorDegrees / (4.3 * identity.preaim)).toBeCloseTo(1.1 * (1 + .25 * 4 / 6), 12);
    expect(createBotTraits(5, 17, 1).recognitionMedianMs / (319.24692254498706 * 1.08)).toBeCloseTo(1.12 / 1.08 * (1 + .28 * 2 / 6), 12);
    for (const level of [7, 8, 9] as const) {
      expect(createBotTraits(level, 17, 1).recognitionMedianMs).toBeLessThan(createBotTraits(5, 17, 1).recognitionMedianMs);
    }
    for (const level of [1, 2, 3] as const) {
      const distribution = peekDistribution(level, 'ak47', {}, {shoulder: 100, prefire: 100, slice: 100});
      expect(advanced.reduce((mass, type) => mass + distribution[type], 0)).toBe(0);
    }
  });
});

describe('beginner assistance without high-rank changes', () => {
  it.each([
    {level: 7 as const, recognitionMedianMs: 307.65580351104603, motorSettlingMs: 200.01453798053257,
      endpointErrorDegrees: .857151245710655, preaimErrorDegrees: 2.222454489873117,
      brakeErrorMs: 55.911134938696804, lowAimTendency: .32, stopTendency: .7500881164844313},
    {level: 8 as const, recognitionMedianMs: 289.09036709227604, motorSettlingMs: 185.43014458611873,
      endpointErrorDegrees: .736270941828383, preaimErrorDegrees: 1.8084678692104779,
      brakeErrorMs: 45.20474739724422, lowAimTendency: .26, stopTendency: .7961448189538193},
    {level: 9 as const, recognitionMedianMs: 250.48604691991298, motorSettlingMs: 158.1905103626897,
      endpointErrorDegrees: .5305091706431994, preaimErrorDegrees: 1.2125923900415985,
      brakeErrorMs: 30.80210701409968, lowAimTendency: .15999999999999998, stopTendency: .8709862076793352},
  ])('preserves every pre-change level $level identity field', ({level, ...expected}) => {
    const actual = createBotTraits(level, 17, 1);
    for (const key of Object.keys(expected) as (keyof BotTraits)[]) expect(actual[key]).toBeCloseTo(expected[key], 12);
  });

  it('keeps low-rank probabilities bounded and reaction/aim curves ordered over varied identities', () => {
    for (let seed = 1; seed <= 32; seed++) for (let actor = 1; actor <= 5; actor++) {
      const cohort = levels.map(level => createBotTraits(level, seed, actor));
      for (let index = 0; index < cohort.length; index++) {
        const traits = cohort[index];
        expect(traits.stopTendency).toBeGreaterThan(0); expect(traits.stopTendency).toBeLessThan(1);
        expect(traits.lowAimTendency).toBeGreaterThan(0); expect(traits.lowAimTendency).toBeLessThan(1);
        if (!index) continue;
        for (const key of ['recognitionMedianMs', 'motorSettlingMs', 'endpointErrorDegrees', 'preaimErrorDegrees', 'brakeErrorMs'] as const)
          expect(traits[key]).toBeLessThan(cohort[index - 1][key]);
      }
    }
  });
});
