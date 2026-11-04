import {verifyMapDigest} from './map-loading';
import type {DeliveredAsset} from './asset-delivery';

export async function decodeDeliveredBytes(bytes:ArrayBuffer,asset:Pick<DeliveredAsset,'encoding'|'decodedBytes'|'decodedSha256'>,signal?:AbortSignal) {
  let decoded:ArrayBuffer;
  if(asset.encoding==='gzip') {
    const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const output=new Uint8Array(asset.decodedBytes);let offset=0;
    const abort=()=>{void reader.cancel(signal?.reason).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try {
      signal?.throwIfAborted();
      while(true){const {value,done}=await reader.read();signal?.throwIfAborted();if(done)break;
        if(offset+value.length>output.length){await reader.cancel();throw new Error('Map decompression exceeds size budget');}
        output.set(value,offset);offset+=value.length;
      }
      if(offset!==output.length)throw new Error('Map decompression size mismatch');
      decoded=output.buffer;
    }finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
  }else decoded=bytes.slice(0);
  signal?.throwIfAborted();
  if(decoded.byteLength!==asset.decodedBytes)throw new Error('Map decompression size mismatch');
  await verifyMapDigest(decoded,asset.decodedSha256);signal?.throwIfAborted();return decoded;
}
