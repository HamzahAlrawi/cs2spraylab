import { ahkDerivedSprays } from './ahkDerivedSprays';
import { RecoilPoint, SprayLength, WeaponId, WeaponInaccuracyProfile, WeaponPattern, WeakSegment } from '../types';

type RawPoint = [number, number];

type AnchorPoint = {
  bullet: number;
  x: number;
  y: number;
};

type WeaponDefinition = {
  id: WeaponId;
  name: string;
  magazineSize: number;
  difficulty: WeaponPattern['difficulty'];
  fireRateRpm: number;
  movementSpeed: number;
  notes: string;
  anchors: readonly AnchorPoint[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function interpolateAnchors(anchors: readonly AnchorPoint[], bullet: number): RawPoint {
  const sorted = [...anchors].sort((a, b) => a.bullet - b.bullet);
  if (bullet <= sorted[0].bullet) return [sorted[0].x, sorted[0].y];
  if (bullet >= sorted[sorted.length - 1].bullet) {
    const last = sorted[sorted.length - 1];
    return [last.x, last.y];
  }

  const rightIndex = sorted.findIndex((anchor) => anchor.bullet >= bullet);
  const left = sorted[rightIndex - 1];
  const right = sorted[rightIndex];
  const span = Math.max(1, right.bullet - left.bullet);
  const ratio = (bullet - left.bullet) / span;
  return [round2(left.x + (right.x - left.x) * ratio), round2(left.y + (right.y - left.y) * ratio)];
}

function makeCompensationPoints(definition: WeaponDefinition): RawPoint[] {
  return Array.from({ length: definition.magazineSize }, (_, index) => interpolateAnchors(definition.anchors, index + 1));
}

function makeTimedPattern(points: RawPoint[], refireMs: number): RecoilPoint[] {
  return points.map(([x, y], index) => ({
    bullet: index + 1,
    x,
    y,
    timeMs: round2(index * refireMs)
  }));
}

function makeImpactPattern(compensation: RecoilPoint[]): RecoilPoint[] {
  return compensation.map((point) => ({ ...point, x: -point.x, y: -point.y }));
}

function inaccuracyForWeapon(id: WeaponId): WeaponInaccuracyProfile {
  const rifle = ['ak47', 'm4a4', 'm4a1s', 'galil', 'famas', 'sg553'].includes(id);
  const smg = ['mp9', 'mac10', 'mp7', 'p90'].includes(id);
  return {
    standPx: rifle ? 4.5 : 7,
    crouchMultiplier: smg ? 0.72 : 0.52,
    movePx: rifle ? 92 : 52,
    accurateMoveSpeedRatio: smg ? 0.34 : 0.18
  };
}

function defineWeapon(definition: WeaponDefinition): WeaponPattern {
  const refireMs = round2(60_000 / definition.fireRateRpm);
  const pattern = makeTimedPattern(makeCompensationPoints(definition), refireMs);
  if (pattern.length !== definition.magazineSize) {
    throw new Error(`${definition.name} has ${pattern.length} recoil points but a ${definition.magazineSize}-round magazine.`);
  }
  return {
    id: definition.id,
    name: definition.name,
    magazineSize: definition.magazineSize,
    difficulty: definition.difficulty,
    fireRateRpm: definition.fireRateRpm,
    refireMs,
    movementSpeed: definition.movementSpeed,
    inaccuracy: inaccuracyForWeapon(definition.id),
    sourceAccuracy: 'community-derived',
    notes: definition.notes,
    pattern,
    impactPattern: makeImpactPattern(pattern)
  };
}

function digitizedNotes(name: string, fireRateRpm: number): string {
  const refireMs = Math.round(60_000 / fireRateRpm);
  return `${fireRateRpm.toFixed(fireRateRpm % 1 ? 2 : 0)} RPM / ${refireMs}ms per bullet. Mouse-compensation anchors come from the best available source for each weapon. AK-47, M4A4, M4A1-S, FAMAS, Galil AR, and SG 553 use cumulative points converted from the user-provided AHK recoil table.`;
}

const definitions: WeaponDefinition[] = [
  {
    id: 'ak47',
    name: 'AK-47',
    magazineSize: 30,
    fireRateRpm: 600,
    movementSpeed: 215,
    difficulty: 'hard',
    notes: digitizedNotes('AK-47', 600),
    anchors: ahkDerivedSprays.ak47
  },
  {
    id: 'm4a4',
    name: 'M4A4',
    magazineSize: 30,
    fireRateRpm: 666.67,
    movementSpeed: 225,
    difficulty: 'medium',
    notes: digitizedNotes('M4A4', 666.67),
    anchors: ahkDerivedSprays.m4a4
  },
  {
    id: 'm4a1s',
    name: 'M4A1-S',
    magazineSize: 20,
    fireRateRpm: 600,
    movementSpeed: 225,
    difficulty: 'easy',
    notes: digitizedNotes('M4A1-S', 600),
    anchors: ahkDerivedSprays.m4a1s
  },
  {
    id: 'famas',
    name: 'FAMAS',
    magazineSize: 25,
    fireRateRpm: 666.67,
    movementSpeed: 220,
    difficulty: 'medium',
    notes: digitizedNotes('FAMAS', 666.67),
    anchors: ahkDerivedSprays.famas
  },
  {
    id: 'galil',
    name: 'Galil AR',
    magazineSize: 35,
    fireRateRpm: 666.67,
    movementSpeed: 215,
    difficulty: 'medium',
    notes: digitizedNotes('Galil AR', 666.67),
    anchors: ahkDerivedSprays.galil
  },
  {
    id: 'sg553',
    name: 'SG 553',
    magazineSize: 30,
    fireRateRpm: 545.45,
    movementSpeed: 210,
    difficulty: 'hard',
    notes: digitizedNotes('SG 553', 545.45),
    anchors: ahkDerivedSprays.sg553
  }
];

export const weapons: WeaponPattern[] = definitions.map(defineWeapon);

export function getWeapon(id: WeaponId): WeaponPattern {
  const weapon = weapons.find((item) => item.id === id);
  if (!weapon) throw new Error(`Unknown weapon: ${id}`);
  return weapon;
}

export function getSprayCount(length: SprayLength, weapon: WeaponPattern): number {
  return length === 'full' ? weapon.magazineSize : Math.min(length, weapon.magazineSize);
}

export function getPatternForLength(weapon: WeaponPattern, length: SprayLength): RecoilPoint[] {
  return weapon.pattern.slice(0, getSprayCount(length, weapon));
}

export function getImpactPatternForLength(weapon: WeaponPattern, length: SprayLength): RecoilPoint[] {
  return weapon.impactPattern.slice(0, getSprayCount(length, weapon));
}

export function getPatternForWeakSegment(weapon: WeaponPattern, segment?: WeakSegment): RecoilPoint[] {
  const start = Math.max(1, segment?.from ?? 8);
  const end = Math.min(weapon.pattern.length, segment?.to ?? 13);
  const base = weapon.pattern.slice(start - 1, end);
  if (base.length === 0) return getPatternForLength(weapon, 10);
  const origin = base[0];
  return base.map((p, i) => ({
    ...p,
    bullet: start + i,
    x: round2(p.x - origin.x),
    y: round2(p.y - origin.y),
    timeMs: round2(i * weapon.refireMs)
  }));
}
