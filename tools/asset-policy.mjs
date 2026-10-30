import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const mediaExtension=/\.(?:glb|gltf|bin|webp|png|jpe?g|wav|ogg|mp3|mp4|fbx|blend\d*|tga|dds|ktx2?|svg|ico|zip|vpk|vtex(?:_c)?|vmdl(?:_c)?|vsnd(?:_c)?|psd|exr)$/i;
export const embeddedMedia=/data:(?:image|audio|model|application\/(?:octet-stream|gltf-buffer|gltf\+json))[^;\s"']*;base64,[A-Za-z0-9+/=]{128,}/;
export function isAssetPath(file){
  return (file.startsWith('public/')&&file!=='public/revamp/_headers')||mediaExtension.test(file);
}
function git(cwd,args,input){return execFileSync('git',['-C',cwd,...args],{input,encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});}
export function inspectTrackedAssets(cwd=process.cwd()){
  const paths=git(cwd,['ls-files','-z']).split('\0').filter(Boolean),files=[],embedded=[];
  for(const file of paths){
    if(isAssetPath(file)){files.push(file);continue;}
    const bytes=fs.readFileSync(path.join(cwd,file));
    if(!bytes.includes(0)&&embeddedMedia.test(bytes.toString('utf8')))embedded.push(file);
  }
  return {files,embedded};
}
export function inspectAssetHistory(cwd=process.cwd(),ref='--all'){
  const objects=git(cwd,['rev-list','--objects',ref]);
  const files=[...new Set(git(cwd,['cat-file','--batch-check=%(objecttype) %(rest)'],objects).split('\n')
    .filter(line=>line.startsWith('blob ')).map(line=>line.slice(5)).filter(isAssetPath))];
  const embedded=[];
  // Git searches each complete tree without checking out old source or executing it.
  for(const commit of git(cwd,['rev-list',ref]).trim().split('\n').filter(Boolean)){
    try {
      const hits=git(cwd,['grep','-l','-I','-E','data:(image|audio|model|application/(octet-stream|gltf-buffer|gltf\\+json))[^;[:space:]"\x27]*;base64,[A-Za-z0-9+/=]{128,}',commit,'--']);
      embedded.push(...hits.trim().split('\n').filter(Boolean));
    }catch(error){if(error.status!==1)throw error;}
  }
  return {files,embedded};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const repo=process.argv.find(arg=>arg.startsWith('--repo='))?.slice(7)||process.cwd();
  const ref=process.argv.find(arg=>arg.startsWith('--ref='))?.slice(6)||'--all';
  const issues=process.argv.includes('--history')?inspectAssetHistory(repo,ref):inspectTrackedAssets(repo);
  console.log(JSON.stringify({scope:process.argv.includes('--history')?'reachable-history':'tracked-source',...issues},null,2));
  if(issues.files.length||issues.embedded.length)process.exitCode=1;
}
