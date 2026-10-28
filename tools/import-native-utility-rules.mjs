import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseKv3} from './kv3.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const utilityWeaponKeys = {he: 'weapon_hegrenade', flash: 'weapon_flashbang',
  smoke: 'weapon_smokegrenade', molotov: 'weapon_molotov', incendiary: 'weapon_incgrenade', decoy: 'weapon_decoy'};

// The same lexer handles quoted CFG arguments and KV1 keys without losing duplicate exec keys.
export function tokenizeValveText(text) {
  const tokens = [];
  let i = 0, line = 1;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {if (c === '\n') line++; i++; continue;}
    if (text.startsWith('//', i)) {while (i < text.length && text[i] !== '\n') i++; continue;}
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unclosed Valve comment');
      line += (text.slice(i, end + 2).match(/\n/g) ?? []).length; i = end + 2; continue;
    }
    const startLine = line;
    let value = '';
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\n') line++;
        if (text[i] === '\\' && ['"', '\\'].includes(text[i + 1])) i++;
        value += text[i++];
      }
      if (i === text.length) throw new Error('Unclosed Valve string');
      i++;
    } else if ('{};'.includes(c)) {value = c; i++;}
    else {
      while (i < text.length && !/\s/.test(text[i]) && !'{};'.includes(text[i]) && !text.startsWith('//', i))
        value += text[i++];
    }
    tokens.push({value, line: startLine, quoted: c === '"'});
  }
  return tokens;
}

export function parseUtilityCfg(text) {
  const commands = [], tokens = tokenizeValveText(text);
  let command = [];
  const flush = () => {
    if (command.length) commands.push({key: command[0].value, args: command.slice(1).map(t => t.value), line: command[0].line});
    command = [];
  };
  for (const token of tokens) {
    if (command.length && token.line !== command[0].line) flush();
    if (token.value === ';' && !token.quoted) flush(); else command.push(token);
  }
  flush();
  return commands;
}

export function parseValveKeyValues(text) {
  const tokens = tokenizeValveText(text);
  let i = 0;
  function entries(nested) {
    const result = [];
    while (i < tokens.length) {
      const key = tokens[i++];
      if (key.value === '}' && !key.quoted) {
        if (!nested) throw new Error('Unexpected KV1 closing brace');
        return result;
      }
      const value = tokens[i++];
      if (!value || value.value === '}' && !value.quoted) throw new Error(`Missing KV1 value for ${key.value}`);
      result.push({key: key.value, line: key.line,
        value: value.value === '{' && !value.quoted ? entries(true) : value.value});
    }
    if (nested) throw new Error('Unclosed KV1 block');
    return result;
  }
  return entries(false);
}

const utilityName = name => /(?:grenade|inferno|molotov|smoke|flashbang|decoy)/i.test(name) || name === 'sv_gravity';
const convarName = name => /^(?:inferno_|molotov_(?:throw_detonate_time|usethrow_direction)$|smoke_(?:param[1-5]|use_noise_texture|grenade_[ct]+_color)$|sv_(?:gravity$|grenade_|hegrenade_|smoke_volume_blind_start$)|ammo_grenade_|weapon_molotov_maxdetonateslope$)/i.test(name);
const eventNames = new Set(['inferno_expire', 'inferno_startburn', 'inferno_server', 'inferno_extinguish']);

export function scanUtilityConvarNames(bytes) {
  const found = [];
  for (const match of bytes.toString('latin1').matchAll(/[\x20-\x7e]{4,}\x00/g)) {
    const name = match[0].slice(0, -1);
    if (/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) && convarName(name) && !eventNames.has(name))
      found.push({name, fileOffset: `0x${match.index.toString(16)}`});
  }
  return found;
}

export function selectUtilityWeapons(vdata) {
  return Object.fromEntries(Object.entries(utilityWeaponKeys).map(([kind, key]) => {
    const fields = vdata[key];
    if (!fields || !Number.isFinite(fields.m_flThrowVelocity) || !Number.isFinite(fields.m_flDeployDuration))
      throw new Error(`Missing native throw/deploy fields for ${key}`);
    return [kind, {source: 'weapons', key, fields}];
  }));
}

