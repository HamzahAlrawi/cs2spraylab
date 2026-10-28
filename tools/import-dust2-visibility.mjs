import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';
import {NativeVisibility} from '../src/range/prefire/native-visibility.mjs';

export function importVisibility(cli, vpk, work, out, refresh) {
  const file = `${work}/world_visibility.vvis_c`;
  if (refresh || !fs.existsSync(file)) execFileSync(cli, ['-i', vpk, '-f', 'maps/de_dust2/world_visibility.vvis_c', '-o', file], {stdio: 'ignore'});
  const text = execFileSync(cli, ['-i', file, '-b', 'DATA'], {encoding: 'utf8', maxBuffer: 1e6});
  const metadata = parseKv3(text.slice(text.indexOf('<!-- kv3')));
  const resource = fs.readFileSync(file), table = 8 + resource.readUInt32LE(8), count = resource.readUInt32LE(12);
  let bytes;
  for (let i = 0; i < count; i++) {
    const entry = table + i * 12;
    if (resource.toString('ascii', entry, entry + 4) === 'VXVS') {
      const offset = entry + 4 + resource.readUInt32LE(entry + 4);
      bytes = resource.subarray(offset, offset + resource.readUInt32LE(entry + 8));
    }
  }
  if (!bytes) throw new Error('Dust 2 has no native VXVS visibility block.');
  const visibility = new NativeVisibility(metadata, bytes);
  fs.writeFileSync(`${out}/visibility.json`, JSON.stringify(metadata));
  fs.writeFileSync(`${out}/visibility.bin`, bytes);
  return visibility;
}
