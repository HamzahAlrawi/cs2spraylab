import {UNIT} from '../actor-physics';
import native from './he-explosion-native.json';

export type HeSmokeLayer = keyof typeof native.profiles;
export const HE_EXPLOSION_SECONDS = native.duration;
export const HE_SMOKE_PARTICLES = Object.values(native.profiles).reduce((sum, p) => sum + p.delays.length, 0);
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const noise = (seed: number) => {
  let n = Math.imul(seed | 0, 0x45d9f3b); n = Math.imul(n ^ n >>> 16, 0x45d9f3b);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
};
const between = (range: readonly number[], seed: number) => range[0] + (range[1] - range[0]) * noise(seed);

/** Absolute-age cosmetic sampler: stable on pause, backward seeks and replay.
 * Native field ranges; browser motion/lighting, not a Source 2 particle VM. */
export function heSmokeParticle(id: number, layer: HeSmokeLayer, index: number, age: number) {
  const p = native.profiles[layer], start = p.delays[index];
  if (start === undefined || !Number.isFinite(age) || age < start) return;
  const seed = id * 137 + index * 31 + (layer === 'core' ? 0 : 983);
  const life = between(p.lifetime, seed), elapsed = age - start;
  if (elapsed >= life) return;
  const progress = clamp(elapsed / life), angle = noise(seed + 1) * Math.PI * 2;
  const fade = between(p.fadeOut, seed + 2), radius = between(p.radiusUnits, seed + 3) * UNIT;
  const growth = progress / ((1 / p.growthBias - 2) * (1 - progress) + 1);
  const size = 2 * radius * (p.startScale + (1 - p.startScale) * growth);
  const travel = p.drag > 0 ? -Math.expm1(-p.drag * elapsed) / p.drag : elapsed;
  const ring = p.ringRadius + between(p.ringSpeed, seed + 4) * travel;
  const axis = (i: number) => between([p.offsetMin[i], p.offsetMax[i]], seed + 5 + i) +
    between([p.speedMin[i], p.speedMax[i]], seed + 8 + i) * travel + .5 * p.gravity[i] * elapsed ** 2;
  const sequence = native.asset.sequences[Math.floor(noise(seed + 11) * native.asset.sequences.length)];
  return {x: (axis(0) + Math.cos(angle) * ring) * UNIT,
    y: axis(2) * UNIT, z: -(axis(1) + Math.sin(angle) * ring) * UNIT, size,
    rotation: angle + elapsed * between([2, 4], seed + 12) * Math.PI / 180,
    opacity: between(p.alpha, seed + 13) * clamp((1 - progress) / fade),
    frame: sequence.start + progress * (sequence.count - 1), lastFrame: sequence.start + sequence.count - 1};
}
