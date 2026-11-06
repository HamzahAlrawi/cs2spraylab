import type {DeliveredAsset} from './asset-delivery';
import type {PrefireCatalog} from './schema';
import type {SourceRadarMetadata} from '../duel/radar-overview';
import {catalogSha256,validateMapAcceptance,validateMapCatalogScope,validateMapBeta,type MapAcceptanceReceipt,type MapBetaReceipt} from './map-onboarding';

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
  fullDelivery?: DeliveredAsset;
  onboarding?:{state:'draft'|'provisional'|'approved'|'beta';note:string;acceptance?:MapAcceptanceReceipt;beta?:MapBetaReceipt};
  loadCatalog(): Promise<PrefireCatalog>;
};

/** Descriptors are small; geometry and full route/evidence catalogs stay lazy. */
export function createNativeMapRegistry(definitions: readonly NativeMapDefinition[] = [],
  policy:{requireApproval?:boolean;provisionalIds?:readonly string[];betaIds?:readonly string[]}={}) {
  const maps = new Map<string, NativeMapDefinition>(), pending = new Map<string, Promise<PrefireCatalog>>();
  const decisions=new WeakMap<NativeMapDefinition,string[]>(),approvedCatalogs=new WeakSet<PrefireCatalog>();
  const forAuthoring = (id: string) => {
    const map = maps.get(id);
    if (!map) throw new Error(`Unknown native map: ${id}`);
    return map;
  };
  const admissionErrors=(map:NativeMapDefinition)=>{
    if(!policy.requireApproval)return [];
    let errors=decisions.get(map);if(errors)return errors;
    const review=map.onboarding;
    errors=review?.state==='provisional'&&typeof review.note==='string'&&review.note.trim()&&policy.provisionalIds?.includes(map.id)?[]:
      review?.state==='approved'?validateMapAcceptance(map,review.acceptance):review?.state==='beta'&&policy.betaIds?.includes(map.id)?validateMapBeta(map,review.beta):['Map is a draft or has no approved acceptance receipt.'];
    decisions.set(map,errors);return errors;
  };
  const get=(id:string)=>{const map=forAuthoring(id),errors=admissionErrors(map);
    if(errors.length)throw Error(`Native map not admitted: ${id}: ${errors.join(' ')}`);return map;};
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
  async function loadCatalogForAuthoring(id:string){
      const map = forAuthoring(id);
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
  }
  return {get,forAuthoring,loadCatalogForAuthoring,register,
    candidates:()=>[...maps.values()].map(map=>({id:map.id,name:map.name,state:map.onboarding?.state??'draft',errors:admissionErrors(map)})),
    list: () => [...maps.values()].filter(map=>!admissionErrors(map).length),
    has: (id: unknown): id is string => typeof id === 'string' && maps.has(id)&&!admissionErrors(maps.get(id)!).length,
    async loadCatalog(id:string){
      const map=get(id),catalog=await loadCatalogForAuthoring(id);
      if(policy.requireApproval&&['approved','beta'].includes(map.onboarding?.state??'')&&!approvedCatalogs.has(catalog)){
        const review=map.onboarding!,beta=review.state==='beta';
        const errors=beta?validateMapBeta(map,review.beta,catalog):validateMapAcceptance(map,review.acceptance,catalog);
        if(await catalogSha256(catalog)!==(beta?review.beta:review.acceptance)?.catalogSha256)errors.push('Catalog/source/weighting snapshot changed after acceptance.');
        errors.push(...validateMapCatalogScope(map,catalog));
        if(errors.length)throw Error(`Native map not admitted: ${id}: ${errors.join(' ')}`);
        approvedCatalogs.add(catalog);
      }
      return catalog;
    }
  };
}

export const nativeChunkKey = (map: NativeMapDefinition, chunk: NativeMapChunk) => {
  if (chunk.mapId !== map.id) throw new Error('Map/chunk identity mismatch.');
  const manifest = map.release.chunks[chunk.id];
  if (!manifest) throw new Error('Map chunk has no pinned manifest.');
  return `${map.id}:${map.revision}:${chunk.id}:${manifest.delivery?.decodedSha256 ?? manifest.collisionManifestSha256}`;
};
