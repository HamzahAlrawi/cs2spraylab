import { WeaponId } from '../types';

export type ModelPartBase = {
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
  metalness: number;
  roughness: number;
};

export type BoxModelPart = ModelPartBase & {
  kind: 'box';
  size: [number, number, number];
};

export type CylinderModelPart = ModelPartBase & {
  kind: 'cylinder';
  radiusTop: number;
  radiusBottom: number;
  depth: number;
};

export type WeaponModelPart = BoxModelPart | CylinderModelPart;

export type WeaponModelAsset = {
  schemaVersion: 1;
  name: string;
  family: string;
  license: string;
  parts: WeaponModelPart[];
};

const fallbackModelByWeaponId: Record<WeaponId, string> = {
  ak47: 'ak47',
  galil: 'galil',
  m4a4: 'm4a4',
  m4a1s: 'm4a1s',
  famas: 'famas',
  sg553: 'm4a4',
  mp9: 'mp9',
  mp7: 'mp9',
  mac10: 'mac10',
  p90: 'mp9'
};

export function getWeaponModelUrl(weaponId: WeaponId): string {
  return `/models/${fallbackModelByWeaponId[weaponId]}.json`;
}

function isNumberTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isModelPart(value: unknown): value is WeaponModelPart {
  if (!value || typeof value !== 'object') return false;
  const part = value as Record<string, unknown>;
  const baseOk =
    typeof part.name === 'string' &&
    isNumberTuple(part.position, 3) &&
    isNumberTuple(part.rotation, 3) &&
    typeof part.color === 'string' &&
    typeof part.metalness === 'number' &&
    typeof part.roughness === 'number';
  if (!baseOk) return false;
  if (part.kind === 'box') return isNumberTuple(part.size, 3);
  if (part.kind === 'cylinder') {
    return typeof part.radiusTop === 'number' && typeof part.radiusBottom === 'number' && typeof part.depth === 'number';
  }
  return false;
}

export function parseWeaponModelAsset(value: unknown): WeaponModelAsset {
  if (!value || typeof value !== 'object') throw new Error('Weapon model asset must be an object.');
  const asset = value as Record<string, unknown>;
  if (asset.schemaVersion !== 1) throw new Error('Unsupported weapon model schema version.');
  if (typeof asset.name !== 'string' || typeof asset.family !== 'string' || typeof asset.license !== 'string') {
    throw new Error('Weapon model asset is missing required metadata.');
  }
  if (!Array.isArray(asset.parts) || asset.parts.length < 4) {
    throw new Error('Weapon model asset must contain multiple mesh parts.');
  }
  if (!asset.parts.every(isModelPart)) throw new Error('Weapon model asset contains an invalid part.');
  return asset as WeaponModelAsset;
}
