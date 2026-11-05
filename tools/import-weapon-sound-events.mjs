import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';
import {buildCombatEvents,wavInfo} from './import-combat-feedback.mjs';

const game=process.env.CS2_PATH??'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli=process.env.SOURCE2VIEWER??path.resolve('.local-tools/vrf-20.1/Source2Viewer-CLI.exe');
const root='research/weapon-audio-current';fs.mkdirSync(root,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const run=(...args)=>execFileSync(cli,args,{windowsHide:true,stdio:'pipe',timeout:60000,maxBuffer:20e6});
const source='soundevents/game_sounds_weapons.vsndevts_c',compiled=`${root}/weapons.vsndevts_c`,decoded=`${root}/weapons.vsndevts`;
run('-i',`${game}/game/csgo/pak01_dir.vpk`,'-f',source,'-o',compiled);run('-i',compiled,'-d','-o',decoded);
const definitions=parseKv3(fs.readFileSync(decoded,'utf8'));
const manifestPath='public/revamp/audio/events.json',manifest=JSON.parse(fs.readFileSync(manifestPath));
const prior=JSON.parse(fs.readFileSync('src/range/sound-events-data.json'));
const sources=Object.fromEntries(Object.entries(prior.weapons).map(([id,event])=>[id,event.source]));
const steamBytes=fs.readFileSync(`${game}/game/csgo/steam.inf`),build=steamBytes.toString().match(/ClientVersion=(\d+)/)[1];
const sourceHashes={},samples=new Map();let outputBytes=0;
const events=buildCombatEvents(definitions,file=>{
  if(samples.has(file))return samples.get(file);
  if(samples.size>=300)throw Error('Weapon sound sample budget exceeded');
  const raw=`${root}/sample-${sha(file).slice(0,16)}.vsnd_c`;
  run('-i',`${game}/game/csgo/pak01_dir.vpk`,'-f',`${file}_c`,'-o',raw);
  const sourceHash=sha(fs.readFileSync(raw)),id=`weapon-${sourceHash.slice(0,20)}`,url=`/audio/native/${id}.wav`,destination=`public/revamp${url}`;
  sourceHashes[`${file}_c`]=sourceHash;
  if(!fs.existsSync(destination)){
    const output=`${root}/${id}.audio`;run('-i',raw,'-d','-o',output);const bytes=fs.readFileSync(output);
    if(bytes.toString('ascii',0,4)==='RIFF')fs.copyFileSync(output,destination);
    else execFileSync(process.env.FFMPEG??'ffmpeg',['-hide_banner','-loglevel','error','-y','-i',output,'-c:a','pcm_s16le',destination],{windowsHide:true,stdio:'pipe',timeout:60000});
  }
  const wav=fs.readFileSync(destination);outputBytes+=wav.length;
  if(wav.length>4*1024*1024||outputBytes>96*1024*1024)throw Error('Weapon audio byte budget exceeded');
  const result={url,sourceSha256:sourceHash,...wavInfo(wav)};samples.set(file,result);return result;
},{build,eventSource:source,sources,sampleLimit:3});
if(!fs.readFileSync(`${game}/game/csgo/steam.inf`).equals(steamBytes))throw Error('Installed build changed during extraction');
const compact=e=>({source:e.source,volume:e.volume,distanceCurve:e.distanceCurve,dependencies:e.dependencies.map(compact)});
const provenance={build,source,sourceSha256:sha(fs.readFileSync(compiled)),decompiledSha256:sha(fs.readFileSync(decoded)),steamInfSha256:sha(steamBytes),sourceHashes,
  sampleLimit:3,samples:samples.size,outputBytes,method:'Offline Source2Viewer static extraction. Enabled native child events retained; no game module execution.',
  limits:'Browser HRTF, mixgroups, DSP, curve interpolation and thresholds are adaptations, not complete Source 2 mixer parity.'};
manifest.events={...manifest.events,...events};manifest.weaponSoundEvents=provenance;
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync('src/range/weapon-sound-events-data.json',JSON.stringify({...provenance,weapons:Object.fromEntries(Object.entries(events).map(([k,e])=>[k,compact(e)]))},null,2)+'\n');
console.log(JSON.stringify({build,weapons:Object.keys(events).length,samples:samples.size,outputBytes,sourceSha256:provenance.sourceSha256}));
