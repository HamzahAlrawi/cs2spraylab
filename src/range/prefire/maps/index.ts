import {createNativeMapRegistry} from '../native-map-schema';
import {dust2Map} from './dust2';

export const defaultNativeMapId = dust2Map.id;
/** Missing IDs in historical browser saves mean this map, even if the default changes later. */
export const legacyNativeMapId = dust2Map.id;
export const nativeMaps = createNativeMapRegistry([dust2Map]);
