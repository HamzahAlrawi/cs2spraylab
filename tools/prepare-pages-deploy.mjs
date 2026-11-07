import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const limit=25*1024*1024,decodedLimit=64*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function readDelivered(root,asset,map){
  if(!asset||!new RegExp(`^/maps/${map}/duel/objects/[a-f0-9]{64}\\.bin$`).test(asset.url)||
    !asset.url.endsWith(`/${asset.sha256}.bin`)||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>limit||
    !Number.isSafeInteger(asset.decodedBytes)||asset.decodedBytes<1||asset.decodedBytes>decodedLimit)
    throw Error('Invalid native map delivery descriptor');
  const bytes=await fs.readFile(path.join(root,asset.url.slice(1)));
  if(bytes.length!==asset.bytes||sha(bytes)!==asset.sha256)throw Error('Native map delivery digest mismatch');
  const decoded=asset.encoding==='gzip'?gunzipSync(bytes,{maxOutputLength:decodedLimit}):asset.encoding==='identity'?bytes:undefined;
  if(!decoded||decoded.length!==asset.decodedBytes||sha(decoded)!==asset.decodedSha256)throw Error('Native map decoded digest mismatch');
  return decoded;
}

/** Remove only redundant oversized authoring snapshots from generated output. */
export async function preparePagesDeploy(directory='dist',pinsDirectory='src/range/prefire/maps'){
  const root=await fs.realpath(directory),pending=[root],remove=[];
  while(pending.length){
    const parent=pending.pop();
    for(const entry of await fs.readdir(parent,{withFileTypes:true})){
      if(entry.isSymbolicLink())throw Error('Deployment output cannot contain symlinks');
      const file=path.join(parent,entry.name);
      if(entry.isDirectory()){pending.push(file);continue;}
      const size=(await fs.stat(file)).size;if(size<=limit)continue;
      const relative=path.relative(root,file).split(path.sep).join('/');
      const match=/^maps\/([a-z0-9][a-z0-9_-]*)\/grenade-query\.bin$/.exec(relative);
      if(!match)throw Error(`Oversized runtime asset: ${relative}`);
      const map=match[1],pin=JSON.parse(await fs.readFile(path.join(pinsDirectory,`${map}-full-delivery.json`),'utf8'));
      const manifest=JSON.parse((await readDelivered(root,pin,map)).toString('utf8'));
      const decoded=await readDelivered(root,manifest.files?.['grenade-query.bin'],map);
      const raw=await fs.readFile(file);
      if(raw.length!==decoded.length||sha(raw)!==sha(decoded))throw Error(`Raw grenade snapshot differs from verified delivery: ${map}`);
      remove.push({file,path:relative,bytes:size});
    }
  }
  // Validate the entire output before removing any generated copy. Source assets stay untouched.
  for(const entry of remove)await fs.unlink(entry.file);
  return remove.map(({path,bytes})=>({path,bytes}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  console.log(JSON.stringify({omittedRedundantSnapshots:await preparePagesDeploy()},null,2));
