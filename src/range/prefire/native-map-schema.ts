import type {DeliveredAsset} from './asset-delivery';
import type {PrefireCatalog} from './schema';
import type {SourceRadarMetadata} from '../duel/radar-overview';

export type NativeMapChunk = {id: string; name: string; routeId: string; sourceMin: readonly number[];
  sourceMax: readonly number[]; contextPaddingUnits: number; mapId: string};
export type NativeRouteSummary = {id: string; name: string; lineups?: readonly {id: string; name: string}[]};
export type NativeMapIndex = {id: string; revision: string; routes: readonly NativeRouteSummary[]; aliases: Readonly<Record<string, string>>;
  approaches: Readonly<Record<string, readonly NativeRouteSummary[]>>};
export type NativeChunkManifest = {version: number; id: string; map: string; routeId: string;
  sourceMin: readonly number[]; sourceMax: readonly number[]; contextPaddingUnits: number;
  sourceCollisionSha256: string; collisionManifestSha256: string; visualManifestSha256: string;
  navigationSha256: string; delivery?: DeliveredAsset; radar?: {file: string; sha256: string}; [key: string]: unknown};
export type NativeContextManifest = {version: number; map: string; visualOnly: boolean;
  delivery: DeliveredAsset; sha256: string; [key: string]: unknown};
export type NativeRadarManifest = {build: string; map: string; metadata: SourceRadarMetadata; delivery: DeliveredAsset};
export type NativeMapRelease = {version: number; map: string; chunks: Readonly<Record<string, NativeChunkManifest>>;
  context?: NativeContextManifest};
export type NativeMapDefinition = {
  id: string; name: string; assetId: string; base: string; revision: string;
  chunks: readonly NativeMapChunk[]; index: NativeMapIndex;
  release: NativeMapRelease; radar?: NativeRadarManifest;
  sharedTextureBase?: string;
  loadCatalog(): Promise<PrefireCatalog>;
};

/** Descriptors are small; geometry and full route/evidence catalogs stay lazy. */
export function createNativeMapRegistry(definitions: readonly NativeMapDefinition[] = []) {
  const maps = new Map<string, NativeMapDefinition>(), pending = new Map<string, Promise<PrefireCatalog>>();
  const get = (id: string) => {
    const map = maps.get(id);
    if (!map) throw new Error(`Unknown native map: ${id}`);
    return map;
  };
  function register(map: NativeMapDefinition) {
    if (!/^[a-z0-9_\-]+$/.test(map.id) || !/^[a-z0-9][a-z0-9_-]*$/.test(map.assetId) || !map.revision.trim() ||
      !map.name.trim() || !/^\/maps\/[a-z0-9_\-/]+\/$/.test(map.base) ||
      maps.has(map.id) || !map.chunks.length || !map.index.routes.length || map.release.version !== 1 ||
      map.release.map !== map.assetId || map.index.id !== map.id || map.index.revision !== map.revision ||
      new Set(map.chunks.map(chunk => chunk.id)).size !== map.chunks.length ||
      new Set(map.index.routes.map(route => route.id)).size !== map.index.routes.length ||
      map.chunks.some(chunk => chunk.mapId !== map.id || !/^[a-zA-Z0-9_-]{1,100}$/.test(chunk.id) ||
        chunk.sourceMin.length !== 3 || chunk.sourceMax.length !== 3 ||
        chunk.sourceMin.some((min, axis) => !Number.isFinite(min) || !Number.isFinite(chunk.sourceMax[axis]) || min >= chunk.sourceMax[axis]) ||
        !Number.isFinite(chunk.contextPaddingUnits) || chunk.contextPaddingUnits < 0 ||
        !map.index.approaches[chunk.id]?.length || map.index.approaches[chunk.id].some(route => !map.index.routes.some(item => item.id === route.id)) ||
        !map.index.routes.some(route => route.id === chunk.routeId))) throw new Error(`Invalid/duplicate native map: ${map.id}`);
    maps.set(map.id, map);
  }
  definitions.forEach(register);
  return {get, register, list: () => [...maps.values()], has: (id: unknown): id is string => typeof id === 'string' && maps.has(id),
    async loadCatalog(id: string) {
      const map = get(id);
      let request = pending.get(id);
      if (!request) {
        request = Promise.resolve().then(() => map.loadCatalog()).then(catalog => {
          if (catalog.id !== id || catalog.revision !== map.revision ||
            catalog.density && catalog.density.mapId !== id ||
            catalog.routes.length !== map.index.routes.length ||
            new Set(catalog.routes.map(route => route.id)).size !== catalog.routes.length ||
            catalog.routes.some(route => !map.index.routes.some(item => item.id === route.id)))
            throw new Error(`Native map catalog/index mismatch: ${id}`);
          return catalog;
        }).catch(error => {pending.delete(id); throw error;});
        pending.set(id, request);
      }
      return request;
    },
  };
}

export const nativeChunkKey = (map: NativeMapDefinition, chunk: NativeMapChunk) => {
  if (chunk.mapId !== map.id) throw new Error('Map/chunk identity mismatch.');
  const manifest = map.release.chunks[chunk.id];
  if (!manifest) throw new Error('Map chunk has no pinned manifest.');
  return `${map.id}:${map.revision}:${chunk.id}:${manifest.delivery?.decodedSha256 ?? manifest.collisionManifestSha256}`;
};
