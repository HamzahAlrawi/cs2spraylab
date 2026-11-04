import {decodeDeliveredBytes} from './asset-decode-core';
import type {DeliveredAsset} from './asset-delivery';
const worker=self as unknown as {onmessage:((event:MessageEvent<{bytes:ArrayBuffer;asset:DeliveredAsset}>)=>void)|null;
  postMessage(value:unknown,transfer:Transferable[]):void};
worker.onmessage=async({data})=>{
  try {const bytes=await decodeDeliveredBytes(data.bytes,data.asset);worker.postMessage({bytes},[bytes]);}
  catch(error){worker.postMessage({error:error instanceof Error?error.message:'Map decompression failed'},[]);}
};
