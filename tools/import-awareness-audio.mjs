import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';
import {footstepDefinition} from './native-footsteps.mjs';

// Static extraction only. Existing weapon, utility and footstep banks are retained.
const game=process.env.CS2_PATH??'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli=process.env.SOURCE2VIEWER??path.resolve('.local-tools/vrf-20.1/Source2Viewer-CLI.exe');
const root='research/awareness-audio';fs.mkdirSync(root,{recursive:true});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const run=(...args)=>execFileSync(cli,args,{windowsHide:true,stdio:'pipe',maxBuffer:20e6});
const source='soundevents/game_sounds_player.vsndevts_c',compiled=`${root}/player.vsndevts_c`,decoded=`${root}/player.vsndevts`;
run('-i',`${game}/game/csgo/pak01_dir.vpk`,'-f',source,'-o',compiled);
run('-i',compiled,'-d','-o',decoded);
const event=parseKv3(fs.readFileSync(decoded,'utf8'))['Default.WalkJump'];
if(!event?.vsnd_files_track_01?.length||!event.distance_volume_mapping_curve?.length)throw Error('Missing native jump source');
const sample=event.vsnd_files_track_01[0],sampleCompiled=`${root}/jump.vsnd_c`,sampleDecoded=`${root}/jump.audio`;
run('-i',`${game}/game/csgo/pak01_dir.vpk`,'-f',`${sample}_c`,'-o',sampleCompiled);
run('-i',sampleCompiled,'-d','-o',sampleDecoded);
const bytes=fs.readFileSync(sampleDecoded),url=`/audio/native/jump-${sha(fs.readFileSync(sampleCompiled)).slice(0,16)}.wav`;
if(bytes.toString('ascii',0,4)==='RIFF')fs.copyFileSync(sampleDecoded,`public/revamp${url}`);
else execFileSync(process.env.FFMPEG??'ffmpeg',['-hide_banner','-loglevel','error','-y','-i',sampleDecoded,'-c:a','pcm_s16le',`public/revamp${url}`],{windowsHide:true,stdio:'pipe'});
const build=fs.readFileSync(`${game}/game/csgo/steam.inf`,'utf8').match(/ClientVersion=(\d+)/)[1];
const jump={source:'Default.WalkJump',samples:[url],sampleSources:[sample],volume:event.volume,pitch:event.pitch,positionOffset:event.position_offset,distanceCurve:event.distance_volume_mapping_curve.map(row=>row.slice(0,2))};
const manifestPath='public/revamp/audio/events.json',manifest=JSON.parse(fs.readFileSync(manifestPath));
manifest.events.jump=jump;fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const footSource='soundevents/game_sounds_footsteps.vsndevts_c',footCompiled=`${root}/footsteps.vsndevts_c`,footDecoded=`${root}/footsteps.vsndevts`;
run('-i',`${game}/game/csgo/pak01_dir.vpk`,'-f',footSource,'-o',footCompiled);run('-i',footCompiled,'-d','-o',footDecoded);
const footstep=footstepDefinition(parseKv3(fs.readFileSync(footDecoded,'utf8')),'CT_Concrete.StepLeft');
const reference={build,source,sourceSha256:sha(fs.readFileSync(compiled)),decompiledSha256:sha(fs.readFileSync(decoded)),sampleSource:`${sample}_c`,sampleSha256:sha(fs.readFileSync(sampleCompiled)),jump,
  footsteps:{source:footSource,sourceSha256:sha(fs.readFileSync(footCompiled)),decompiledSha256:sha(fs.readFileSync(footDecoded)),blockDuration:footstep.block_duration},
  cues:Object.fromEntries(['utility-he-bounce','utility-smoke-bounce','utility-he-detonate','utility-flash-detonate'].map(key=>{
    const event=manifest.events[key];if(!event?.distanceCurve?.length)throw Error(`Missing sound metadata: ${key}`);
    return [key,{source:event.source,volume:event.volume,pitch:event.pitch,distanceCurve:event.distanceCurve}];
  })),
  note:'Native static sound fields; broadcast_distance_override is radar broadcasting metadata, not the audible cutoff. Browser panning/occlusion and interpolation are approximations.'};
fs.writeFileSync('src/range/awareness-native-audio.json',JSON.stringify(reference,null,2)+'\n');
console.log(JSON.stringify({build,sourceSha256:reference.sourceSha256,url,rangeUnits:jump.distanceCurve.at(-1)[0]}));
