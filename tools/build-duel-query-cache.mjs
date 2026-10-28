import fs from 'node:fs/promises';
import {createServer} from 'vite';
const root='public/revamp/maps/dust2/duel';
const catalog=JSON.parse(await fs.readFile('src/range/duel/real-map-catalog.json','utf8'));
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
try {
  const {NativeMapCollision}=await server.ssrLoadModule('/src/range/prefire/native-collision.ts');
  for(const chunk of catalog.chunks) {
    const base=`${root}/${chunk.id}`,manifest=JSON.parse(await fs.readFile(`${base}/collision.json`,'utf8'));
    const bytes=await fs.readFile(`${base}/collision.bin`),binary=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    const map=await NativeMapCollision.create(manifest,binary);
    try {
      const {metadata,snapshot}=map.exportPrepared();
      await fs.writeFile(`${base}/query-cache.json`,JSON.stringify(metadata));
      // A full WASM snapshot measured 8.75 MB compressed for Mid alone. Ship
      // small baked indexes instead, keeping the snapshot as a local experiment.
      await fs.mkdir('research/query-snapshots',{recursive:true});
      await fs.writeFile(`research/query-snapshots/${chunk.id}.bin`,snapshot);
      try{await fs.unlink(`${base}/query-world.bin`);}catch(error){if(error.code!=='ENOENT')throw error;}
      const restored=await NativeMapCollision.create(manifest,binary,{metadata});
      try {
        for(const [x,z] of [[0,0],[(map.bounds.minX+map.bounds.maxX)/2,(map.bounds.minZ+map.bounds.maxZ)/2]]) {
          const a=map.vertical({x,y:2,z},10,-5,1.8288),b=restored.vertical({x,y:2,z},10,-5,1.8288);
          if(JSON.stringify(a)!==JSON.stringify(b))throw new Error('Restored support mismatch');
        }
        console.log(JSON.stringify({chunk:chunk.id,snapshotBytes:snapshot.length,queryBytes:Buffer.byteLength(JSON.stringify(metadata)),solids:metadata.solids.length}));
      }finally{restored.dispose();}
    }finally{map.dispose();}
  }
}finally{await server.close();}
