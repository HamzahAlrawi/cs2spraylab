import chunks from '../../duel/real-map-catalog.json';
import release from '../../duel/map-manifests.json';
import radar from '../../duel/native-radar.json';
import index from './dust2-index.json';
import type {NativeMapDefinition, NativeMapRelease, NativeRadarManifest} from '../native-map-schema';

/** The only runtime boundary that knows Dust 2's files and legacy asset IDs. */
export const dust2Map: NativeMapDefinition = {
  id: 'de_dust2', name: 'Dust 2', assetId: 'dust2', base: '/maps/dust2/', revision: index.revision,
  chunks: chunks.chunks.map(chunk => ({...chunk, mapId: 'de_dust2'})), index,
  release: release as NativeMapRelease, radar: radar as NativeRadarManifest,
  sharedTextureBase: '/maps/dust2/duel/shared/',
  loadCatalog: async () => (await import('../routes')).dust2Catalog,
};
