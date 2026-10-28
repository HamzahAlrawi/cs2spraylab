import type {Vec} from '../actor-physics';
import nativeFootsteps from '../native-footsteps-data.json';

const footstepSurfaces: Readonly<Record<string, string>> = nativeFootsteps.surfaces;

export type SurfaceMaterial = 'concrete' | 'metal' | 'wood' | 'plastic' | 'glass' | 'grate' | 'water' | 'flesh';
export type NativeSurface = Readonly<{
  id: number; hash: number; name?: string; gameMaterial?: string;
  penetrationModifier?: number; damageModifier?: number;
  // Family comes from the resolved source inheritance chain, never a texture.
  material?: SurfaceMaterial; bulletImpact?: string;
}>;
export type NativePrimitive = {
  id: number; firstTriangle: number; triangleCount: number; surfaceId: number;
  kind: 'convex-hull' | 'mesh';
  triangleSurfaces?: number[];
};
export type NativeSurfaceHit = {
  surfaceId: number; primitiveId?: number; surface?: NativeSurface;
};
export type NativeSurfaceInterval = NativeSurfaceHit & {
  entry: number; exit?: number; entryNormal: Vec; exitNormal?: Vec;
  validated: boolean;
};
export type NativeSurfaceQueries = {
  ray(origin: Vec, direction: Vec, range: number): (NativeSurfaceHit & {distance:number;normal:Vec}) | undefined;
  traceSolid?(origin: Vec, direction: Vec, range: number): NativeSurfaceInterval[];
  materialForSurface?(surfaceId: number): NativeSurface | undefined;
  floorSurfaceAt?(x: number, z: number, from?: number, distance?: number): (NativeSurfaceHit & {distance:number;normal:Vec}) | undefined;
};

// Unknown metadata stays unknown. Callers choose their own presentation fallback;
// bullet traversal must not turn an audio fallback into permeability.
export function surfaceFootstepMaterial(surface?: NativeSurface): string {
  const bank = surface?.name && footstepSurfaces[surface.name.toLowerCase()];
  if (bank) return bank;
  return surface?.material === 'wood' ? 'wood' : surface?.material === 'metal' || surface?.material === 'grate' ? 'metal' : 'concrete';
}

export function validateNativeSurfaces(surfaces: readonly NativeSurface[]) {
  const ids = new Set<number>();
  const families = new Set(['concrete', 'metal', 'wood', 'plastic', 'glass', 'grate', 'water', 'flesh']);
  for (const surface of surfaces) {
    if (!Number.isSafeInteger(surface.id) || surface.id < 0 || ids.has(surface.id) ||
      !Number.isSafeInteger(surface.hash) || surface.hash < 0 || surface.hash > 0xffffffff ||
      (surface.material !== undefined && !families.has(surface.material)) ||
      (surface.penetrationModifier !== undefined && (!Number.isFinite(surface.penetrationModifier) || surface.penetrationModifier <= 0)) ||
      (surface.damageModifier !== undefined && (!Number.isFinite(surface.damageModifier) || surface.damageModifier < 0))) {
      throw new Error('Invalid native surface metadata');
    }
    ids.add(surface.id);
  }
}
