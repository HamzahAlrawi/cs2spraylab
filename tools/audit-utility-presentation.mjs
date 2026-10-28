import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve(process.env.SOURCE2VIEWER || '.local-tools/vrf-20.1/Source2Viewer-CLI.exe');
const vpk = `${game}/game/csgo/pak01_dir.vpk`, root = 'research/utility-presentation/audit';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const run = args => execFileSync(cli, args, {encoding: 'utf8', windowsHide: true, maxBuffer: 80e6});
const extract = (resource, folder, decode = false) => {
  const output = `${root}/${folder}/${resource.replace(decode ? /_c$/ : /$/, '')}`;
  if (!fs.existsSync(output) || process.argv.includes('--refresh'))
    run(['-i', vpk, '-f', resource, ...(decode ? ['-d'] : []), '-o', output]);
  return output;
};
const visit = (node, callback) => {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node)) callback(node);
  Object.values(node).forEach(child => visit(child, callback));
};
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1];
const models = JSON.parse(fs.readFileSync('src/range/duel/utility-models.json'));
const utilities = {};
const vdataResource = 'scripts/weapons.vdata_c';
const vdataRaw = fs.readFileSync(extract(vdataResource, 'stats', true), 'utf8'), vdata = parseKv3(vdataRaw);
const weaponIds = {he: 'hegrenade', flash: 'flashbang', smoke: 'smokegrenade', molotov: 'molotov', incendiary: 'incgrenade', decoy: 'decoy'};
for (const [kind, model] of Object.entries(models.models)) {
  assert.equal(model.build, build, 'Re-extract models for the installed build first');
  const spec = JSON.parse(fs.readFileSync(`research/weapon-actions/utility-${kind}.json`));
  const graphResource = `animation/graphs/viewmodel/viewmodel_grenade.vnmgraph+${kind}.vnmgraph_c`;
  const graphRaw = fs.readFileSync(extract(graphResource, 'graphs', true), 'utf8');
  const graph = parseKv3(graphRaw), transitions = [], references = [], completions = [];
  visit(graph, node => {
    if (node._class?.endsWith('TransitionNode')) transitions.push({name: node.m_name,
      seconds: node.m_flDurationSeconds, target: node.m_stateID, easing: node.m_blendWeightEasing});
    if (['CNmGraphDocClipNode', 'CNmGraphDocAnimationPoseNode'].includes(node._class)) references.push({name: node.m_name,
      ...node.m_pDefaultVariationData, looping: node.m_bAllowLooping ?? false, fixedTime: node.m_fixedTimeValue ?? null});
    if (node.m_timedStateEvents?.length) {
      const clips = [];
      visit(node, child => {
        if (child._class === 'CNmGraphDocClipNode' && child.m_pDefaultVariationData?.m_clip)
          clips.push({resource: `${child.m_pDefaultVariationData.m_clip}_c`, speed: child.m_pDefaultVariationData.m_flSpeedMultiplier});
      });
      for (const event of node.m_timedStateEvents.filter(e => e.m_ID === 'WPN_ACTION_COMPLETE'))
        completions.push({state: node.m_name, stateId: node.m_ID, event: event.m_ID, type: event.m_type,
          comparison: event.m_comparisonOperator, remaining: event.m_flTimeValueSeconds, clips});
    }
  });
  const actions = {};
  for (const [name, resource] of Object.entries(spec.clips)) {
    const compiled = extract(resource, 'compiled');
    const raw = run(['-i', compiled, '-b', 'DATA']);
    const data = parseKv3(raw.slice(raw.indexOf('<!-- kv3')).replace(/#\[[\s\S]*?\]/g, '[]'));
    const definitionRaw = fs.readFileSync(extract(resource, 'definitions', true), 'utf8');
    const definition = parseKv3(definitionRaw);
    const frames = data.m_nNumFrames, seconds = data.m_flDuration;
    const fps = frames > 1 && seconds > 0 ? Math.round((frames - 1) / seconds) : 30;
    if (frames > 1) assert(Math.abs(seconds - (frames - 1) / fps) < .0001);
    const events = (definition.m_eventTracks ?? []).flatMap(track => track.m_events ?? []).map(event => {
      const native = (data.m_events ?? []).find(e => (e.m_name ?? e.m_ID) === (event.m_name ?? event.m_ID) &&
        Math.abs(e.m_flStartTime.m_flValue * Math.max(1, frames - 1) - event.m_flStartTime) < .51);
      assert(native, `${kind}/${name}: unverified event ${event.m_name ?? event.m_ID}`);
      return {type: event._class, name: event.m_name ?? event.m_ID, frame: event.m_flStartTime,
        at: native.m_flStartTime.m_flValue * Math.max(0, frames - 1) / fps,
        authoredAt: event.m_flStartTime / fps,
        duration: native.m_flDuration.m_flValue * Math.max(0, frames - 1) / fps,
        authoredDuration: event.m_flDuration / fps,
        normalized: native.m_flStartTime.m_flValue, position: event.m_position ?? null};
    });
    actions[name] = {resource, sha256: hash(fs.readFileSync(compiled)), definitionSha256: hash(definitionRaw),
      frames, fps, seconds: frames > 1 ? (frames - 1) / fps : 0, exportedSeconds: model.clips[name].seconds,
      pose: frames === 1, events, graphReferences: references.filter(r => r.m_clip === resource.replace(/_c$/, ''))};
  }
  for (const completion of completions) completion.actions = Object.entries(actions).flatMap(([action, clip]) => {
    const reference = completion.clips.find(c => c.resource === clip.resource);
    if (!reference || reference.speed !== 1 || completion.type !== 'TimeRemaining' || completion.comparison !== 'LessThanEqual') return [];
    return [{action, at: Math.max(0, clip.seconds - completion.remaining)}];
  });
  utilities[kind] = {graph: graphResource, graphSha256: hash(graphRaw), transitions, actions, completions,
    deployDuration: vdata[`weapon_${weaponIds[kind]}`].m_flDeployDuration};
  console.log(kind, Object.fromEntries(Object.entries(actions).map(([name, action]) => [name,
    {seconds: action.seconds, frames: action.frames, events: action.events.map(e => `${e.name}@${e.at}`)}])));
}
const fixture = {schema: 1, build, archiveDirectorySha256: hash(fs.readFileSync(vpk)), vdataResource, vdataSha256: hash(vdataRaw),
  source: 'Static compiled clips cross-checked against authored frame events and grenade graph variations.',
  limitations: ['Sound markers are not projectile-release ID events. Do not infer gameplay launch timing from sound.',
    'Graph transitions are audited data, not a full graph interpreter or live engine timing measurement.',
    'Single-frame clips are poses with zero authored duration, not missing animations.'], utilities};
fs.writeFileSync('src/range/duel/utility-presentation-native.json', JSON.stringify(fixture, null, 2) + '\n');
