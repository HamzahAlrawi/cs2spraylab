import {validDeliveredAsset} from '../prefire/asset-delivery';
import {defaultNativeMapId, nativeMaps} from '../prefire/maps';
import type {NativeMapDefinition} from '../prefire/native-map-schema';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

function freeze(value:unknown) {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);Object.freeze(value);
  }
}
function validateRelease(map:NativeMapDefinition) {
  if(map.release.version!==1||map.release.map!==map.assetId)throw Error('Unsupported bundled map metadata');
  freeze(map.release);
}

/** Release-pinned root metadata, never a mutable HTTP request or fallback. */
export function localChunkManifest(id:string,map:NativeMapDefinition=nativeMaps.get(defaultNativeMapId)) {
  validateRelease(map);
  const chunk=map.chunks.find(chunk=>chunk.id===id);
  if(!chunk)throw Error(`Unsupported map chunk: ${id}`);
  const metadata=Object.prototype.hasOwnProperty.call(map.release.chunks,id)?map.release.chunks[id]:undefined;
  if(!metadata||metadata.version!==1||metadata.id!==id||metadata.map!==map.assetId||metadata.routeId!==chunk.routeId||
    !same(metadata.sourceMin,chunk.sourceMin)||!same(metadata.sourceMax,chunk.sourceMax)||
    metadata.contextPaddingUnits!==chunk.contextPaddingUnits||!validDeliveredAsset(metadata.delivery))
    throw Error(`Missing or stale bundled map chunk: ${id}`);
  return {...metadata,delivery:metadata.delivery};
}

export function localMapContextManifest(map:NativeMapDefinition=nativeMaps.get(defaultNativeMapId)) {
  validateRelease(map);
  const metadata=map.release.context;
  if(!metadata||![1,2].includes(metadata.version)||metadata.map!==map.assetId||metadata.visualOnly!==true||
    !validDeliveredAsset(metadata.delivery)||metadata.delivery.decodedBytes>5_000_000||metadata.delivery.decodedSha256!==metadata.sha256)
    throw Error('Missing or stale bundled map context');
  return {...metadata,delivery:metadata.delivery};
}
