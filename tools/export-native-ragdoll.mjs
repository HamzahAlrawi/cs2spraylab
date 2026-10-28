import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const model = 'agents/models/ctm_sas/ctm_sas.vmdl_c';
const dump = execFileSync('.local-tools/vrf/Source2Viewer-CLI.exe',
  ['-i', `${game}/game/csgo/pak01_dir.vpk`, '-f', model, '-b', 'PHYS'],
  {encoding: 'utf8', windowsHide: true, maxBuffer: 20e6});
const physics = parseKv3(dump.slice(dump.indexOf('<!-- kv3')));
if (physics.m_parts.length !== 15 || physics.m_joints.length !== 14) throw new Error('Unexpected native ragdoll topology');
const name = value => value.replace(/_([lr])$/, (_, side) => `_${side.toUpperCase()}`);
const data = {
  source: {model, build: fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)?.[1],
    sha256: crypto.createHash('sha256').update(dump).digest('hex'), unit: .0254},
  bodies: physics.m_parts.map((part, i) => ({name: name(physics.m_boneNames[i]), mass: part.m_flMass,
    angularDamping: part.m_flAngularDamping, inertiaScale: part.m_flInertiaScale,
    shapes: [...part.m_rnShape.m_capsules.map(s => ({a: s.m_Capsule.m_vCenter[0], b: s.m_Capsule.m_vCenter[1], radius: s.m_Capsule.m_flRadius})),
      ...part.m_rnShape.m_spheres.map(s => ({a: s.m_Sphere.m_vCenter, b: s.m_Sphere.m_vCenter, radius: s.m_Sphere.m_flRadius}))]})),
  joints: physics.m_joints.map(j => ({a: j.m_nBody1, b: j.m_nBody2, frameA: j.m_Frame1, frameB: j.m_Frame2,
    swing: j.m_SwingLimit.m_flMax, twist: [j.m_TwistLimit.m_flMin, j.m_TwistLimit.m_flMax]})),
};
fs.writeFileSync('src/range/duel/native-ragdoll.json', JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify({source: data.source, bodies: data.bodies.length, joints: data.joints.length}));
