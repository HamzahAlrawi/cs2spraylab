import {writeCachedQueries,type CacheableQueries} from './query-cache-writer';

const worker=self as unknown as {onmessage:((event:MessageEvent<CacheableQueries>)=>void)|null;postMessage(value:unknown):void};
worker.onmessage=async event=>{
  try{await writeCachedQueries(event.data);worker.postMessage({done:true});}
  catch{worker.postMessage({done:false});}
};
