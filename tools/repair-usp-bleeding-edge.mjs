import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {parseKv3} from './kv3.mjs';
import {nativePaintInputs, isMissingTexturePixels} from './cosmetic-paint.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf-20.1/Source2Viewer-CLI.exe');
const archive = `${game}/game/csgo/pak01_dir.vpk`, work = 'research/usp-bleeding-edge';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(work, {recursive: true});
const run = args => execFileSync(cli, ['-i', archive, ...args], {windowsHide: true, stdio: 'pipe', maxBuffer: 20e6});
const materialSource = 'weapons/paints/timed_drops/ht_red_edges.vcompmat_c';
run(['-f', materialSource, '-o', `${work}/material.vcompmat_c`]);
run(['-f', materialSource, '-d', '-o', `${work}/material.vcompmat`]);
const material = fs.readFileSync(`${work}/material.vcompmat`), inputs = nativePaintInputs(parseKv3(material.toString()));
if (!inputs.paintByNumberTexture) throw Error('Native paint-by-number selection changed');
run(['-f', `${inputs.paintByNumberTexture}_c`, '-o', `${work}/paint-mask.vtex_c`]);
run(['-f', `${inputs.paintByNumberTexture}_c`, '-d', '-o', `${work}/paint-mask.png`]);
const mask = sharp(`${work}/paint-mask.png`).resize(1024, 1024, {fit: 'fill'}).ensureAlpha();
if (isMissingTexturePixels(await mask.clone().raw().toBuffer())) throw Error('Native mask is a missing-texture sentinel');
const bytes = await mask.webp({lossless: true}).toBuffer(), sha256 = hash(bytes);
const url = `/finish-repairs/usp-bleeding-edge-mask-${sha256.slice(0, 12)}.webp`;
fs.mkdirSync('public/revamp/finish-repairs', {recursive: true}); fs.writeFileSync(`public/revamp${url}`, bytes);
const file = 'src/range/cosmetics-data.json', data = JSON.parse(fs.readFileSync(file)), id = 'usp-ht_red_edges';
const row = data.cosmetics.find(x => x.id === id);
if (!row || row.kitId !== '1323' || row.assetKey !== 'usp') throw Error('Unexpected existing finish identity');
const before = {...row}, build = fs.readFileSync(`${game}/game/csgo/steam.inf`, 'utf8').match(/ClientVersion=(\d+)/)[1];
Object.assign(row, {map: null, colors: inputs.colors, paintByNumberMap: url,
  sourceBuild: build, sourceSha256: hash(material),
  rendering: 'native UV paint-by-number mask and four-color palette; stock normal/detail retained, simplified compositor'});
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const audit = {id, build, archiveDirectorySha256: hash(fs.readFileSync(archive)), viewerSha256: hash(fs.readFileSync(cli)),
  materialSource, materialCompiledSha256: hash(fs.readFileSync(`${work}/material.vcompmat_c`)), materialSha256: hash(material),
  selectedBy: ['g_bUsePaintByNumberMasks=true', 'g_bOverrideDefaultMasks=true', 'g_tPaintByNumberMasks -> g_tMasks'],
  maskSource: `${inputs.paintByNumberTexture}_c`, maskCompiledSha256: hash(fs.readFileSync(`${work}/paint-mask.vtex_c`)),
  url, sha256, bytes: bytes.length, colors: inputs.colors,
  preserved: {id: before.id, price: before.price, unlockLevel: before.unlockLevel, assetKey: before.assetKey, imageUrl: before.imageUrl},
  limitation: 'Native inputs, not the full CS2 halftone/wear/seed material compositor. Other catalog rows retain their original source build.'};
fs.writeFileSync('docs/usp-bleeding-edge-audit.json', JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify({id, build, bytes: bytes.length, url, colors: inputs.colors}));
