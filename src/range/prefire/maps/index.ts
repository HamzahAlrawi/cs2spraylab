import {createNativeMapRegistry} from '../native-map-schema';
import {dust2Map} from './dust2';
import {mirageMap} from './mirage';

export const defaultNativeMapId = dust2Map.id;
/** Missing IDs in historical browser saves mean this map, even if the default changes later. */
export const legacyNativeMapId = dust2Map.id;
export const nativeMaps = createNativeMapRegistry([dust2Map,mirageMap],{
  requireApproval:(import.meta as ImportMeta & {env?:{MODE?:string}}).env?.MODE!=='test',provisionalIds:[dust2Map.id],
  betaIds:[mirageMap.id], // Explicitly authorized by the owner, November 6; not a full fidelity approval.
});
