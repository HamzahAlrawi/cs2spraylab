import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseKeyValues} from './cosmetic-keyvalues.mjs';

export const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
export const cli = process.env.SOURCE2VIEWER || path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
export const vpk = `${game}/game/csgo/pak01_dir.vpk`;
export const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const run = args => execFileSync(cli, ['-i', vpk, ...args], {encoding:'utf8', stdio:'pipe', maxBuffer:100e6});
export const list = (prefix, extension) => [...run(['-l','-f',prefix,'-e',extension])
  .matchAll(/^(\S+) CRC:(\w+) size:(\d+)/gm)].map(([,path,crc,bytes])=>({path,crc,bytes:Number(bytes)}));

export function nativeInventory(refresh = false) {
  fs.mkdirSync('research/cosmetics', {recursive:true});
  for (const resource of ['scripts/items/items_game.txt','resource/csgo_english.txt']) {
    const file = `research/cosmetics/${path.posix.basename(resource)}`;
    if (refresh || !fs.existsSync(file)) run(['-f',resource,'-o',file]);
  }
  const raw = fs.readFileSync('research/cosmetics/items_game.txt','utf8');
  const language = fs.readFileSync('research/cosmetics/csgo_english.txt');
  const tokens = Object.fromEntries(Object.entries(parseKeyValues(language.toString(language[0]===255?'utf16le':'utf8')).lang.Tokens).map(([k,v])=>[k.toLowerCase(),v]));
  const items = parseKeyValues(raw).items_game;
  const label = token => tokens[token?.replace(/^#/,'').toLowerCase()] ?? token;
  const aliases = {'503':'classic','508':'m9-bayonet','509':'huntsman','514':'bowie','516':'shadow-daggers','517':'paracord','518':'survival','520':'navaja','521':'nomad','523':'talon'};
  const knives = Object.entries(items.items).filter(([,item])=>item.prefab==='melee_unusual').map(([definitionId,item])=> {
    const nativeType = path.posix.basename(path.posix.dirname(item.model_player));
    const assetKey = `knife-${aliases[definitionId] ?? nativeType.replace(/^knife_/,'')}`;
    return {definitionId,assetKey,label:label(item.item_name),inventoryName:item.name,
      model:item.model_player+'_c',skeleton:`animation/skeletons/weapons/${nativeType}.vnmskel`,
      namespace:`animation/anims/viewmodel/knife/${nativeType}/`,suffix:nativeType.replace(/^knife_/,''),
      paintData:item.paint_data};
  });
  knives.push({definitionId:'59',assetKey:'knife-default-t',label:'Default T Knife',inventoryName:'weapon_knife_t',
    model:items.items['59'].model_player+'_c',skeleton:'animation/skeletons/weapons/knife_default_t.vnmskel',
    namespace:'animation/anims/viewmodel/knife/knife_default_t/',suffix:'default_t',stockOnly:true});
  return {items,tokens,label,knives,build:fs.readFileSync(`${game}/game/csgo/steam.inf`,'utf8').match(/ClientVersion=(\d+)/)[1],itemsSha256:hash('research/cosmetics/items_game.txt')};
}

export function knifeClips(knife, inventory) {
  const available = inventory.filter(row=>row.path.startsWith(knife.namespace));
  const find = (names, required = true) => {
    const row = names.map(name=>available.find(row=>path.posix.basename(row.path)===`${name}_${knife.suffix}.vnmclip_c`)).find(Boolean);
    if (!row && required) throw new Error(`${knife.assetKey}: no native ${names.join('/')} action`);
    return row;
  };
  const selected = {idle:find(['idle1','idle']),draw:find(['draw']),inspect:find(['lookat01']),
    fire:find(['light_miss1']), 'fire-alt':find(['heavy_miss1'])};
  for (const [key,names] of [['draw-alt',['draw2']],['inspect-alt',['lookat02']]]) {
    const row = find(names,false); if(row)selected[key]=row;
  }
  return {clips:Object.fromEntries(Object.entries(selected).map(([key,row])=>[key,row.path])),nativeFiles:selected,
    actionAudit:{available:available.map(row=>row.path),unselected:available.filter(row=>!Object.values(selected).includes(row)).map(row=>row.path)}};
}
