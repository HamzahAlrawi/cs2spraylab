import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {backgroundFrame,backgroundBudget} from './background-work';
import {createTaskLimiter} from './map-loading';

type DecodeArgs = [count:number,size:number,source:Uint8Array,mode:string,filter?:string];
type Job = {resolve(value:Uint8Array):void;reject(reason:unknown):void;fallback():void;timer:ReturnType<typeof setTimeout>};

/** One disposable worker per map load, shared by its sectors. The decoder's
 * default "Async" API otherwise runs WASM synchronously on the combat thread. */
export function createMapDecoder(signal:AbortSignal) {
  let worker:Worker|undefined,closed=false,next=0;
  const jobs=new Map<number,Job>();
  const submit=createTaskLimiter(1),checkpoint=backgroundBudget(signal,1,4);
  const fallback=async(args:DecodeArgs)=>{
    await MeshoptDecoder.ready;await backgroundFrame(signal);signal.throwIfAborted();
    const bytes=new Uint8Array(args[0]*args[1]);MeshoptDecoder.decodeGltfBuffer(bytes,...args);return bytes;
  };
  const disable=()=>{
    worker?.terminate();worker=undefined;
    for(const job of jobs.values()){clearTimeout(job.timer);job.fallback();}jobs.clear();
  };
  const dispose=()=>{
    if(closed)return;closed=true;signal.removeEventListener('abort',dispose);worker?.terminate();worker=undefined;
    for(const job of jobs.values()){clearTimeout(job.timer);job.reject(signal.reason??new DOMException('Map decoder closed','AbortError'));}jobs.clear();
  };
  signal.throwIfAborted();
  if(typeof Worker!=='undefined')try {
    worker=new Worker(new URL('./map-decoder.worker.ts',import.meta.url),{type:'module'});
    worker.onerror=event=>{event.preventDefault?.();disable();};
    worker.onmessage=(event:MessageEvent<{id:number;bytes?:Uint8Array;error?:string}>)=>{
      const job=jobs.get(event.data.id);if(!job)return;jobs.delete(event.data.id);clearTimeout(job.timer);
      if(event.data.bytes instanceof Uint8Array)job.resolve(event.data.bytes);
      else job.reject(new Error(event.data.error??'Invalid map geometry decode reply'));
    };
  }catch{/* Worker-denied browsers retain the original, frame-yielding decoder. */}
  signal.addEventListener('abort',dispose,{once:true});
  const decoder={...MeshoptDecoder,decodeGltfBufferAsync(...args:DecodeArgs):Promise<Uint8Array>{
    signal.throwIfAborted();if(closed)return Promise.reject(new DOMException('Map decoder closed','AbortError'));
    if(!worker)return fallback(args);
    return new Promise((resolve,reject)=>{
      const id=next++,timer=setTimeout(disable,30000);
      jobs.set(id,{resolve,reject,timer,fallback:()=>{void fallback(args).then(resolve,reject);}});
      void submit(async()=>{
        await checkpoint();if(!jobs.has(id)||!worker)return;
        try{const copy=args[2].slice();worker.postMessage({id,count:args[0],size:args[1],source:copy,mode:args[3],filter:args[4]},[copy.buffer]);}
        catch{disable();}
      },signal).catch(error=>{const job=jobs.get(id);if(job){jobs.delete(id);clearTimeout(job.timer);job.reject(error);}});
    });
  }};
  return {decoder,dispose};
}
