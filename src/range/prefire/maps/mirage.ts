import chunks from './mirage-chunks.json';
import release from './mirage-release.json';
import radar from './mirage-radar.json';
import index from './mirage-index.json';
import fullDelivery from './mirage-full-delivery.json';
import type {NativeMapDefinition,NativeMapRelease,NativeRadarManifest} from '../native-map-schema';
import type {DeliveredAsset} from '../asset-delivery';
import beta from '../../../../docs/map-beta/de_mirage/2026-11-06-v5.receipt.json';
import type {MapBetaReceipt} from '../map-onboarding';

export const mirageMap:NativeMapDefinition={id:'de_mirage',name:'Mirage (Beta)',assetId:'mirage',base:'/maps/mirage/',revision:index.revision,
  chunks:chunks.chunks.map(chunk=>({...chunk,mapId:'de_mirage'})),index,
  release:release as NativeMapRelease,radar:radar as NativeRadarManifest,fullDelivery:fullDelivery as DeliveredAsset,sharedTextureBase:'/maps/mirage/duel/shared/',
  onboarding:{state:'beta',note:'Native geometry beta. Basic paths and hold placement pass; expert coverage, matched-build fidelity and broad-device acceptance remain in progress.',beta:beta as MapBetaReceipt},
  loadCatalog:async()=>(await import('../mirage-routes')).mirageCatalog};
