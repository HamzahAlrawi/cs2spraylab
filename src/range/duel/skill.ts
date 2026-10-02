import {pistolIds,type Pistol,type Weapon} from '../config';
import type {SkillLevel} from './config';
import {randomStream} from './rng';

export type PeekType = 'shoulder' | 'quick' | 'wide' | 'ferrari' | 'crouch' | 'prefire' | 'slice' | 'jump' | 'run' | 'crouchWide';
export type PeekChoice = PeekType | 'hold';
export const peekTypes: PeekType[] = ['shoulder', 'quick', 'wide', 'ferrari', 'crouch', 'prefire', 'slice', 'jump', 'run', 'crouchWide'];
type Weights = Record<PeekType, number>;

const rifle: Weights = {shoulder: 14, quick: 24, wide: 15, ferrari: 5, crouch: 8, prefire: 10,
  slice: 12, jump: 4, run: 2, crouchWide: 6};
const smg: Weights = {shoulder: 8, quick: 14, wide: 19, ferrari: 12, crouch: 5, prefire: 8,
  slice: 8, jump: 4, run: 16, crouchWide: 6};
const pistol: Weights = {shoulder: 12, quick: 25, wide: 15, ferrari: 5, crouch: 8, prefire: 8,
  slice: 14, jump: 5, run: 4, crouchWide: 4};
const lmg: Weights = {shoulder: 12, quick: 12, wide: 8, ferrari: 2, crouch: 13, prefire: 14,
  slice: 20, jump: 3, run: 8, crouchWide: 8};
export const skilledFamilyWeights = {rifle, smg, pistol, lmg};

const anchors: {level: number; weights: Weights; advancedCap: number; shoulderCap: number}[] = [
  {level: 1, weights: {shoulder: 0, quick: 10, wide: 30, ferrari: 0, crouch: 12, prefire: 0,
    slice: 0, jump: 0, run: 48, crouchWide: 0}, advancedCap: 0, shoulderCap: 0},
  {level: 3, weights: {shoulder: .6, quick: 17, wide: 27, ferrari: 0, crouch: 12, prefire: 1.2,
    slice: .7, jump: 0, run: 41.5, crouchWide: 0}, advancedCap: .025, shoulderCap: .006},
  {level: 6, weights: {shoulder: 5, quick: 23, wide: 23, ferrari: 2, crouch: 10, prefire: 6,
    slice: 5, jump: 1, run: 21, crouchWide: 4}, advancedCap: .25, shoulderCap: .08},
  {level: 9, weights: {shoulder: 10, quick: 25, wide: 18, ferrari: 4, crouch: 8, prefire: 9,
    slice: 10, jump: 3, run: 7, crouchWide: 6}, advancedCap: .45, shoulderCap: .18},
  {level: 10, weights: rifle, advancedCap: 1, shoulderCap: 1},
];
const advanced = new Set<PeekType>(['shoulder', 'ferrari', 'prefire', 'slice', 'jump', 'crouchWide']);
const lowAdvancedLocks = new Set<PeekType>(['ferrari', 'jump', 'crouchWide']);
const sum = (weights: Partial<Weights>, types: PeekType[]) => types.reduce((total, type) => total + (weights[type] ?? 0), 0);
const numberLevel = (level: SkillLevel) => level === '10+' ? 10 : level;

export function peekPrior(level: SkillLevel) {
  const target = numberLevel(level);
  const high = anchors.find(anchor => anchor.level >= target) ?? anchors[anchors.length - 1];
  const low = anchors[Math.max(0, anchors.indexOf(high) - 1)];
  const fraction = high.level === low.level ? 0 : (target - low.level) / (high.level - low.level);
  const weights = Object.fromEntries(peekTypes.map(type => [type, low.weights[type] + (high.weights[type] - low.weights[type]) * fraction])) as Weights;
  return {weights, advancedCap: low.advancedCap + (high.advancedCap - low.advancedCap) * fraction,
    shoulderCap: low.shoulderCap + (high.shoulderCap - low.shoulderCap) * fraction};
}

export function weaponFamily(weapon: Weapon): keyof typeof skilledFamilyWeights {
  if (weapon === 'm249' || weapon === 'negev') return 'lmg';
  if (pistolIds.includes(weapon as Pistol)) return 'pistol';
  if (['mp9', 'mp7', 'mp5sd', 'mac10', 'ump45', 'p90', 'bizon'].includes(weapon)) return 'smg';
  return 'rifle';
}

