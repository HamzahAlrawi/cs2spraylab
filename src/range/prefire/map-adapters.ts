import {createPrefireMapRegistry} from './map-registry';
import type {PrefireMap} from './map';
import type {PrefireMapQuality} from './map-quality';
import {defaultNativeMapId, nativeMaps} from './maps';

const read = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Map validation assets are unavailable. Rebuild the map package.');
  return response.json();
};
export const defaultPrefireMapId = defaultNativeMapId;
export const prefireMaps = createPrefireMapRegistry<PrefireMap>(nativeMaps.list().map(map => ({id: map.id, name: map.name,
  async load() {
    const [catalog, manifest, quality] = await Promise.all([
      nativeMaps.loadCatalog(map.id), read<{build: string; collisionSha256: string}>(`${map.base}collision.json`),
      read<PrefireMapQuality>(`${map.base}quality.json`),
    ]);
    return {catalog, build: {mapId: catalog.id, catalogRevision: catalog.revision,
      gameBuild: manifest.build, geometrySha256: manifest.collisionSha256}, quality,
      loadRuntime: async signal => (await import('./map')).loadNativeMap(signal,{base:map.base,sharedTextureBase:map.sharedTextureBase})};
  },
})));
