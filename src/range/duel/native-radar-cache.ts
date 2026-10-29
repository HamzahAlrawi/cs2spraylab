import {fetchDeliveredAsset,type DeliveredAsset} from '../prefire/asset-delivery';
import manifestData from './native-radar.json';
import {sourceRadarOverview,type SourceRadarMetadata} from './radar-overview';
import type {RadarOverview} from './radar';

export type NativeRadarOverview=RadarOverview & {image:CanvasImageSource & {close():void}};
export type NativeRadarLease<T extends NativeRadarOverview=NativeRadarOverview>={overview:T;dispose():void};
export type NativeRadarManifest={build:string;map:'dust2';metadata:SourceRadarMetadata;delivery:DeliveredAsset};
type Entry<T>={controller:AbortController;users:number;overview?:T;closed:boolean;promise:Promise<T>};

/** Signals cancel pending acquisitions; returned leases live until disposed. */
export class SharedNativeRadarCache<T extends NativeRadarOverview=NativeRadarOverview> {
  private entry?:Entry<T>;
  constructor(private readonly loader:(signal:AbortSignal)=>Promise<T>) {}

  private close(entry:Entry<T>) {
    if(entry.overview&&!entry.closed){entry.closed=true;entry.overview.image.close();}
  }
  private release(entry:Entry<T>) {
    if(--entry.users)return;
    if(this.entry===entry)this.entry=undefined;
    if(entry.overview)this.close(entry);else entry.controller.abort();
  }
  private start():Entry<T> {
    const entry:Entry<T>={controller:new AbortController(),users:0,closed:false,promise:undefined as unknown as Promise<T>};
    this.entry=entry;
    entry.promise=Promise.resolve().then(()=>{
      entry.controller.signal.throwIfAborted();return this.loader(entry.controller.signal);
    }).then(overview=>{
      entry.overview=overview;
      // Decoding may finish after its last waiter cancels, even if the loader
      // cannot interrupt the decode. It must not leak or poison a newer entry.
      if(entry.controller.signal.aborted){this.close(entry);entry.controller.signal.throwIfAborted();}
      return overview;
    }).catch(error=>{if(this.entry===entry)this.entry=undefined;throw error;});
    return entry;
  }
  async acquire(signal?:AbortSignal):Promise<NativeRadarLease<T>> {
    signal?.throwIfAborted();
    const entry=this.entry??this.start();entry.users++;
    let released=false;
    const dispose=()=>{if(!released){released=true;this.release(entry);}};
    return new Promise((resolve,reject)=>{
      let settled=false;
      const cancel=()=>{
        if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);
        dispose();reject(signal?.reason??new DOMException('Radar acquisition cancelled','AbortError'));
      };
      signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted)cancel();
      entry.promise.then(overview=>{
        if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);
        resolve({overview,dispose});
      },error=>{
        if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);dispose();reject(error);
      });
    });
  }
}

async function loadOverview(signal:AbortSignal):Promise<NativeRadarOverview> {
  signal.throwIfAborted();
  const manifest=manifestData as NativeRadarManifest;
  if(manifest.map!=='dust2')throw Error('Invalid native radar map');
  const bytes=await fetchDeliveredAsset(manifest.delivery,signal);signal.throwIfAborted();
  const image=await createImageBitmap(new Blob([bytes],{type:'image/webp'}));
  try {
    signal.throwIfAborted();
    return {...sourceRadarOverview(image,manifest.metadata),image};
  }catch(error){image.close();throw error;}
}

const cache=new SharedNativeRadarCache(loadOverview);
export const loadNativeRadar=(signal?:AbortSignal)=>cache.acquire(signal);
export default loadNativeRadar;
