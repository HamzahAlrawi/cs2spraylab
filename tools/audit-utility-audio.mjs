import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

// Fresh static resource hashes, not a regeneration of pinned arithmetic fixtures.
const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve(process.env.SOURCE2VIEWER || '.local-tools/vrf-20.1/Source2Viewer-CLI.exe');
const vpk = `${game}/game/csgo/pak01_dir.vpk`;
const timing = JSON.parse(fs.readFileSync('src/range/duel/utility-presentation-native.json'));
const manifest = JSON.parse(fs.readFileSync('public/revamp/audio/events.json'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const steamBytes = fs.readFileSync(`${game}/game/csgo/steam.inf`);
const build = steamBytes.toString().match(/ClientVersion=(\d+)/)?.[1];
if (!build) throw new Error('Missing installed build');
fs.mkdirSync('research/utility-presentation', {recursive: true});
const temporary = fs.mkdtempSync(path.resolve('research/utility-presentation/audio-audit-'));
const resources = new Map();
for (const utility of Object.values(timing.utilities)) {
  resources.set(utility.graph, utility.graphSha256);
  for (const action of Object.values(utility.actions)) resources.set(action.resource, action.sha256);
}
try {
  const checked = [];
  for (const [source, previousSha256] of resources) {
    const output = path.join(temporary, `${checked.length}.resource`);
    execFileSync(cli, ['-i', vpk, '-f', source, '-o', output], {windowsHide: true, stdio:'pipe', timeout:60000});
    const sha256 = hash(fs.readFileSync(output));
    checked.push({source, sha256, previousSha256, unchanged: sha256 === previousSha256});
  }
  const cues = [...new Set(Object.values(timing.utilities).flatMap(u=>Object.values(u.actions)
    .flatMap(a=>a.events.filter(e=>e.type.endsWith('_Sound')&&e.name).map(e=>e.name))))];
  const sounds = Object.entries(manifest.events).filter(([key])=>key.startsWith('utility-'));
  const summary = {build, steamInfSha256:hash(steamBytes), timingInventoryBuild:timing.build,
    clientSha256:hash(fs.readFileSync(`${game}/game/csgo/bin/win64/client.dll`)),
    serverSha256:hash(fs.readFileSync(`${game}/game/csgo/bin/win64/server.dll`)),
    archiveDirectorySha256:hash(fs.readFileSync(vpk)),
    weaponsResourceSha256:manifest.utilityAudio.eventSourceSha256,
    extractionToolSha256:hash(fs.readFileSync(cli)), checked,
    missingPresentationCues:cues.filter(name=>!sounds.some(([,event])=>event.source?.toLowerCase()===name.toLowerCase())),
    authoredCueCount:cues.length, utilityEventCount:sounds.length,
    samples:manifest.utilityAudio.uniqueSamples, bytes:manifest.utilityAudio.outputBytes,
    scope:'Only static resources freshly hashed; matching clips do not certify a complete current gameplay state machine.'};
  if (!fs.readFileSync(`${game}/game/csgo/steam.inf`).equals(steamBytes)) throw new Error('Build changed during audit');
  fs.writeFileSync('research/utility-presentation/audio-audit.json', JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({...summary,checked:undefined,unchanged:checked.filter(r=>r.unchanged).length,
    changed:checked.filter(r=>!r.unchanged)},null,2));
} finally {
  const resolved=fs.realpathSync(temporary), parent=fs.realpathSync('research/utility-presentation');
  if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('audio-audit-')) throw new Error('Unsafe audit cleanup');
  fs.rmSync(resolved,{recursive:true,force:true});
}
