import type {Vec} from '../actor-physics';
import type {PrefireRoute, SourcePoint} from './schema';

export const sourcePoint = ([x, y, z]: SourcePoint): Vec => ({x: x * .0254, y: z * .0254, z: -y * .0254});

const lineupRoutes = new WeakMap<PrefireRoute, Map<string, PrefireRoute>>();
export function prefireLineup(route: PrefireRoute, id?: string): PrefireRoute {
  const lineup = route.lineups?.find(lineup => lineup.id === id);
  if (!lineup || lineup.id === route.id) return route;
  let variants = lineupRoutes.get(route);
  if (!variants) {variants = new Map(); lineupRoutes.set(route, variants);}
  let variant = variants.get(lineup.id);
  if (!variant) {
    const angles = new Set(lineup.angles.map(angle => angle.id));
    variant = {...route, angles: lineup.angles,
      alternatives: [...route.angles, ...route.alternatives ?? []].filter(angle => !angles.has(angle.id))};
    variants.set(lineup.id, variant);
  }
  return variant;
}
