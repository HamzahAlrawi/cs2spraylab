import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parseKv3} from '../../tools/kv3.mjs';
import {selectViewClips,firearmViewIds} from '../../tools/native-view-clips.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
const root = 'research/fire-animation-audit';
const vpk = `${game}/game/csgo/pak01_dir.vpk`;
const run = args => execFileSync(cli,['-i',vpk,...args],{encoding:'utf8',maxBuffer:50e6});
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const listing = run(['-l','-f','animation/anims/viewmodel/','-e','vnmclip_c']);
const rows = [...listing.matchAll(/^(\S+\.vnmclip_c) CRC:(\w+) size:(\d+)/gm)];
const files = rows.map(row => row[1]);
const selected = Object.fromEntries(firearmViewIds.map(id => [id,selectViewClips(id,files)]));
const graphs = Object.fromEntries(firearmViewIds.map(id => {
  const special = {cz75a:'viewmodel_gun_cz75',elite:'viewmodel_gun_elites',revolver:'viewmodel_gun_revolver'};
  const suffix = {galil:'galil',sg553:'sg556',fiveseven:'five_seven'}[id] ?? id;
  return [id,`animation/graphs/viewmodel/${special[id] ?? `viewmodel_gun.vnmgraph+${suffix}`}.vnmgraph_c`];
}));
const fires = [...new Set(Object.values(selected).flatMap(clips => Object.entries(clips)
  .filter(([name]) => name.startsWith('fire')).map(([,file]) => file)))];
if (process.argv.includes('--refresh')) {
  fs.mkdirSync(root,{recursive:true});
  run(['-f',Object.values(graphs).join(','),'-o',`${root}/graphs`,'-d']);
  run(['-f',fires.join(','),'-o',`${root}/compiled`]);
}
const graphClips = new Map();
const graphHashes = new Map();
for (const resource of Object.values(graphs)) {
  const file = `${root}/graphs/${resource.replace(/_c$/,'')}`;
  const bytes = fs.readFileSync(file);
  const graph = parseKv3(bytes.toString('utf8'));
  const clips = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.m_clip) clips.add(`${value.m_clip}_c`);
    Object.values(value).forEach(visit);
  }
  visit(graph); graphClips.set(resource,clips); graphHashes.set(resource,hash(bytes));
}
const native = {};
for (const file of fires) {
  const raw = execFileSync(cli,['-i',`${root}/compiled/${file}`,'-b','DATA'],{encoding:'utf8',maxBuffer:20e6});
  const clip = parseKv3(raw.slice(raw.indexOf('<!-- kv3')));
  const row = rows.find(row => row[1] === file);
  native[file] = {path:file,crc:row[2],bytes:Number(row[3]),sha256:hash(fs.readFileSync(`${root}/compiled/${file}`)),
    seconds:clip.m_flDuration,frames:clip.m_nNumFrames,additive:clip.m_bIsAdditive,
    skeleton:clip.m_skeleton,secondary:clip.m_secondaryAnimations.map(animation => animation.m_skeleton)};
}
const inventory = JSON.parse(fs.readFileSync('docs/weapon-animation-inventory.json')).weapons;
const legacy = [...new Set(JSON.parse(fs.readFileSync('src/range/cosmetics-data.json')).cosmetics
  .map(item => item.assetKey).filter(key => key?.endsWith('-legacy')))];
const weapons = {};
for (const id of firearmViewIds) {
  const graph = graphs[id];
  const clips = Object.fromEntries(Object.entries(selected[id]).filter(([name]) => name.startsWith('fire')));
  for (const file of Object.values(clips)) assert.ok(graphClips.get(graph).has(file),`${id}: clip not referenced by native graph: ${file}`);
  weapons[id] = {graph,graphSha256:graphHashes.get(graph),clips,
    scopedFire:clips['fire-scoped'] ?? null,lastShot:clips['fire-last'] ?? null,
    emptyIdle:selected[id]['idle-empty'] ?? null,
    silenced:['m4a1s','usp','mp5sd'].includes(id) ? 'native primary clip; no separate silenced shoot resource' : null,
    exports:[id,...legacy.filter(key => key === `${id}-legacy`)].map(key => ({assetKey:key,
      path:`public/revamp/models/view-${key}.glb`,sha256:inventory[key].sha256,bytes:inventory[key].bytes}))};
}
const audit = {schema:1,build:fs.readFileSync(`${game}/game/csgo/steam.inf`,'utf8').match(/ClientVersion=(\d+)/)[1],
  scope:'Static local VPK resources only; no game process, memory, hooks or automation.',
  source: 'pak01_dir.vpk; Source2Viewer-CLI; background Blender; existing glTF Transform optimization',
  sourceClipCount:fires.length,assemblyCount:firearmViewIds.length + legacy.length,weapons,native};
fs.writeFileSync('docs/native-fire-animation-audit.json',JSON.stringify(audit,null,2) + '\n');
console.log(`Audited ${firearmViewIds.length} firearms, ${fires.length} native firing clips, ${audit.assemblyCount} assemblies; build ${audit.build}`);
