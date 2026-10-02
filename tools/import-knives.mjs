import fs from 'node:fs';
import path from 'node:path';
import {Matrix4,Quaternion,Vector3} from 'three';
import {nativeInventory,list,run,hash,knifeClips} from './native-knives.mjs';

const refresh = process.argv.includes('--refresh');
const inventory = nativeInventory(refresh), actions = list('animation/anims/viewmodel/knife/','vnmclip_c');
const models = list('weapons/models/knife/','vmdl_c');
const only = process.argv.find(arg=>arg.startsWith('--only='))?.slice(7).split(',');
fs.mkdirSync('research/knives',{recursive:true});
fs.mkdirSync('research/raw-models',{recursive:true});
fs.mkdirSync('research/weapon-actions',{recursive:true});
fs.mkdirSync('research/blender-exports',{recursive:true});
const manifestPath = 'docs/knife-asset-inventory.json';
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : {knives:{}};
const manifest = {...previous,schema:1,build:inventory.build,itemsSha256:inventory.itemsSha256};
for (const knife of inventory.knives.filter(knife=>!only || only.includes(knife.assetKey))) {
  const id = knife.assetKey, bind = `research/raw-models/${id}-rigged.glb`, source = `research/raw-models/actions-${id}.glb`;
  const packed = `research/knives/${id}.vmdl_c`;
  const selected = knifeClips(knife,actions);
  const signature = JSON.stringify({build:inventory.build,model:knife.model,clips:selected.clips});
  const old = previous.knives[id];
  if(refresh || !fs.existsSync(bind) || old?.signature!==signature) {
    run(['-f',knife.model,'-o',packed]);
    run(['-f',knife.model,'-o',bind,'-d','--gltf_export_format','glb','--gltf_export_materials','--gltf_textures_adapt','--gltf_export_animations','--gltf_animation_list','__bind_pose_only__']);
    console.log('IMPORTED knife bind',id);
  }
  if(refresh || !fs.existsSync(source) || old?.signature!==signature) {
    run(['-f','agents/models/ctm_sas/ctm_sas.vmdl_c','-o',source,'-d','--gltf_export_format','glb','--gltf_export_materials','--gltf_textures_adapt','--gltf_export_animations','--gltf_compose_additive',
      '--gltf_animation_list',Object.values(selected.clips).map(file=>path.posix.basename(file,'.vnmclip_c')).join(',')]);
    console.log('IMPORTED knife native view actions',id);
  }
  const bytes=fs.readFileSync(bind), document=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
  const root=document.nodes.findIndex(node=>node.name==='weapon');
  if(root<0)throw new Error(`${id}: no native weapon root`);
  const world = index => {
    const node=document.nodes[index];
    const local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3().fromArray(node.translation??[0,0,0]),new Quaternion().fromArray(node.rotation??[0,0,0,1]),new Vector3().fromArray(node.scale??[1,1,1]));
    const parent=document.nodes.findIndex(candidate=>candidate.children?.includes(index));
    return parent<0?local:world(parent).multiply(local);
  };
  const variant=document.meshes.some(mesh=>mesh.name?.includes('body_hd'))?'hd':document.meshes.some(mesh=>mesh.name?.includes('body_legacy'))?'legacy':'hd';
  const spec={id,assetKey:id,variant,build:inventory.build,source,bind,skeleton:knife.skeleton,...selected,
    pickup:'reuse-native-draw',sourceSha256:hash(source),bindSha256:hash(bind),output:`research/blender-exports/view-${id}.glb`};
  fs.writeFileSync(`research/weapon-actions/${id}.json`,JSON.stringify(spec,null,2)+'\n');
  const unchanged=old?.signature===signature&&old.bindSha256===spec.bindSha256&&old.sourceSha256===spec.sourceSha256;
  manifest.knives[id]={...(unchanged?old:{}),...knife,signature,modelSource:{...models.find(row=>row.path===knife.model),sha256:hash(packed)},
    sourceSha256:spec.sourceSha256,bindSha256:spec.bindSha256,variant,inverseBind:world(root).invert().toArray(),...selected};
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
}
