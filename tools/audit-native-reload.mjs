import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';
import {selectViewClips, firearmViewIds} from './native-view-clips.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve(process.env.VRF_PATH || ['vrf-20.1','vrf-dev','vrf']
  .map(folder=>`.local-tools/${folder}/Source2Viewer-CLI.exe`).find(file=>fs.existsSync(file)) || '.local-tools/vrf/Source2Viewer-CLI.exe');
const root = process.argv.includes('--refresh') ? fs.mkdtempSync('research/reload-fresh-') : 'research/reload-timing-audit';
const vpk = `${game}/game/csgo/pak01_dir.vpk`;
const run = args => execFileSync(cli, ['-i', vpk, ...args], {encoding:'utf8', maxBuffer:80e6});
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1];
const archiveDirSha256 = sha256(fs.readFileSync(vpk));
const rows = [...run(['-l', '-f', 'animation/anims/viewmodel/', '-e', 'vnmclip_c'])
  .matchAll(/^(\S+\.vnmclip_c) CRC:(\w+) size:(\d+)/gm)];
const selected = Object.fromEntries(firearmViewIds.filter(id => id !== 'zeus').map(id =>
  [id, Object.fromEntries(Object.entries(selectViewClips(id, rows.map(row => row[1])))
    .filter(([name]) => name.startsWith('reload')))]));
const graphs = Object.fromEntries(Object.keys(selected).map(id => {
  const special = {cz75a:'viewmodel_gun_cz75', elite:'viewmodel_gun_elites', revolver:'viewmodel_gun_revolver'};
  const suffix = {sg553:'sg556', fiveseven:'five_seven'}[id] ?? id;
  return [id, `animation/graphs/viewmodel/${special[id] ?? `viewmodel_gun.vnmgraph+${suffix}`}.vnmgraph_c`];
}));
const files = [...new Set(Object.values(selected).flatMap(Object.values))];
if (process.argv.includes('--refresh')) {
  fs.mkdirSync(root, {recursive:true});
  run(['-f', 'scripts/weapons.vdata_c', '-d', '-o', `${root}/weapons.vdata`]);
  run(['-f', files.join(','), '-o', `${root}/compiled`]);
  run(['-f', files.join(','), '-d', '-o', `${root}/definitions`]);
  run(['-f', Object.values(graphs).join(','), '-d', '-o', `${root}/graphs`]);
  fs.writeFileSync(`${root}/source.json`, JSON.stringify({build, archiveDirSha256}));
}
assert.deepEqual(JSON.parse(fs.readFileSync(`${root}/source.json`)), {build, archiveDirSha256},
  'Cached exports are from a different archive; run --refresh');
