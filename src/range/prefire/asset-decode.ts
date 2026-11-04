import type {DeliveredAsset} from './asset-delivery';
import {decodeDeliveredBytes} from './asset-decode-core';

type Job={bytes:ArrayBuffer;asset:DeliveredAsset;signal?:AbortSignal;resolve(bytes:ArrayBuffer):void;reject(error:unknown):void;abort():void};
const queue:Job[]=[];
let worker:Worker|undefined,active:Job|undefined,disabled=false,timer:ReturnType<typeof setTimeout>|undefined;
function close(){clearTimeout(timer);timer=undefined;worker?.terminate();worker=undefined;}
function complete(error?:unknown,bytes?:ArrayBuffer) {
  const job=active;if(!job)return;active=undefined;clearTimeout(timer);timer=undefined;
  job.signal?.removeEventListener('abort',job.abort);
  if(error)job.reject(error);else job.resolve(bytes!);
  run();
}
function unavailable() {
  disabled=true;close();const job=active;active=undefined;
  if(job){job.signal?.removeEventListener('abort',job.abort);void decodeDeliveredBytes(job.bytes,job.asset,job.signal).then(job.resolve,job.reject);}
  run();
}
function run() {
  if(active)return;
  const job=queue.shift();
  if(!job){if(worker)timer=setTimeout(close,1000);return;}
  clearTimeout(timer);timer=undefined;active=job;
  if(disabled||typeof Worker==='undefined'){unavailable();return;}
  try {
    if(!worker){
      worker=new Worker(new URL('./asset-decode.worker.ts',import.meta.url),{type:'module'});
      const owner=worker;
      worker.onerror=event=>{event.preventDefault?.();if(worker===owner)unavailable();};
      worker.onmessage=(event:MessageEvent<{bytes?:ArrayBuffer;error?:string}>)=>{
        if(worker!==owner)return;
        const bytes=event.data.bytes;
        if(bytes instanceof ArrayBuffer&&bytes.byteLength===active?.asset.decodedBytes)complete(undefined,bytes);
        else complete(new Error(event.data.error??'Map decompression size mismatch'));
      };
    }
    // The cache owns the compressed original; only a bounded copy is transferred.
    const copy=job.bytes.slice(0);worker.postMessage({bytes:copy,asset:job.asset},[copy]);
    timer=setTimeout(unavailable,30000);
  }catch{unavailable();}
}

/** Serialize large inflation/hash jobs on one worker; keep browser storage and
 * content-addressed downloads unchanged. Idle/cancelled workers are terminated. */
export function decodeAsset(bytes:ArrayBuffer,asset:DeliveredAsset,signal?:AbortSignal):Promise<ArrayBuffer> {
  signal?.throwIfAborted();
  if(asset.decodedBytes<512*1024||typeof Worker==='undefined')return decodeDeliveredBytes(bytes,asset,signal);
  return new Promise((resolve,reject)=>{
    const job:Job={bytes,asset,signal,resolve,reject,abort(){
      if(active===job){close();complete(signal?.reason??new DOMException('Aborted','AbortError'));}
      else {const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);signal?.removeEventListener('abort',job.abort);
        reject(signal?.reason??new DOMException('Aborted','AbortError'));}
    }};
    signal?.addEventListener('abort',job.abort,{once:true});queue.push(job);run();
  });
}
