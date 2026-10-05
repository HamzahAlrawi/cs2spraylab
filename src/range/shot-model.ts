import {DEG, type Vec} from './actor-physics';
import {shotgunSpreadTable, sourceRandom, type RecoilAngle} from './recoil';
import type {WeaponRecovery, AccuracyParameters} from './ballistics';

export function direction(yaw: number, pitch: number): Vec {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}

export type ShotAim = {
  yaw: number;
  pitch: number;
  recoil: RecoilAngle;
  punch?: RecoilAngle & {roll?: number};
  weapon: AccuracyParameters;
  recovery: WeaponRecovery;
  speedRatio: number;
  walking: boolean;
  airborne: boolean;
  verticalSpeedUnits: number;
  spread: boolean;
  weaponId?: string;
  alternateFire?: boolean;
  recoilIndex?: number;
  seed?: number;
  shotgunPatterns?: boolean;
  // Optional externally supplied pattern slope.
  pelletPattern?: SpreadOffset;
};

export type SpreadOffset = {horizontal: number; vertical: number};
export type SpreadSample = {
  inaccuracy: number; spread: number; weaponId?: string; alternateFire?: boolean;
  recoilIndex?: number; pelletPattern?: SpreadOffset;
};
const f = Math.fround, TAU = f(Math.PI * 2);

function spreadRadius(radius: number, sample: SpreadSample) {
  if (sample.weaponId === 'revolver' && sample.alternateFire) return f(1 - f(radius * radius));
  const index = Math.max(0, sample.recoilIndex ?? 0);
  if (sample.weaponId === 'negev' && index < 3) {
    for (let i = 3; i > index; i--) radius = f(radius * radius);
    return f(1 - radius);
  }
  return radius;
}

// Build 2000924, client RVA d23970: radius/angle, then radius/angle.
// Native V_sinf/V_cosf and command-seed derivation are not reproduced here.
export function sampleShotSpread(sample: SpreadSample, random: () => number = Math.random): SpreadOffset {
  const radius = spreadRadius(f(random()), sample), angle = f(random() * TAU);
  const r = f(radius * f(Math.max(0, sample.inaccuracy)));
  let spread: SpreadOffset;
  if (sample.pelletPattern) {
    spread = {horizontal: f(sample.pelletPattern.horizontal * f(sample.spread)),
      vertical: f(sample.pelletPattern.vertical * f(sample.spread))};
  } else {
    const q = f(spreadRadius(f(random()), sample) * f(Math.max(0, sample.spread)));
    const b = f(random() * TAU);
    spread = {horizontal: f(f(Math.cos(b)) * q), vertical: f(f(Math.sin(b)) * q)};
  }
  return {horizontal: f(f(f(Math.cos(angle)) * r) + spread.horizontal),
    vertical: f(f(f(Math.sin(angle)) * r) + spread.vertical)};
}

export function shotDirection(aim: ShotAim, random?: () => number): Vec {
  const yaw = aim.yaw - (aim.recoil.yaw + (aim.punch?.yaw ?? 0)) * DEG;
  const pitch = aim.pitch + (aim.recoil.pitch + (aim.punch?.pitch ?? 0)) * DEG;
  const forward = direction(yaw, pitch);
  if (aim.spread) {
    const cone = aim.recovery.inaccuracy(aim.speedRatio, aim.walking, aim.airborne, aim.verticalSpeedUnits);
    const {horizontal, vertical} = sampleShotSpread({inaccuracy: cone, spread: aim.weapon.spread,
      weaponId: aim.weaponId, alternateFire: aim.alternateFire,
      recoilIndex: aim.recoilIndex ?? aim.recovery.index, pelletPattern: aim.pelletPattern},
    random ?? (aim.seed === undefined ? Math.random : sourceRandom(aim.seed)));
    const roll = (aim.punch?.roll ?? 0) * DEG;
    const right = horizontal * Math.cos(roll) - vertical * Math.sin(roll);
    const up = horizontal * Math.sin(roll) + vertical * Math.cos(roll);
    // Spread is a slope in the plane perpendicular to the physical shot ray,
    // not an Euler-angle offset. Euler offsets squash the cone at steep aim.
    const x = forward.x + Math.cos(yaw) * right + Math.sin(yaw) * Math.sin(pitch) * up;
    const y = forward.y + Math.cos(pitch) * up;
    const z = forward.z - Math.sin(yaw) * right + Math.cos(yaw) * Math.sin(pitch) * up;
    const length = Math.hypot(x, y, z);
    return {x: x / length, y: y / length, z: z / length};
  }
  return forward;
}

// Native pattern mode samples inaccuracy per pellet. With patterns disabled,
// the first inaccuracy sample is shared; both cases retain physical ray geometry.
export function shotDirections(aim: ShotAim, pellets: number, random?: () => number,
  pattern?: readonly SpreadOffset[]): Vec[] {
  if (!Number.isInteger(pellets) || pellets < 1 || pellets > 64) throw new RangeError('Pellet count must be 1..64');
  if (pattern && pattern.length !== pellets) throw new RangeError('Pattern must contain one offset per pellet');
  if (!aim.spread) return Array.from({length: pellets}, () => shotDirection(aim));
  const stream = random ?? (aim.seed === undefined ? Math.random : sourceRandom(aim.seed));
  const patternMode = !!pattern || (pellets > 1 && aim.weapon.spreadSeed !== undefined && aim.shotgunPatterns !== false);
  const table = !pattern && patternMode && aim.weapon.spreadSeed !== undefined
    ? shotgunSpreadTable(aim.weapon.spreadSeed, pellets) : undefined;
  const first = Math.max(0, Math.floor(aim.recoilIndex ?? aim.recovery.index)) * pellets;
  const shared = patternMode ? undefined : [stream(), stream()];
  return Array.from({length: pellets}, (_, index) => {
    let draw = 0;
    const inaccuracy = shared ?? [stream(), stream()];
    const entry = table?.[first + index];
    let pelletPattern = pattern?.[index] ?? (entry ? {
      horizontal: f(f(Math.cos(entry.angle)) * entry.radius),
      vertical: f(f(Math.sin(entry.angle)) * entry.radius),
    } : undefined);
    if (patternMode && !pelletPattern) {
      // Native table lookup does not wrap beyond entry 63. Its fallback draws
      // angle before radius, unlike the ordinary random-spread branch.
      const angle = f(stream() * TAU), radius = f(stream());
      pelletPattern = {horizontal: f(f(Math.cos(angle)) * radius), vertical: f(f(Math.sin(angle)) * radius)};
    }
    return shotDirection({...aim, pelletPattern}, () => draw < 2 ? inaccuracy[draw++] : stream());
  });
}

export const pelletDirections = shotDirections;
