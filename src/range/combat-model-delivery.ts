import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {fetchDeliveredAsset,prefetchDeliveredAssets,validDeliveredAsset,type DeliveredAsset} from './prefire/asset-delivery';

let manifest:Promise<Record<string,DeliveredAsset>|undefined>|undefined;
function inventory() {
  return manifest??=fetch('/models/combat-delivery.json').then(async response=>{
    if(!response.ok)return;
    const data=await response.json();
    if(data.version!==1||!data.assets||Object.keys(data.assets).length>128||
      Object.entries(data.assets).some(([url,asset])=>!/^\/models\/[a-z0-9-]+\.glb$/.test(url)||!validDeliveredAsset(asset)))
      throw new Error('Invalid combat model delivery');
    return data.assets as Record<string,DeliveredAsset>;
  }).catch(()=>undefined);
}
export async function loadCombatModel(url:string) {
  const asset=(await inventory())?.[url.split('?')[0]];
  const loader=new GLTFLoader();
  return asset?loader.parseAsync(await fetchDeliveredAsset(asset),'/models/'):loader.loadAsync(url);
}
/** Compressed bytes only; no second set of decoded rigs or shader work. */
export async function prefetchCombatModels(urls:readonly string[],signal:AbortSignal) {
  const assets=await inventory();signal.throwIfAborted();
  if(assets)await prefetchDeliveredAssets(urls.flatMap(url=>assets[url]?[assets[url]]:[]),signal);
}
