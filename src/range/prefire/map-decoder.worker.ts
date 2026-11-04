import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';

type Request={id:number;count:number;size:number;source:Uint8Array;mode:string;filter?:string};
const worker=self as unknown as {onmessage:((event:MessageEvent<Request>)=>void)|null;postMessage(value:unknown,transfer:Transferable[]):void};
worker.onmessage=async({data})=>{
  try {
    await MeshoptDecoder.ready;
    const bytes=new Uint8Array(data.count*data.size);
    MeshoptDecoder.decodeGltfBuffer(bytes,data.count,data.size,data.source,data.mode,data.filter);
    worker.postMessage({id:data.id,bytes},[bytes.buffer]);
  }catch(error){worker.postMessage({id:data.id,error:error instanceof Error?error.message:'Invalid compressed map geometry'},[]);}
};
