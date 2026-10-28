import {validatePrefireMapQuality} from './map-quality';
import type {PrefireMapQuality} from './map-quality';
import type {PrefireBuildIdentity, PrefireCatalog} from './schema';

export type PrefireMapPackage<Runtime = unknown> = {
  catalog: PrefireCatalog; build: PrefireBuildIdentity; quality?: PrefireMapQuality;
  // Geometry/material engines remain map-owned and lazily loaded.
  loadRuntime?: (signal?: AbortSignal) => Promise<Runtime>;
};
export type PrefireMapAdapter<Runtime = unknown> = {
  id: string; name: string; load: () => Promise<PrefireMapPackage<Runtime>>;
};

/** No Dust-2 paths, eager native geometry imports or UI coupling in the registry. */
export function createPrefireMapRegistry<Runtime = unknown>(adapters: readonly PrefireMapAdapter<Runtime>[] = []) {
  const entries = new Map<string, PrefireMapAdapter<Runtime>>(), pending = new Map<string, Promise<PrefireMapPackage<Runtime>>>();
  function register(adapter: PrefireMapAdapter<Runtime>) {
    if (!adapter.id.trim() || !adapter.name.trim() || entries.has(adapter.id)) throw new Error(`Duplicate/invalid Prefire map adapter: ${adapter.id}`);
    entries.set(adapter.id, adapter);
  }
  for (const adapter of adapters) register(adapter);
  async function load(id: string): Promise<PrefireMapPackage<Runtime>> {
    const adapter = entries.get(id);
    if (!adapter) throw new Error(`Unknown Prefire map adapter: ${id}`);
    let request = pending.get(id);
    if (!request) {
      request = Promise.resolve().then(() => adapter.load()).then(pack => {
        if (pack.catalog.id !== id || pack.build.mapId !== id || pack.build.catalogRevision !== pack.catalog.revision)
          throw new Error(`Map adapter/catalog/build mismatch: ${id}`);
        return pack;
      }).catch(error => {pending.delete(id); throw error;});
      pending.set(id, request);
    }
    return request;
  }
  return {register, load, list: () => [...entries.values()].map(({id, name}) => ({id, name})),
    async activate(id: string, mode: 'coverage' | 'contextual-evidence' = 'coverage') {
      const pack = await load(id), errors = validatePrefireMapQuality(pack.catalog, pack.build, pack.quality, mode);
      if (errors.length) throw new Error(`Map quality gates failed for ${id}: ${errors.join(' ')}`);
      return pack;
    }};
}
