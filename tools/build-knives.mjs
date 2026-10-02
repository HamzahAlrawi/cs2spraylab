import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {hash} from './native-knives.mjs';

const blender=process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const manifestPath='docs/knife-asset-inventory.json';
const manifest=JSON.parse(fs.readFileSync(manifestPath));
const only=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7).split(',');
const refresh=process.argv.includes('--refresh');
fs.mkdirSync('public/revamp/models',{recursive:true});
for(const [id,knife] of Object.entries(manifest.knives).filter(([id])=>!only||only.includes(id))) {
  const spec=`research/weapon-actions/${id}.json`;
  for(const [script,key] of [['art/build_knife_world.py',id],['art/build_reload.py',`view-${id}`]]) {
    const output=`public/revamp/models/${key}.glb`;
    const builderSha256=hash(script),specSha256=hash(spec);
    if(!refresh && knife.exports?.[key]?.builderSha256===builderSha256 && knife.exports[key].specSha256===specSha256 &&
      knife.exports[key].sha256=== (fs.existsSync(output)?hash(output):null))continue;
    const log=`research/knives/${key}-build.log`;
    try {
      const result=execFileSync(blender,['--background','--factory-startup','--python-exit-code','1','--python',script,'--',spec],{encoding:'utf8',maxBuffer:30e6});
      fs.writeFileSync(log,result);
    } catch(error) {fs.writeFileSync(log,`${error.stdout??''}\n${error.stderr??''}`);throw new Error(`${key}: Blender failed; see ${log}`);}
    execFileSync(process.execPath,['node_modules/@gltf-transform/cli/bin/cli.js','optimize',`research/blender-exports/${key}.glb`,output,
      '--compress','false','--texture-compress','webp','--texture-size','1024','--simplify','false','--instance','false'],{stdio:'pipe',maxBuffer:10e6});
    const bytes=fs.readFileSync(output),doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
    knife.exports??={};
    knife.exports[key]={bytes:bytes.length,sha256:hash(output),builderSha256,specSha256,meshes:doc.meshes.map(mesh=>mesh.name),animations:(doc.animations??[]).map(clip=>clip.name)};
    if(key.startsWith('view-'))knife.viewAudit=JSON.parse(fs.readFileSync(`research/weapon-actions/${id}-export.json`));
    fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    console.log('EXPORTED',key,`${(bytes.length/1048576).toFixed(2)} MiB`);
  }
}
