import {createPrefireMapRegistry} from './map-registry';
import type {PrefireMap} from './map';
import type {PrefireMapQuality} from './map-quality';

const read = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Map validation assets are unavailable. Rebuild the map package.');
  return response.json();
};
export const defaultPrefireMapId = 'de_dust2';
export const prefireMaps = createPrefireMapRegistry<PrefireMap>([{id: 'de_dust2', name: 'Dust 2',
  async load() {
    const [{dust2Catalog}, manifest, quality] = await Promise.all([
      import('./routes'), read<{build: string; collisionSha256: string}>('/maps/dust2/collision.json'),
      read<PrefireMapQuality>('/maps/dust2/quality.json'),
    ]);
    return {catalog: dust2Catalog, build: {mapId: dust2Catalog.id, catalogRevision: dust2Catalog.revision,
      gameBuild: manifest.build, geometrySha256: manifest.collisionSha256}, quality,
      loadRuntime: async signal => (await import('./map')).loadDust2(signal)};
  },
}]);
