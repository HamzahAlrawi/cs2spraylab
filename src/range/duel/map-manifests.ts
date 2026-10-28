import release from './map-manifests.json';
import catalog from './real-map-catalog.json';
import {validDeliveredAsset} from '../prefire/asset-delivery';

type ChunkManifest=(typeof release.chunks)[keyof typeof release.chunks];
const chunks:Partial<Record<string,ChunkManifest>>=release.chunks;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

function freeze(value:unknown) {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);Object.freeze(value);
  }
}
freeze(release);

function validateRelease() {
  if(release.version!==1||release.map!==catalog.map)throw Error('Unsupported bundled map metadata');
}

/** Release-pinned root metadata, never a mutable HTTP request or fallback. */
export function localChunkManifest(id:string) {
  validateRelease();
  const chunk=catalog.chunks.find(chunk=>chunk.id===id);
  if(!chunk)throw Error(`Unsupported map chunk: ${id}`);
  const metadata=Object.prototype.hasOwnProperty.call(chunks,id)?chunks[id]:undefined;
  if(!metadata||metadata.version!==1||metadata.id!==id||metadata.map!==catalog.map||metadata.routeId!==chunk.routeId||
    !same(metadata.sourceMin,chunk.sourceMin)||!same(metadata.sourceMax,chunk.sourceMax)||
    metadata.contextPaddingUnits!==chunk.contextPaddingUnits||!validDeliveredAsset(metadata.delivery))
    throw Error(`Missing or stale bundled map chunk: ${id}`);
  return {...metadata,delivery:metadata.delivery};
}

export function localMapContextManifest() {
  validateRelease();
  const metadata=release.context;
  if(!metadata||![1,2].includes(metadata.version)||metadata.map!==catalog.map||metadata.visualOnly!==true||
    !validDeliveredAsset(metadata.delivery)||metadata.delivery.decodedBytes>5_000_000||metadata.delivery.decodedSha256!==metadata.sha256)
    throw Error('Missing or stale bundled map context');
  return {...metadata,delivery:metadata.delivery};
}
