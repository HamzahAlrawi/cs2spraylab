import { execFileSync } from 'node:child_process';
for (const args of [
  ['tools/import-game.mjs'],
  ['tools/blender-command.mjs', 'art/build_native.py'],
  ['tools/blender-command.mjs', 'art/build_range.py'],
  ['tools/optimize-assets.mjs'],
  ['tools/blender-command.mjs', 'art/render_target_preview.py'],
  ['tools/check-assets.mjs']
]) execFileSync(process.execPath, args, { stdio: 'inherit' });
