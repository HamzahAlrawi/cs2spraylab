import native from './inferno-presentation-native.json';

export type InfernoLayer = keyof typeof native.assets;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {const t = clamp(x); return t * t * (3 - 2 * t);};
const noise = (x: number) => {
  let n = Math.imul(x | 0, 0x45d9f3b);
  n = Math.imul(n ^ n >>> 16, 0x45d9f3b); n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
};

/** Bounded deterministic emitters. Native life ranges and sequences, adapted
 * emission density/size: this is not a Source 2 particle-operator interpreter. */
export function infernoParticle(layer: InfernoLayer, id: number, cell: number, lane: number, age: number) {
  const asset = native.assets[layer], seed = id * 71 + cell * 17 + lane * 131;
  const range = asset.presentation.lifetime;
  const life = Math.max(.2, range[0] + (range[1] - range[0]) * noise(seed));
  const delay = lane * life / 2 + noise(seed + 2) * .08;
  if (age < delay) return undefined;
  const generation = Math.floor((age - delay) / life), progress = (age - delay) / life - generation;
  const variant = noise(seed + generation * 13 + 1);
  const sequence = asset.sequences[Math.floor(variant * asset.sequences.length)];
  const edge = layer === 'edge', ember = layer === 'embers', ground = layer === 'ground';
  // Manual-frame sequences follow particle age, never last-frame -> first-frame.
  const frame = sequence.start + clamp(progress) * (sequence.count - 1);
  const alpha = smooth(progress / .12) * smooth((1 - progress) / (edge ? .15 : .5));
  return {frame, lastFrame: sequence.start + sequence.count - 1, progress,
    opacity: alpha * asset.presentation.alphaScale * (ground ? .42 : ember ? .8 : edge ? .48 : .49),
    scale: (ground ? 1 : .6 + smooth(progress) * .6) * (.85 + noise(seed + 3) * .3),
    x: (noise(seed + 4) - .5) * (ground ? 0 : .36), z: (noise(seed + 5) - .5) * (ground ? 0 : .36),
    rotation: (noise(seed + 6) - .5) * Math.PI * .35};
}
