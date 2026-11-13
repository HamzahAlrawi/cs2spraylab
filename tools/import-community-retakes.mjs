import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseKeyValues} from './cosmetic-keyvalues.mjs';

const repository='https://github.com/NeuTroNBZh/CS2-RETAKE';
const commit='9123adca1371ff4cbe90a4630a1ff113124ae8df';
const base=`https://raw.githubusercontent.com/NeuTroNBZh/CS2-RETAKE/${commit}/`;
async function text(file){
  const response=await fetch(base+file);
  if(!response.ok)throw Error(`${file}: HTTP ${response.status}`);
  return response.text();
}
const licenseNotice=await text('LICENSE');
for(const map of ['dust2']){
  const file=`CS2Retake/spawns/de_${map}.json`,raw=await text(file);
  const angles=JSON.parse(raw).map((s,i)=>{
    const position=[s.PositionX,s.PositionY,s.PositionZ],rotation=[s.QAngleX,s.QAngleY,s.QAngleZ];
    if(![...position,...rotation].every(Number.isFinite)||![2,3].includes(s.Team)||![0,1].includes(s.BombSite))throw Error(`Invalid ${map} record ${i+1}`);
    return {index:i+1,spawnId:s.SpawnId,position,rotation,crouched:false,team:s.Team,site:s.BombSite===0?'a':'b',inBombZone:s.IsInBombZone};
  });
  await fs.writeFile(`src/range/prefire/data/community-retakes-${map}.json`,JSON.stringify({source:repository,commit,file,
    sha256:createHash('sha256').update(raw).digest('hex'),license:'GPL-3.0',licenseNotice,
    context:'Community-authored retake spawns, not occupancy statistics. Exact coordinates; per-approach native admission required. Some records may be unsupported on this build.',angles},null,2)+'\n');
  console.log(JSON.stringify({map,records:angles.length}));
}

const legacyRepository='https://github.com/splewis/csgo-retakes',legacyCommit='9aae1570ff4c13b2b501a6f336562486c40d3c81';
const legacyBase=`https://raw.githubusercontent.com/splewis/csgo-retakes/${legacyCommit}/`;
const legacyText=async file=>{const r=await fetch(legacyBase+file);if(!r.ok)throw Error(`HTTP ${r.status}: ${file}`);return r.text();};
const file='configs/retakes/de_mirage.cfg',raw=await legacyText(file),notice=await legacyText('LICENSE');
const vector=value=>{const p=value.trim().split(/\s+/).map(Number);if(p.length!==3||!p.every(Number.isFinite))throw Error('Invalid coordinate');return p;};
const angles=Object.entries(parseKeyValues(raw).Spawns).map(([key,s],i)=>({index:i+1,spawnId:key,position:vector(s.origin),rotation:vector(s.angle),
  crouched:false,team:s.team==='T'?2:3,site:s.bombsite.toLowerCase(),type:Number(s.type)}));
await fs.writeFile('src/range/prefire/data/community-retakes-mirage.json',JSON.stringify({source:legacyRepository,commit:legacyCommit,file,
  sha256:createHash('sha256').update(raw).digest('hex'),license:'GPL-3.0',licenseNotice:notice,
  context:'Legacy CS:GO retake coordinate candidates only. Not current CS2 mechanics, measurements or frequencies. Retain exact XYZ and admit independently against installed CS2 collision per approach.',angles},null,2)+'\n');
console.log(JSON.stringify({map:'mirage',records:angles.length,legacy:true}));
