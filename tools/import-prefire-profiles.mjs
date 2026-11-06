import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {nativeMapIdentity} from './native-map-identity.mjs';
const {mapId,assetId,work}=nativeMapIdentity(process.argv[2]);
const source='https://github.com/lengran/OpenPrefirePrac',commit='44fb66eab70fb3b1b7112ed3c30cc68fb977dd26';
const raw=async file=>{const response=await fetch(`https://raw.githubusercontent.com/lengran/OpenPrefirePrac/${commit}/${file}`);
  if(!response.ok)throw Error(`Source unavailable: ${file}: ${response.status}`);return response.text();};
const response=await fetch(`https://api.github.com/repos/lengran/OpenPrefirePrac/contents/maps/${mapId}?ref=${commit}`);
if(!response.ok)throw Error(`Source listing unavailable: ${response.status}`);
const files=await response.json(),profiles={};
for(const entry of files.filter(f=>f.type==='file'&&/^[a-z0-9_]+\.txt$/.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name))){
  const file=`maps/${mapId}/${entry.name}`,body=await raw(file),lines=body.trim().split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const [activeBots,spawnRatio]=lines[1].split(/\s+/).map(Number),start=lines[2].split(/\s+/).map(Number),angles=[],path=[];
  for(const line of lines.slice(3)){
    const fields=line.split(/\s+/),numbers=fields.slice(0,6).map(Number);
    if(fields.length===3&&numbers.every(Number.isFinite))path.push(numbers);
    else if(fields.length===7&&numbers.every(Number.isFinite)&&/^(true|false)$/i.test(fields[6]))
      angles.push({position:numbers.slice(0,3),rotation:numbers.slice(3,6),crouched:fields[6].toLowerCase()==='true'});
    else throw Error(`Unrecognized source profile row: ${file}`);
  }
  if(start.length!==6||!start.every(Number.isFinite)||!angles.length)throw Error(`Incomplete source profile ${file}`);
  profiles[entry.name.slice(0,-4)]={file,sha256:createHash('sha256').update(body).digest('hex'),activeBots,spawnRatio,
    spawn:start.slice(0,3),rotation:start.slice(3,6),angles,path};
}
const licenseNotice=await raw('LICENSE');
fs.mkdirSync(work,{recursive:true});
fs.writeFileSync(`src/range/prefire/data/openprefire-${assetId}.json`,JSON.stringify({source,commit,license:'MIT',licenseNotice,profiles},null,2)+'\n');
console.log(JSON.stringify({mapId,profiles:Object.keys(profiles),angles:Object.values(profiles).reduce((n,p)=>n+p.angles.length,0)}));