export function peekDistribution(level: SkillLevel, weapon: Weapon,
  eligible: Partial<Record<PeekType, boolean>> = {}, context: Partial<Record<PeekType, number>> = {}): Record<PeekChoice, number> {
  const {weights: prior, advancedCap, shoulderCap} = peekPrior(level);
  const family = skilledFamilyWeights[weaponFamily(weapon)];
  const raw = Object.fromEntries(peekTypes.map(type => {
    const factor = context[type] ?? 1;
    return [type, eligible[type] === false || numberLevel(level) <= 3 && lowAdvancedLocks.has(type)
      || !Number.isFinite(factor) ? 0 : prior[type] * family[type] / rifle[type] * Math.max(0, factor)];
  })) as Weights;
  const simpleTypes = peekTypes.filter(type => !advanced.has(type));
  const advancedTypes = peekTypes.filter(type => advanced.has(type));
  const simple = sum(raw, simpleTypes), complex = sum(raw, advancedTypes);
  const output = Object.fromEntries([...peekTypes, 'hold'].map(type => [type, 0])) as Record<PeekChoice, number>;
  if (simple + complex === 0 || simple === 0 && advancedCap < 1) {output.hold = 1; return output;}
  const complexMass = Math.min(complex / (simple + complex), advancedCap);
  const shoulderMass = Math.min(complex > 0 ? complexMass * raw.shoulder / complex : 0, shoulderCap);
  const otherComplexMass = complexMass - (complex > 0 ? complexMass * raw.shoulder / complex : 0);
  const simpleMass = 1 - shoulderMass - otherComplexMass;
  for (const type of simpleTypes) output[type] = simple > 0 ? simpleMass * raw[type] / simple : 0;
  for (const type of advancedTypes) output[type] = type === 'shoulder' ? shoulderMass
    : complex > raw.shoulder ? otherComplexMass * raw[type] / (complex - raw.shoulder) : 0;
  return output;
}

export function samplePeek(distribution: Record<PeekChoice, number>, random: () => number): PeekChoice {
  let value = random();
  for (const type of [...peekTypes, 'hold'] as PeekChoice[]) {
    value -= distribution[type];
    if (value < 0) return type;
  }
  return 'hold';
}

const interpolate = (level: SkillLevel, values: [number, number, number, number]) => {
  if (level === '10+') return values[3];
  const points = [1, 5, 10];
  const right = points.findIndex(point => point >= level);
  if (right <= 0) return values[0];
  const left = right - 1, fraction = (level - points[left]) / (points[right] - points[left]);
  return values[left] + (values[right] - values[left]) * fraction;
};

const normal = (random: () => number) => {
  const u = Math.max(1e-9, random());
  return Math.max(-2, Math.min(2, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())));
};

export type BotTraits = {
  recognitionMedianMs: number;
  motorSettlingMs: number;
  endpointErrorDegrees: number;
  preaimErrorDegrees: number;
  brakeErrorMs: number;
  lowAimTendency: number;
  stopTendency: number;
};

// All skill curves are training heuristics, not measured FACEIT population statistics.
export function combatStyle(level: SkillLevel) {
  const n = level === '10+' ? 10 : level;
  return {
    crouchSpray: n <= 2 ? .6 : n <= 5 ? .6 + (.33 - .6) * (n - 2) / 3 : .33 + (.02 - .33) * (n - 5) / 5,
    crouchTap: n <= 3 ? 0 : n <= 5 ? .1 * (n - 3) / 2 : .1 + (.33 - .1) * (n - 5) / 5,
    recoilControl: interpolate(level, [.3, .84, .98, .99]),
    recoilResponse: interpolate(level, [.105, .045, .018, .014]),
    recoilVariation: interpolate(level, [.18, .075, .022, .012]),
    fireTolerance: interpolate(level, [3, 1.5, .55, .4]),
  };
}

export function createBotTraits(level: SkillLevel, seed: number, actorId: number): BotTraits {
  const random = randomStream(seed, `identity:${actorId}`);
  const general = normal(random), aim = normal(random), movement = normal(random), recognition = normal(random);
  const recognitionStrength = .5 * general + Math.sqrt(.75) * recognition;
  const aimStrength = .5 * general + Math.sqrt(.75) * aim;
  const movementStrength = .4 * general + Math.sqrt(.84) * movement;
  const midrank = typeof level === 'number' && level >= 5 && level <= 8 ? 1 : 0;
  const stopBase = interpolate(level, [.45, .72, .93, .96]) - midrank * .025;
  const logit = Math.log(stopBase / (1 - stopBase));
  return {
    recognitionMedianMs: interpolate(level, [360, 260, 190, 165]) * (1 + midrank * .08) * Math.exp(-.12 * recognitionStrength),
    motorSettlingMs: interpolate(level, [300, 220, 150, 125]) * (1 + midrank * .08) * Math.exp(-.12 * aimStrength),
    endpointErrorDegrees: interpolate(level, [1.8, 1, .45, .3]) * (1 + midrank * .16) * Math.exp(-.18 * aimStrength),
    preaimErrorDegrees: interpolate(level, [5.8, 2.8, .9, .7]) * (1 + midrank * .15) * Math.exp(-.18 * aimStrength),
    brakeErrorMs: interpolate(level, [110, 65, 20, 16]) * (1 + midrank * .12) * Math.exp(-.15 * movementStrength),
    lowAimTendency: interpolate(level, [.8, .4, .1, .08]) + midrank * .04,
    stopTendency: 1 / (1 + Math.exp(-(logit + .4 * movementStrength))),
  };
}
