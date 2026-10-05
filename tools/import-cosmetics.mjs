import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {parseKeyValues} from './cosmetic-keyvalues.mjs';
import {parseKv3} from './kv3.mjs';
import {importKnifeCosmetics} from './import-knife-cosmetics.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
const run = args => execFileSync(cli, ['-i', `${game}/game/csgo/pak01_dir.vpk`, ...args], {encoding:'utf8',maxBuffer:50e6});
const output = 'public/revamp/textures/cosmetics';
fs.mkdirSync(output,{recursive:true}); fs.mkdirSync('research/cosmetics',{recursive:true});
run(['-f','scripts/items/items_game.txt','-o','research/cosmetics/items_game.txt']);
run(['-f','resource/csgo_english.txt','-o','research/cosmetics/csgo_english.txt']);
const raw = fs.readFileSync('research/cosmetics/items_game.txt','utf8');
const items = parseKeyValues(raw).items_game;
const language = fs.readFileSync('research/cosmetics/csgo_english.txt');
const tokens = Object.fromEntries(Object.entries(parseKeyValues(language.toString(language[0]===255?'utf16le':'utf8')).lang.Tokens).map(([k,v])=>[k.toLowerCase(),v]));
const previous = fs.existsSync('src/range/cosmetics-data.json') ? JSON.parse(fs.readFileSync('src/range/cosmetics-data.json')).cosmetics : [];
const weaponIds = Object.keys(JSON.parse(fs.readFileSync('src/range/game-data.json')).weapons);
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
const refresh = process.argv.includes('--refresh');
if (only?.some(id => !weaponIds.includes(id))) throw new Error('Unknown weapon in --only selection');
const aliases = {m4a4:'m4a1',m4a1s:'m4a1_silencer',usp:'usp_silencer',galil:'galilar',sg553:'sg556',zeus:'taser'};
const listing = run(['-l','-f','panorama/images/econ/default_generated/','-e','vtex_c']);
const icons = new Set([...listing.matchAll(/^(\S+\.vtex_c) CRC:/gm)].map(match=>match[1]));
const kits = Object.entries(items.paint_kits).map(([kitId,kit])=>({...kit,kitId}));
const prices = [350,700,1200,1900,2800,4000,5500,7500,10000,13000];
const levels = [2,4,7,12,18,26,38,52,70,90];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const convert = async (resource,id,size) => {
  const file = `research/cosmetics/${id}.png`;
  if (refresh || !fs.existsSync(file)) run(['-f',resource.endsWith('_c')?resource:`${resource}_c`,'-d','-o',file]);
  if (refresh || !fs.existsSync(`${output}/${id}.webp`)) await sharp(file).resize(size,size,{fit:'inside',withoutEnlargement:true}).webp({quality:88}).toFile(`${output}/${id}.webp`);
  return `/textures/cosmetics/${id}.webp`;
};
// Reimporting a selection must never discard purchased/legacy finish IDs.
const rows = [...previous];
const auditPath = 'docs/weapon-cosmetics-inventory.json';
const audit = fs.existsSync(auditPath) ? JSON.parse(fs.readFileSync(auditPath,'utf8')) : {weapons:{}};
audit.build = fs.readFileSync(`${game}/game/csgo/steam.inf`,'utf8').match(/ClientVersion=(\d+)/)[1];
audit.itemsSha256 = crypto.createHash('sha256').update(raw).digest('hex');
const nativePaint = kit => {
  const file = `research/cosmetics/kit-${kit.kitId}.${kit.composite_material_path ? 'vcompmat' : 'vmat'}`;
  const resource = kit.composite_material_path ?? `materials/models/weapons/customization/paints/vmats/${kit.name}.vmat`;
  if (refresh || !fs.existsSync(file)) {
    if (kit.composite_material_path) run(['-f',`${resource}_c`,'-d','-o',file]);
    else {
      const compiled = `${file}_c`;
      run(['-f',`${resource}_c`,'-o',compiled]);
      const text = execFileSync(cli,['-i',compiled,'-b','DATA'],{encoding:'utf8',maxBuffer:10e6});
      fs.writeFileSync(file,text.slice(text.indexOf('<!-- kv3')));
    }
  }
  const variables = [];
  const walk = value => {if (!value || typeof value !== 'object') return; if(value.m_strName)variables.push(value);for(const child of Object.values(value))walk(child);};
  const material = parseKv3(fs.readFileSync(file,'utf8'));
  walk(material);
  const texture = variables.find(v=>v.m_strName==='g_tPattern'&&v.m_strTextureRuntimeResourcePath)?.m_strTextureRuntimeResourcePath ??
    material.m_textureParams?.find(v=>v.m_name==='g_tPattern')?.m_pValue;
  const colors = material.m_vectorParams?.filter(v=>/^g_vColor\d$/.test(v.m_name)).map(v=>v.m_value) ??
    variables.filter(v=>/^g_vColor\d$/.test(v.m_strName)).map(v=>Array.isArray(v.m_cValueColor4)
      ? v.m_cValueColor4.slice(0,3).map(component=>component/255)
      : [v.m_flValueFloatX,v.m_flValueFloatY,v.m_flValueFloatZ]);
  if (colors.some(color=>color.length<3 || !color.slice(0,3).every(Number.isFinite))) throw new Error('Invalid native paint palette');
  const scale = variables.find(v=>v.m_strName==='g_flPatternTexCoordScale')?.m_flValueFloatX ?? 1;
  return {file,resource,texture,colors,scale};
};
for (const equipment of weaponIds) {
  if (only && !only.includes(equipment)) continue;
  const prefix = `panorama/images/econ/default_generated/weapon_${aliases[equipment]??equipment}_`;
  const candidates = kits.filter(kit=>icons.has(`${prefix}${kit.name}_light_png.vtex_c`)).sort((a,b)=>{
    const priority = kit => (previous.some(item=>item.equipment===equipment&&item.kitId===kit.kitId)?1000:0) +
      (kit.composite_material_path&&kit.use_legacy_model!=='1'?100:0) + (['7','9'].includes(kit.style)?20:0);
    return priority(b)-priority(a) || Number(b.kitId)-Number(a.kitId);
  });
  let count = 0;
  const target = equipment === 'zeus' ? Math.min(10, candidates.length) : 10;
  const finishes = [];
  for (const kit of candidates) {
    if (count===target) break;
    try {
      const paint = nativePaint(kit), id = `${equipment}-${kit.name}`;
      const map = paint.texture ? await convert(paint.texture,`kit-${kit.kitId}-albedo`,1024) : null;
      if (!map && !paint.colors.length) throw new Error('No native pattern or palette');
      const imageUrl = await convert(`${prefix}${kit.name}_light_png.vtex`,`${id}-preview`,384);
      const legacy = kit.use_legacy_model==='1' || !kit.composite_material_path;
      const row = {id,equipment,category:'weapon',label:tokens[kit.description_tag.replace(/^#/,'').toLowerCase()]??kit.name,
        unlockLevel:levels[count],price:prices[count],imageUrl,assetKey:equipment+(legacy?'-legacy':''),
        map,colors:paint.colors,patternScale:paint.scale,style:Number(kit.style),legacy,kitId:kit.kitId,
        source:paint.resource,texture:paint.texture??null,sourceSha256:hash(paint.file),
        rendering:['7','9'].includes(kit.style)?'native albedo, matching native mesh UVs; simplified factory-new PBR':'native pattern/palette; approximate procedural finish, fixed seed'};
      const existing = rows.findIndex(item=>item.id===id);
      if (existing < 0) rows.push(row); else rows[existing] = {...rows[existing],...row};
      finishes.push({id,kitId:kit.kitId,kitName:kit.name,legacy,imageSource:`${prefix}${kit.name}_light_png.vtex_c`,
        imageSha256:hash(`public/revamp${imageUrl}`),materialSource:paint.resource,materialSha256:hash(paint.file)});
      count++;
      console.log('EXPORTED cosmetic',equipment,count,kit.name,legacy?'legacy':'HD');
    } catch(error) {console.warn('Skipping unsupported native finish',equipment,kit.name,error.message.slice(0,180));}
  }
  if(count!==target || !count)throw new Error(`${equipment}: only ${count} of ${target} requested usable native finishes`);
  audit.weapons[equipment] = {nativeAvailable:candidates.length,exported:count,minimumExpected:target,finishes,
    limitation:equipment==='zeus'&&candidates.length<10?'Installed archive has fewer than ten authored Zeus finish previews; no fabricated finishes added.':null};
}
fs.writeFileSync('src/range/cosmetics-data.json',JSON.stringify({build:fs.readFileSync(`${game}/game/csgo/steam.inf`,'utf8').match(/ClientVersion=(\d+)/)[1],itemsSha256:crypto.createHash('sha256').update(raw).digest('hex'),cosmetics:rows},null,2)+'\n');
fs.writeFileSync(auditPath,JSON.stringify(audit,null,2)+'\n');
if (!only) await importKnifeCosmetics();
