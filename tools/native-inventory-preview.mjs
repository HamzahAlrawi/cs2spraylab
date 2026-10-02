import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';

const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Offline conversion of Valve's authored inventory image, not a model render. */
export async function importInventoryPreview({id, resource, cli, vpk, work}) {
  const output = `public/revamp/textures/cosmetics/${id}-preview.webp`;
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.mkdirSync(work, {recursive: true});
  const packed = `${work}/${id}-inventory.vtex_c`, image = `${work}/${id}-inventory.png`;
  const run = args => execFileSync(cli, ['-i', vpk, ...args], {stdio: 'pipe', maxBuffer: 10e6});
  run(['-f', resource, '-o', packed]);
  if (!fs.existsSync(packed)) throw new Error(`Missing native inventory image: ${resource}`);
  run(['-f', resource, '-d', '-o', image]);
  await sharp(image).resize(384, 384, {fit: 'inside', withoutEnlargement: true}).webp({quality: 90}).toFile(output);
  return {imageUrl: `/textures/cosmetics/${id}-preview.webp`, imageSource: resource,
    imageSourceSha256: hash(packed), imageSha256: hash(output)};
}
