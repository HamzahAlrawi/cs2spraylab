import {createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign} from 'node:crypto';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privatePath = resolve(root, '.local-tools/gifts/issuer-private-key.pem');
const publicPath = resolve(root, 'src/range/gift-public-keys.json');
const aliasesPath = resolve(root, 'src/range/gift-code-aliases.json');
const [command, ...args] = process.argv.slice(2);
const option = name => {const index = args.indexOf(`--${name}`); return index < 0 ? undefined : args[index + 1];};
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
function issuer() {
  if (!existsSync(privatePath)) throw new Error('Run node tools/gift-codes.mjs init first. Back up the private key; never publish it.');
  const key = createPrivateKey(readFileSync(privatePath));
  const pub = createPublicKey(key);
  const kid = createHash('sha256').update(pub.export({type: 'spki', format: 'der'})).digest('hex').slice(0, 16);
  return {key, pub, kid};
}
function numberOption(name, fallback, min, max, integer = true) {
  const raw = option(name), value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new Error(`Invalid --${name}`);
  return value;
}
try {
  if (command === 'init') {
    if (!existsSync(privatePath)) {
      mkdirSync(dirname(privatePath), {recursive: true});
      const pair = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
      writeFileSync(privatePath, pair.privateKey.export({type: 'pkcs8', format: 'pem'}), {flag: 'wx', mode: 0o600});
    }
    const {pub, kid} = issuer(), registry = json(publicPath);
    registry.keys[kid] = pub.export({format: 'jwk'}); writeJson(publicPath, registry);
    console.log(`Public issuer ${kid} registered. Keep ${privatePath} private and backed up. Deploy the public registry before issuing codes.`);
  } else if (command === 'issue') {
    const {key, kid} = issuer();
    if (!json(publicPath).keys[kid]) throw new Error('Issuer is not registered; run init and deploy the public registry.');
    const level = option('level');
    const reward = level !== undefined ? {kind: 'restore-level', level: numberOption('level', 50, 2, 100), duelShare: numberOption('duel-share', .8, 0, 1, false)} :
      {kind: 'grant', xp: numberOption('xp', 0, 0, 100_000_000), credits: numberOption('credits', 0, 0, 100_000_000)};
    if (reward.kind === 'grant' && !reward.xp && !reward.credits) throw new Error('Specify --xp, --credits or --level.');
    const id = option('id') ?? randomUUID(), label = option('label') ?? (level ? `Level ${reward.level} recovery gift` : 'SprayLab gift');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id) || !label.trim() || label.length > 120) throw new Error('Invalid id or label.');
    const payload = {v: 1, kid, id, label, reward};
    if (option('expires')) {payload.expiresAt = Date.parse(option('expires')); if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= Date.now()) throw new Error('Expiry must be a future ISO date.');}
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url'), signed = `SLG1.${body}`;
    const token = `${signed}.${sign('sha256', Buffer.from(signed), {key, dsaEncoding: 'ieee-p1363'}).toString('base64url')}`;
    let code = token;
    let aliasRegistry;
    if (args.includes('--short')) {
      code = `SPRAYLAB-${level ? `L${reward.level}` : 'GIFT'}-${randomBytes(8).toString('hex').toUpperCase()}`;
      const registry = json(aliasesPath), hash = createHash('sha256').update(code).digest('hex');
      registry.codes[hash] = token; aliasRegistry = registry;
      console.log('Short alias added. Build and deploy the alias registry before sharing this short code. The signed code works without another registry update.');
    }
    const out = resolve(root, option('out') ?? `.local-tools/gifts/${id}.txt`);
    mkdirSync(dirname(out), {recursive: true});
    writeFileSync(out, `${label}\n\nCode: ${code}\n\nSigned code: ${token}\n\nReward: ${JSON.stringify(reward)}\nOne redemption per local profile. This is not an account-bound or globally single-use voucher.\n`, {flag: 'wx'});
    if (aliasRegistry) writeJson(aliasesPath, aliasRegistry);
    console.log(`Code: ${code}\nSaved to ${out}`);
  } else throw new Error('Usage: node tools/gift-codes.mjs init | issue [--xp N --credits N | --level 50 --duel-share .8] [--short] [--out PATH]');
} catch (error) {console.error(error.message); process.exitCode = 1;}