const rawStats = fs.readFileSync(`${root}/weapons.vdata`, 'utf8');
const stats = parseKv3(rawStats);
const inventory = JSON.parse(fs.readFileSync('docs/weapon-animation-inventory.json')).weapons;
const aliases = {m4a4:'m4a1', m4a1s:'m4a1_silencer', galil:'galilar', sg553:'sg556', usp:'usp_silencer'};
const visit = (value, callback) => {
  if (!value || typeof value !== 'object') return;
  callback(value); Object.values(value).forEach(child => visit(child, callback));
};
const weapons = {};
for (const [id, clips] of Object.entries(selected)) {
  const source = stats[`weapon_${aliases[id] ?? id}`];
  const rawGraph = fs.readFileSync(`${root}/graphs/${graphs[id].replace(/_c$/, '')}`, 'utf8');
  const graph = parseKv3(rawGraph), graphNodes = [];
  visit(graph, node => {
    if (node._class === 'CNmGraphDocClipNode' && /reload/i.test(node.m_pDefaultVariationData?.m_clip ?? ''))
      graphNodes.push({name:node.m_name, clip:`${node.m_pDefaultVariationData.m_clip}_c`,
        speed:node.m_pDefaultVariationData.m_flSpeedMultiplier});
  });
  const actions = {};
  for (const [name, resource] of Object.entries(clips)) {
    const compiled = `${root}/compiled/${resource}`;
    const raw = execFileSync(cli, ['-i', compiled, '-b', 'DATA'], {encoding:'utf8', maxBuffer:30e6});
    // Pose blobs are irrelevant here; parse all timing/event fields structurally.
    const data = parseKv3(raw.slice(raw.indexOf('<!-- kv3')).replace(/#\[[\s\S]*?\]/g, '[]'));
    const definition = parseKv3(fs.readFileSync(`${root}/definitions/${resource.replace(/_c$/, '')}`, 'utf8'));
    const docEvents = definition.m_eventTracks.flatMap(track => track.m_events);
    const fps = Math.round((data.m_nNumFrames - 1) / data.m_flDuration);
    const seconds = (data.m_nNumFrames - 1) / fps;
    assert(Math.abs(data.m_flDuration - seconds) < .0001, `${id}/${name}: unsupported sample rate`);
    const events = data.m_events.filter(event => event._class === 'CNmIDEvent').map(event => {
      const frame = event.m_flStartTime.m_flValue * (data.m_nNumFrames - 1);
      const authored = docEvents.find(item => item.m_ID === event.m_ID && Math.abs(item.m_flStartTime - frame) < .002);
      assert(authored, `${id}/${name}: compiled event missing in definition: ${event.m_ID}`);
      return {id:event.m_ID, frame:authored.m_flStartTime, durationFrames:authored.m_flDuration,
        at:authored.m_flStartTime / fps, duration:authored.m_flDuration / fps,
        normalized:event.m_flStartTime.m_flValue};
    });
    const exported = inventory[id]?.clips[name];
    const referenced = graphNodes.filter(node => node.clip === resource);
    actions[name] = {path:resource, compiledSha256:sha256(fs.readFileSync(compiled)),
      seconds, fps, frames:data.m_nNumFrames, events, graphNodes:referenced,
      exportedSeconds:exported?.seconds ?? null, exportedBuild:inventory[id]?.build ?? null};
  }
  const attackLock = source.m_flDisallowAttackAfterReloadStartDuration;
  assert(Number.isFinite(attackLock) && attackLock > 0, `${id}: invalid attack lock`);
  for (const [name, clip] of Object.entries(actions)) {
    const ammo = clip.events.filter(event => event.id === 'WPN_RELOAD_ADD_AMMO');
    assert.equal(ammo.length, 1, `${id}/${name}: ambiguous ammo marker`);
    assert(ammo[0].at >= 0 && ammo[0].at <= clip.seconds, `${id}/${name}: invalid ammo marker`);
    if (!source.m_bReloadsSingleShells) assert(ammo[0].at <= attackLock, `${id}/${name}: ammo after attack gate`);
  }
  weapons[id] = {attackLock, singleShells:source.m_bReloadsSingleShells ?? false,
    graph:graphs[id], graphSha256:sha256(rawGraph), actions};
  console.log(`${id}: gate ${attackLock}; ${Object.entries(actions).map(([name, clip]) =>
    `${name} end ${clip.seconds.toFixed(6)}, ammo ${clip.events.filter(e => e.id === 'WPN_RELOAD_ADD_AMMO').map(e => e.at.toFixed(6))}, graph ${clip.graphNodes.length ? 'referenced' : 'NOT referenced'}`).join('; ')}`);
}
const fixture = {schema:1, build, archiveDirSha256, source:'scripts/weapons.vdata_c; compiled viewmodel reload clips and decompiled graph references',
  statsSha256:sha256(rawStats), limitations:[
    'Static authored events and attack-lock data, not live engine timing measurements.',
    'Graph references/rates are audited, not a full graph interpreter; silent rate/hold behavior remains a trainer estimate.',
    'An unexported or graph-unreferenced clip is evidence only, not an instruction to fabricate playback.'
  ], weapons};
const runtime = {};
for (const [id, weapon] of Object.entries(weapons)) {
  const marker = clip => {
    if (!clip?.graphNodes.length || clip.graphNodes.some(node => node.speed !== 1)) return undefined;
    return {ammoAt:clip.events.find(event => event.id === 'WPN_RELOAD_ADD_AMMO').at, animationEnd:clip.seconds};
  };
  const reload = marker(weapon.actions.reload), empty = marker(weapon.actions['reload-empty']);
  if (reload) runtime[id] = {attackLock:weapon.attackLock, singleShells:weapon.singleShells, reload, ...(empty ? {empty} : {})};
}
const reportAt=process.argv.indexOf('--report');
if(reportAt>=0) {
  const reportPath=process.argv[reportAt+1];if(!reportPath)throw new Error('Missing report path');
  fs.writeFileSync(reportPath,JSON.stringify({fixture,runtime},null,2));
}
for (const [target, data] of Object.entries({
  'src/range/native-reload-timing.json':fixture,
  'src/range/native-reload-runtime.json':runtime,
})) {
  if (process.argv.includes('--write')) fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
  else if(reportAt<0)assert.deepEqual(JSON.parse(fs.readFileSync(target)), data, `${target} changed; inspect before --write`);
}
console.log(`Verified ${Object.keys(weapons).length} weapons against installed build ${build}; vdata SHA256 ${fixture.statsSha256}`);
