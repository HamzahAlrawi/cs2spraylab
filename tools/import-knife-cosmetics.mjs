import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {parseKv3} from './kv3.mjs';
import {nativeInventory,list,run,cli,vpk,hash} from './native-knives.mjs';
import {importInventoryPreview} from './native-inventory-preview.mjs';

export function knifeFinishLabel(kit, label) {
  const phase=kit.name.match(/am_(gamma_)?doppler_phase(\d)/);
  if(phase)return `${phase[1]?'Gamma Doppler':'Doppler'} Phase ${phase[2]}`;
  for(const [name,title] of [['emerald','Gamma Doppler Emerald'],['ruby','Doppler Ruby'],['sapphire','Doppler Sapphire'],['blackpearl','Doppler Black Pearl']]) {
    if(kit.name.startsWith(`am_${name}_marbleized`))return title;
  }
  return label(kit.description_tag) ?? kit.name;
}

// Existing saves keep their IDs; the native phase-2/black-pearl resources use _b.
export function knifeFinishId(assetKey,name) {
  if(assetKey==='knife-butterfly') {
    if(name==='am_emerald_marbleized')return 'knife-butterfly-emerald';
    if(['am_doppler_phase2_b','am_blackpearl_marbleized_b'].includes(name))name=name.replace(/_b$/,'');
  }
  return `${assetKey}-${name}`;
}

