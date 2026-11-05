import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import pin from './maps/dust2-full-delivery.json';
import {validateDelivery,type DeliveredAsset} from './asset-delivery';

const root='public/revamp',sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
it.skipIf(!existsSync(root+pin.url))('full-map delivery preserves every original geometry/collision/texture byte',()=>{
  const read=(asset:DeliveredAsset)=>{
    const encoded=readFileSync(root+asset.url);expect(encoded.length).toBe(asset.bytes);expect(sha(encoded)).toBe(asset.sha256);
    const decoded=asset.encoding==='gzip'?gunzipSync(encoded):encoded;
    expect(decoded.length).toBe(asset.decodedBytes);expect(sha(decoded)).toBe(asset.decodedSha256);return decoded;
  };
  const delivery=validateDelivery(JSON.parse(read(pin as DeliveredAsset).toString('utf8')));
  for(const [name,asset] of Object.entries(delivery.files))expect(read(asset).equals(readFileSync(`${root}/maps/dust2/${name}`)),name).toBe(true);
  const visual=JSON.parse(readFileSync(`${root}/maps/dust2/visual.json`,'utf8'));
  const images=new Map<string,{bytes:number;sha256:string}>(visual.resources.filter((r:any)=>r.name.endsWith('.webp')).map((r:any)=>[r.name,r]));
  expect(delivery.textures!.images.length).toBe(images.size);
  const bundles=delivery.textures!.bundles.map(read);
  for(const image of delivery.textures!.images){
    const bytes=bundles[image.bundle].subarray(image.offset,image.offset+image.length),resource=images.get(image.name)!;
    expect(bytes.length).toBe(resource.bytes);expect(sha(bytes)).toBe(resource.sha256);
  }
});