export function importNativeUtilityRules({game = process.env.CS2_PATH ||
  'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive',
  cli = process.env.SOURCE2VIEWER || path.join(root, '.local-tools/vrf-20.1/Source2Viewer-CLI.exe'),
  check = false} = {}) {
  const evidenceRoot = path.join(root, 'research/utility-presentation/native-rules');
  const output = path.join(root, 'src/range/duel/native-utility-rules.json');
  const read = resource => fs.readFileSync(path.join(game, resource));
  const sources = {};
  const source = (id, resource, bytes, extra = {}) => {
    sources[id] = {path: resource, sha256: hash(bytes), bytes: bytes.length, ...extra};
    return bytes;
  };
  const run = args => execFileSync(cli, args, {encoding: 'utf8', windowsHide: true, maxBuffer: 80e6});
  const version = run(['--version']).split(/\r?\n/).find(line => line.startsWith('Version: '))?.slice(9);
  if (!version?.startsWith('20.1.')) throw new Error('Use the audited Source2Viewer 20.1 release');
  const steam = source('steam', 'game/csgo/steam.inf', read('game/csgo/steam.inf')).toString();
  const build = steam.match(/^ClientVersion=(\d+)/m)?.[1];
  if (build !== '2000935') throw new Error(`Expected build 2000935, found ${build}; audit a new build explicitly`);
  const archive = 'game/csgo/pak01_dir.vpk';
  source('archive', archive, read(archive));
  fs.mkdirSync(evidenceRoot, {recursive: true});
  function extract(id, resource, decode) {
    const compiled = path.join(evidenceRoot, resource);
    fs.mkdirSync(path.dirname(compiled), {recursive: true});
    // Always re-extract: existing research artifacts are never trusted as a cache.
    run(['-i', path.join(game, archive), '-f', resource, '-o', compiled]);
    const bytes = fs.readFileSync(compiled);
    source(id, resource, bytes, {archive: 'archive', extractedPath: path.relative(root, compiled).replaceAll('\\', '/')});
    if (!decode) return bytes.toString();
    const decoded = compiled.replace(/_c$/, '');
    run(['-i', path.join(game, archive), '-f', resource, '-d', '-o', decoded]);
    const text = fs.readFileSync(decoded);
    sources[id].decodedSha256 = hash(text);
    sources[id].decodedPath = path.relative(root, decoded).replaceAll('\\', '/');
    return text.toString();
  }
  const vdata = parseKv3(extract('weapons', 'scripts/weapons.vdata_c', true));
  const explosions = parseKv3(extract('explosions', 'scripts/explosion_types.vdata_c', true));
  const gameModes = parseValveKeyValues(extract('gameModes', 'gamemodes.txt', false));
  const modeExec = [];
  function visit(entries, scope = []) {
    for (const entry of entries) {
      if (Array.isArray(entry.value)) visit(entry.value, [...scope, entry.key]);
      else if (scope.at(-1) === 'exec' && ['exec', 'exec_offline'].includes(entry.key))
        modeExec.push({scope: scope.join('/'), key: entry.key, file: entry.value, line: entry.line});
    }
  }
  visit(gameModes);
  const configs = {};
  const cfgDir = path.join(game, 'game/csgo/cfg');
  const cfgNames = fs.readdirSync(cfgDir).filter(name => /^gamemode.*\.cfg$/.test(name) || ['server.cfg', 'server_default.cfg'].includes(name)).sort();
  for (const name of cfgNames) {
    const id = `cfg:${name}`, bytes = source(id, `game/csgo/cfg/${name}`, read(`game/csgo/cfg/${name}`));
    const target = path.join(evidenceRoot, 'cfg', name);
    fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, bytes);
    sources[id].extractedPath = path.relative(root, target).replaceAll('\\', '/');
    configs[name] = {source: id, assignments: parseUtilityCfg(bytes.toString()).filter(c => utilityName(c.key) || c.key === 'exec')};
  }
  const convars = {};
  const ensure = key => convars[key] ??= {engineDefault: null, engineDefaultStatus: 'not-extracted',
    nameEvidence: [], configOverrides: []};
  for (const [file, cfg] of Object.entries(configs)) for (const command of cfg.assignments) {
    if (command.key === 'exec') continue;
    ensure(command.key).configOverrides.push({file, source: cfg.source, ...command});
  }
  for (const [id, resource] of [['server', 'game/csgo/bin/win64/server.dll'], ['client', 'game/csgo/bin/win64/client.dll']]) {
    const bytes = source(id, resource, read(resource));
    for (const {name, fileOffset} of scanUtilityConvarNames(bytes))
      ensure(name).nameEvidence.push({source: id, fileOffset, kind: 'ascii-name-only'});
  }
  const gameInfoOverrides = [];
  for (const mount of ['core', 'csgo']) {
    const id = `gameinfo:${mount}`, resource = `game/${mount}/gameinfo.gi`;
    const text = source(id, resource, read(resource)).toString();
    function collect(entries, scope = []) {
      for (const entry of entries) {
        if (Array.isArray(entry.value)) collect(entry.value, [...scope, entry.key]);
        else if (scope.includes('ConVars') && utilityName(entry.key))
          gameInfoOverrides.push({source: id, scope: scope.join('/'), key: entry.key, value: entry.value, line: entry.line});
      }
    }
    collect(parseValveKeyValues(text));
  }
  const result = {schema: 1, build,
    extractor: {version, sha256: hash(fs.readFileSync(cli)), method: 'Static archive extraction and ASCII inventory; no game execution, DLL loading, process access or disassembly.'},
    sources, weapons: selectUtilityWeapons(vdata),
    vdataBases: {weapon_base: vdata.weapon_base, grenade: vdata.grenade},
    explosionTypes: {source: 'explosions', entries: Object.fromEntries(['grenade', 'molotov', 'smoke', 'flashbang'].map(key => [key, explosions[key]]))},
    configs, modeExec, gameInfoOverrides, convars: Object.fromEntries(Object.entries(convars).sort(([a], [b]) => a.localeCompare(b, 'en'))),
    unresolved: {
      engineDefaults: 'ASCII names do not establish registered types/defaults. Prior research/convars.txt is not a fresh build-pinned source and is not consumed.',
      throw: 'm_flThrowVelocity is a weapon-data input, not the final launch speed. Launch multiplier, strength curve, player-velocity inheritance, pitch transform, hand offset and release delay require native-code evidence.',
      detonation: 'HE/flash fuse, smoke/decoy rest threshold and check cadence, decoy duration, fire collision/detonation conditions and smoke lifetime are not exposed numerically in extracted vdata/CFG.',
      physics: 'Projectile gravity multiplier, hull, bounce restitution/friction, sleep speed and collision masks require native-code evidence. sv_gravity ASCII presence alone supplies no default.',
      effects: 'Weapon m_nDamage/m_flRange/m_flArmorRatio are preserved as fields, not assumed blast/flash/decoy formulas. No inference from particle durations or presentation sounds.',
      configuration: 'CFG assignments are overrides, not engine defaults. modeExec preserves declared order/offline condition; absent server CFGs and official environment overrides are not invented.',
    }};
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (check) {
    if (fs.readFileSync(output, 'utf8') !== serialized) throw new Error('Native utility rules changed; review fresh extraction');
  } else fs.writeFileSync(output, serialized);
  console.log(`${check ? 'Verified' : 'Imported'} native utility evidence: build ${build}, ${Object.keys(result.weapons).length} weapons, ${cfgNames.length} configs, ${Object.keys(convars).length} convar candidates`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  importNativeUtilityRules({check: process.argv.includes('--check')});