export async function importKnifeCosmetics({refresh=false}={}) {
  const inventory=nativeInventory(refresh),icons=list('panorama/images/econ/','vtex_c');
  const textures=list('weapons/models/knife/','vtex_c');
  const work='research/knife-cosmetics',out='public/revamp/textures/cosmetics';
  fs.mkdirSync(work,{recursive:true});fs.mkdirSync(out,{recursive:true});
  const kits=Object.entries(inventory.items.paint_kits).map(([kitId,kit])=>({...kit,kitId}));
  const rows=[],audit={schema:1,build:inventory.build,itemsSha256:inventory.itemsSha256,knives:{}};
  const converted=new Map(),materials=new Map();
  const texture = async(resource,id,mask=false) => {
    if(converted.has(id))return converted.get(id);
    const compiled=`${work}/${id}.vtex_c`,png=`${work}/${id}.png`,output=`${out}/${id}.webp`;
    if(refresh||!fs.existsSync(compiled))run(['-f',resource.endsWith('_c')?resource:resource+'_c','-o',compiled]);
    if(refresh||!fs.existsSync(png))run(['-f',resource.endsWith('_c')?resource:resource+'_c','-d','-o',png]);
    // VTEX alpha stores compositor data, not transparency. Preserve hidden RGB.
    const {data,info}=await sharp(png).raw().toBuffer({resolveWithObject:true});
    if(info.channels===4)for(let i=3;i<data.length;i+=4)data[i]=255;
    await sharp(data,{raw:info}).resize(512,512,{fit:'inside',withoutEnlargement:true}).removeAlpha()
      .webp(mask?{lossless:true}:{quality:92}).toFile(output);
    const result={url:`/textures/cosmetics/${id}.webp`,source:resource,sourceSha256:hash(compiled),sha256:hash(output)};
    converted.set(id,result);return result;
  };
  const paint = async kit => {
    if(materials.has(kit.kitId))return materials.get(kit.kitId);
    const resource=`materials/models/weapons/customization/paints/vmats/${kit.name}.vmat_c`;
    const file=`${work}/kit-${kit.kitId}.vmat_c`;
    if(refresh||!fs.existsSync(file))run(['-f',resource,'-o',file]);
    if(!fs.existsSync(file))throw new Error(`No authored paint material ${resource}`);
    const text=execFileSync(cli,['-i',file,'-b','DATA'],{encoding:'utf8',stdio:'pipe',maxBuffer:10e6});
    const material=parseKv3(text.slice(text.indexOf('<!-- kv3')));
    const number=name=>material.m_floatParams?.find(v=>v.m_name===name)?.m_flValue;
    const vector=name=>material.m_vectorParams?.find(v=>v.m_name===name)?.m_value;
    const pattern=material.m_textureParams?.find(v=>v.m_name==='g_tPattern')?.m_pValue;
    const colors=[0,1,2,3].map(n=>vector(`g_vColor${n}`)).filter(Boolean);
    if(!pattern&&!colors.length)throw new Error(`${kit.name}: no native pattern or palette`);
    const converted=pattern?await texture(pattern,`knife-kit-${kit.kitId}-pattern`):null;
    const result={source:resource,sourceSha256:hash(file),map:converted?.url??null,texture:pattern??null,
      textureSourceSha256:converted?.sourceSha256??null,textureSha256:converted?.sha256??null,
      colors,style:Number(kit.style),patternScale:number('g_flPatternTexCoordScale')??1,
      patternRotation:number('g_flPatternTexCoordRotation')??0,patternOffset:vector('g_vPatternTexCoordOffset')?.slice(0,2)??[0,0],
      paintRoughness:number('g_flPaintRoughness')??.3};
    materials.set(kit.kitId,result);return result;
  };
  for(const knife of inventory.knives) {
    if(knife.stockOnly) {
      const preview=icons.find(row=>row.path===`panorama/images/econ/weapons/base_weapons/${knife.inventoryName}_png.vtex_c`);
      if(!preview)throw new Error(`Missing stock preview for ${knife.assetKey}`);
      rows.push({id:`${knife.assetKey}-stock`,equipment:'knife',category:'knife',assetKey:knife.assetKey,label:knife.label,
        price:3500,unlockLevel:5,stockOnly:true,knifeType:knife.assetKey,definitionId:knife.definitionId,
        ...await importInventoryPreview({id:`${knife.assetKey}-stock`,resource:preview.path,cli,vpk,work})});
      audit.knives[knife.assetKey]={label:knife.label,stockOnly:true,finishes:0};continue;
    }
    const prefix=`panorama/images/econ/default_generated/${knife.inventoryName}_`;
    const candidates=kits.filter(kit=>icons.some(row=>row.path===`${prefix}${kit.name}_light_png.vtex_c`));
    if(candidates.length<=10)throw new Error(`${knife.assetKey}: only ${candidates.length} native inventory finishes`);
    const maskResource=textures.find(row=>row.path.startsWith(path.posix.dirname(knife.model)+'/materials/composite_inputs/')&&/_masks_/.test(row.path));
    if(!maskResource)throw new Error(`${knife.assetKey}: missing native UV paint mask`);
    const mask=await texture(maskResource.path,`${knife.assetKey}-paint-mask`,true);
    const selected=[];
    for(const kit of candidates) {
      const id=knifeFinishId(knife.assetKey,kit.name),material=await paint(kit);
      const image=await importInventoryPreview({id,resource:`${prefix}${kit.name}_light_png.vtex_c`,cli,vpk,work});
      const premium=/doppler|marbleized|fade/.test(kit.name),ordinal=selected.length;
      rows.push({id,equipment:'knife',category:'knife',assetKey:knife.assetKey,knifeType:knife.assetKey,definitionId:knife.definitionId,
        label:`${knife.label} | ${knifeFinishLabel(kit,inventory.label)}`,price:premium?45000+Number(kit.kitId)%9*5500:12000+ordinal*1200,
        unlockLevel:premium?40:15,kitId:kit.kitId,kitName:kit.name,...image,...material,
        paintMaskMap:mask.url,paintMaskSource:mask.source,paintMaskSourceSha256:mask.sourceSha256,paintMaskSha256:mask.sha256,
        rendering:'authored native inventory preview; native mesh/pattern/palette and red-channel UV blade mask; approximate fixed-seed PBR, not Valve wear/seed compositor'});
      selected.push({id,kitId:kit.kitId,name:kit.name,imageSource:image.imageSource});
    }
    audit.knives[knife.assetKey]={label:knife.label,definitionId:knife.definitionId,finishes:selected.length,paintMask:maskResource,selected};
    console.log('EXPORTED knife cosmetics',knife.assetKey,selected.length);
  }
  const file='src/range/cosmetics-data.json',catalog=JSON.parse(fs.readFileSync(file));
  catalog.cosmetics=[...catalog.cosmetics.filter(row=>row.equipment!=='knife'),...rows];
  catalog.knifeBuild=inventory.build;catalog.knifeItemsSha256=inventory.itemsSha256;
  fs.writeFileSync(file,JSON.stringify(catalog,null,2)+'\n');
  fs.writeFileSync('docs/knife-cosmetics-inventory.json',JSON.stringify(audit,null,2)+'\n');
  return rows;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await importKnifeCosmetics({refresh:process.argv.includes('--refresh')});
