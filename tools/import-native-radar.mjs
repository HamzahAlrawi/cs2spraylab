import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {parseKeyValues} from './cosmetic-keyvalues.mjs';
import {nativeMapIdentity} from './native-map-identity.mjs';

const identity=nativeMapIdentity(process.argv[2]??'de_dust2');

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf-20.1/Source2Viewer-CLI.exe');
const vpk = `${game}/game/csgo/pak01_dir.vpk`, root = `${identity.work}/radar`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(root, {recursive: true});
const extract = (resource, output, decode = false) => execFileSync(cli,
  ['-i', vpk, '-f', resource, ...(decode ? ['-d'] : []), '-o', `${root}/${output}`], {windowsHide: true, stdio: 'pipe'});
const description = `resource/overviews/${identity.mapId}.txt`;
const texture = `panorama/images/overheadmaps/${identity.mapId}_radar_psd.vtex_c`;
extract(description, 'overview.txt'); extract(texture, 'source.vtex_c'); extract(texture, 'radar.png', true);
const fields = parseKeyValues(fs.readFileSync(`${root}/overview.txt`, 'utf8'))[identity.mapId];
const metadata = Object.fromEntries(['pos_x', 'pos_y', 'scale'].map(key => [key, Number(fields[key])]));
if (Object.values(metadata).some(v => !Number.isFinite(v)) || metadata.scale <= 0) throw Error('Invalid native overview metadata');
const bytes = await sharp(`${root}/radar.png`).webp({lossless: true}).toBuffer(), sha256 = hash(bytes);
const url = `/maps/${identity.assetId}/duel/objects/${sha256}.bin`;
fs.mkdirSync(path.dirname(`public/revamp${url}`), {recursive: true}); fs.writeFileSync(`public/revamp${url}`, bytes);
const manifest = {version: 1, map: identity.assetId, build: fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)?.[1],
  archiveDirectorySha256: hash(fs.readFileSync(vpk)), viewerSha256: hash(fs.readFileSync(cli)),
  description, descriptionSha256: hash(fs.readFileSync(`${root}/overview.txt`)), texture, textureSha256: hash(fs.readFileSync(`${root}/source.vtex_c`)),
  metadata, delivery: {url, bytes: bytes.length, sha256, decodedBytes: bytes.length, decodedSha256: sha256, encoding: 'identity'}};
fs.writeFileSync(identity.assetId==='dust2'?'src/range/duel/native-radar.json':`src/range/prefire/maps/${identity.assetId}-radar.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({build: manifest.build, bytes: bytes.length, metadata, sha256}));
