import path from 'node:path';
import {execFileSync} from 'node:child_process';
const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const names = ['ak', 'm4a4', 'rifle', 'galilar', 'famas', 'sg556', 'aug', 'mp9', 'mp7', 'mp5sd',
  'mac10', 'ump45', 'p90', 'bizon', 'm249', 'negev', 'cz75a', 'pistol'];
execFileSync(path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe'), ['-i', `${game}/game/csgo/pak01_dir.vpk`,
  '-f', 'agents/models/ctm_sas/ctm_sas.vmdl_c', '-o', 'research/raw-models/reload-arms.glb', '-d',
  '--gltf_export_format', 'glb', '--gltf_export_materials', '--gltf_textures_adapt', '--gltf_export_animations',
  '--gltf_compose_additive', '--gltf_animation_list', names.flatMap(n => [n === 'm249' ? 'idle1_m249' : `idle_${n}`, `reload_${n}`]).join(',')],
{stdio: 'pipe', maxBuffer: 30e6});
execFileSync(process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  ['--background', '--factory-startup', '--python', 'art/build_reload.py'], {stdio: 'inherit'});
