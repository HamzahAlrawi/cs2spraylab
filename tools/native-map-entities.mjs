import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';
import {entityPhysicsTriangles} from './grenade-map-geometry.mjs';

export function parseMapEntities(text) {
  return text.split(/^====\d+====\s*$/m).filter(Boolean).map(block => {
    const entity = {enableOnBreak: []};
    for (const line of block.split(/\r?\n/)) {
      const field = /^(classname|model|origin|angles|scales|startdisabled|solid|health|targetname|hammeruniqueid)\s+(.+)$/.exec(line);
      if (field) entity[field[1]] = parseKv3(field[2]);
      const output = /^@OnBreak Enable (.+)$/.exec(line);
      if (output) entity.enableOnBreak.push(output[1]);
    }
    return entity;
  });
}

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const dataBlock = text => parseKv3(text.slice(text.indexOf('<!-- kv3')).replace(/#\[([\s\S]*?)\]/g,
  (_, hex) => JSON.stringify(Buffer.from(hex.replace(/\s/g, ''), 'hex').toString('base64'))));

/** Static native entity/model PHYS only. Raw geometry remains in ignored map assets. */
export function extractMapEntities(map, {game, cli, build}) {
  const work = `${map.work}/breakables`; fs.mkdirSync(work, {recursive: true});
  const main = `${game}/game/csgo/pak01_dir.vpk`, archive = `${game}/game/csgo/maps/${map.mapId}.vpk`;
  const run = args => {
    const output = execFileSync(cli, args, {encoding: 'utf8', windowsHide: true, maxBuffer: 64e6});
    if (/Exception:|file\(s\) failed to process/.test(output)) throw Error('Native entity extraction failed; update Source2Viewer.');
    return output;
  };
  const lump = `maps/${map.mapId}/entities/default_ents.vents_c`, raw = `${work}/entities.vents_c`, text = `${work}/entities.vents`;
  run(['-i', archive, '-f', lump, '-o', raw]); run(['-i', raw, '-d', '-o', text]);
  const entities = parseMapEntities(fs.readFileSync(text, 'utf8'));
  const relevant = entities.filter(e => typeof e.model === 'string' &&
    ['func_breakable', 'prop_dynamic', 'prop_dynamic_override', 'prop_physics', 'prop_physics_multiplayer'].includes(e.classname));
  const models = new Map();
  for (const [index, resource] of [...new Set(relevant.map(e => e.model))].entries()) {
    if (!/^[a-zA-Z0-9_/.-]+\.vmdl$/.test(resource) || resource.includes('..')) throw Error('Unsafe native entity model');
    const file = `${work}/model-${index}.vmdl_c`;
    run(['-i', resource.startsWith('maps/') ? archive : main, '-f', `${resource}_c`, '-o', file]);
    const data = run(['-i', file, '-b', 'DATA']), keys = data.match(/m_keyValueText\s*=\s*"""([\s\S]*?)"""/)?.[1];
    const props = keys ? parseKv3(keys).prop_data : undefined;
    models.set(resource, {file, sha256: sha(fs.readFileSync(file)), health: props?.health});
  }
  const breakables = relevant.filter(e => Number(e.health ?? models.get(e.model).health) > 0);
  const enabledNames = new Set(breakables.flatMap(e => e.enableOnBreak));
  const selected = relevant.filter(e => breakables.includes(e) || enabledNames.has(e.targetname) || [true, 1, '1'].includes(e.startdisabled));
  const result = [];
  for (const entity of selected) {
    const model = models.get(entity.model), dump = run(['-i', model.file, '-b', 'PHYS']);
    if (!dump.includes('<!-- kv3')) throw Error(`Native breakable lacks PHYS: ${entity.model}`);
    const shape = entityPhysicsTriangles(dataBlock(dump), entity);
    if (!shape.indices.length) throw Error(`Empty native breakable PHYS: ${entity.model}`);
    result.push({id: `native:${map.mapId}:${entity.hammeruniqueid}`, model: entity.model,
      modelSha256: model.sha256, classname: entity.classname, origin: entity.origin,
      health: Number(entity.health ?? model.health ?? 0),
      active: ![true, 1, '1'].includes(entity.startdisabled), targetname: entity.targetname ?? '',
      movement: Number(entity.solid ?? 6) !== 0 && entity.classname !== 'prop_physics_multiplayer',
      shots: Number(entity.solid ?? 6) !== 0, grenades: Number(entity.solid ?? 6) !== 0,
      enableOnBreak: entity.enableOnBreak,
      vertices: Array.from(shape.vertices), indices: Array.from(shape.indices)});
  }
  const manifest = {schema: 1, mapId: map.mapId, build, mapSha256: sha(fs.readFileSync(archive)),
    entityLump: {resource: lump, sha256: sha(fs.readFileSync(raw))}, extractorSha256: sha(fs.readFileSync(cli)), entities: result};
  fs.writeFileSync(`${map.out}/entities.json`, JSON.stringify(manifest));
  const evidence = {...manifest, entities: result.map(({vertices, indices, ...e}) => ({...e, vertices: vertices.length / 3, triangles: indices.length / 3}))};
  fs.writeFileSync(`${map.work}/breakables/evidence.json`, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`${map.name}: ${result.length} native destructible/linked entities`);
  return manifest;
}
