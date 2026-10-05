import {afterEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {cosmeticCatalog,cosmeticAsset,cosmeticPreview,cosmeticLabel,applyCosmetic,nativeKnifeMaterial,knifeTypes} from './cosmetics';
import data from './cosmetics-data.json';
import knifeAssets from '../../docs/knife-asset-inventory.json';
import knifeAudit from '../../docs/knife-cosmetics-inventory.json';
import weaponAudit from '../../docs/weapon-cosmetics-inventory.json';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {disposeResources} from './duel/render-resources';
import {equipmentIds} from './equipment';
import {prepareCosmeticCatalog,sanitizeProgression,xpForLevel,createProgressionController} from './progression';

describe('native finish catalog and migration',()=>{
  const catalog=prepareCosmeticCatalog(cosmeticCatalog);
  it.each(equipmentIds)('%s has distinct purchasable native finishes with previews',id=>{
    const items=catalog.filter(item=>item.equipment===id&&!item.isDefault);
    if (id === 'zeus') {
      expect(weaponAudit.weapons.zeus.nativeAvailable).toBe(7);
      expect(items).toHaveLength(weaponAudit.weapons.zeus.nativeAvailable);
    } else expect(items.length).toBeGreaterThanOrEqual(10);
    expect(new Set(items.map(item=>item.id)).size).toBe(items.length);
    expect(items.every(item=>item.imageUrl&&item.assetKey&&item.price!>0)).toBe(true);
  });
  it('provides native gloves and bot agents as paid categories',()=>{
    expect(catalog.filter(item=>item.category==='gloves'&&!item.isDefault)).toHaveLength(8);
    expect(catalog.filter(item=>item.category==='agent'&&!item.isDefault)).toHaveLength(6);
    expect(catalog.filter(item=>!item.isDefault).reduce((total,item)=>total+item.price!,0)).toBeGreaterThan(2_000_000);
  });
  it('does not grant hundreds of newly added finishes when migrating an old level 100 save',()=>{
    const profile=sanitizeProgression({version:1,xp:xpForLevel(100)},catalog);
    const paid=catalog.filter(item=>!item.isDefault&&profile.owned.includes(item.id));
    expect(paid.length).toBe(11);
    expect(paid.every(item=>item.legacyUnlockLevel!==undefined)).toBe(true);
    expect(profile.balance).toBe(0);
  });
  it('keeps an equipped old finish and uses its native preview in loadout',()=>{
    const id='ak47-cu_overpass_monster_ak47';
    const profile=sanitizeProgression({version:1,xp:0,equipped:{ak47:id}},catalog);
    expect(profile.owned).toContain(id);
    expect(cosmeticPreview(profile,'ak47')).toContain('/textures/cosmetics/');
    expect(cosmeticAsset(profile,'ak47')).toBe('ak47');
  });
  it('requires a purchase rather than automatically owning a level-eligible new item',()=>{
    const controller=createProgressionController({catalog,storage:{getItem:()=>JSON.stringify({version:2,xp:xpForLevel(100),balance:1000,owned:[]}),setItem:()=>{}}});
    const item=catalog.find(item=>item.equipment==='ak47'&&!item.isDefault)!;
    expect(controller.equip('ak47',item.id)).toBe(false);
    expect(controller.purchase(item.id)).toMatchObject({success:true,spent:350});
    expect(controller.getSnapshot().profile.balance).toBe(650);
    expect(controller.purchase(item.id)).toMatchObject({success:true,spent:0});
    expect(controller.equip('ak47',item.id)).toBe(true);
  });
});

describe('native knife types remain cosmetics for slot three',()=>{
  type KnifeFinish = Parameters<typeof nativeKnifeMaterial>[1] & {assetKey:string;imageUrl:string;definitionId:string;
    imageSource:string;imageSha256:string;kitName?:string;sourceSha256?:string;paintMaskSource?:string};
  const knives=data.cosmetics.filter(item=>item.equipment==='knife') as unknown as KnifeFinish[];
  const types=Object.entries(knifeAssets.knives).filter(([,knife])=>!('stockOnly' in knife));
  it('covers all twenty native skinnable types without expanding Equipment',()=>{
    expect(types).toHaveLength(20);
    expect(knifeTypes).toHaveLength(22);
    expect(knifeTypes.find(item=>item.assetKey==='knife-butterfly')?.label).toBe('Butterfly Knife');
    expect(equipmentIds.filter(id=>id.startsWith('knife'))).toEqual(['knife']);
    expect(new Set(knives.map(item=>item.id)).size).toBe(knives.length);
    expect(knives.every(item=>item.category==='knife')).toBe(true);
    expect(knives.filter(item=>'stockOnly' in item)).toHaveLength(1);
  });
  it.each(types)('%s has more than ten genuinely supported native skin pairings',(id,native)=>{
    const finishes=knives.filter(item=>item.assetKey===id);
    expect(finishes.length).toBeGreaterThan(10);
    expect(finishes.length).toBe((knifeAudit.knives as Record<string,{finishes:number}>)[id].finishes);
    for(const item of finishes) {
      expect(item).toMatchObject({equipment:'knife',category:'knife',definitionId:native.definitionId});
      expect(item.imageSource).toBe(`panorama/images/econ/default_generated/${native.inventoryName}_${item.kitName}_light_png.vtex_c`);
      expect(item.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(item.paintMaskSource).toContain('/composite_inputs/');
      expect(item.imageUrl).toContain('/textures/cosmetics/');
    }
    for(const key of [id,`view-${id}`]) {
      const file=readFileSync(`public/revamp/models/${key}.glb`);
      const document=JSON.parse(file.subarray(20,20+file.readUInt32LE(12)).toString());
      expect(document.skins.length).toBeGreaterThan(0);
      if(key.startsWith('view-')) {
        expect(file.length).toBeLessThan(4*1048576);
        expect(document.animations.map((clip:{name:string})=>clip.name)).toEqual(expect.arrayContaining(['idle','draw','inspect','fire','fire-alt']));
      }
    }
  });
  it('keeps old butterfly IDs while using exact native phase-2 and black-pearl variants',()=>{
    expect(knives.find(item=>item.id==='knife-butterfly-am_doppler_phase2')).toMatchObject({kitId:'618',kitName:'am_doppler_phase2_b',label:'Butterfly Knife | Doppler Phase 2'});
    expect(knives.find(item=>item.id==='knife-butterfly-am_blackpearl_marbleized')).toMatchObject({kitId:'617',kitName:'am_blackpearl_marbleized_b'});
    const emerald=knives.find(item=>item.id==='knife-butterfly-emerald')!;
    expect(emerald.imageUrl).not.toBe('/models/knife-butterfly.png');
    expect(emerald.imageSource).toContain('am_emerald_marbleized_light');
  });
  it('uses distinct authored images and labels for every supported Doppler/Gamma phase',()=>{
    for(const [id] of types) {
      const phases=knives.filter(item=>item.assetKey===id&&/doppler|marbleized/.test(item.kitName ?? ''));
      expect(new Set(phases.map(item=>item.label)).size).toBe(phases.length);
      expect(new Set(phases.map(item=>item.imageSha256)).size).toBe(phases.length);
      for(const phase of phases) {
        const bytes=readFileSync(`public/revamp${phase.imageUrl}`);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(phase.imageSha256);
        expect(bytes.length).toBeGreaterThan(3000);
        if(phase.kitName?.includes('doppler_phase'))expect(phase.label).toMatch(/Phase [1-4]$/);
      }
    }
  });
  it('selects a type through the existing knife equipment key',()=>{
    const choice=knives.find(item=>item.assetKey==='knife-shadow-daggers')!;
    const profile=sanitizeProgression({version:2,owned:[choice.id],equipped:{knife:choice.id}},cosmeticCatalog);
    expect(cosmeticAsset(profile,'knife')).toBe('knife-shadow-daggers');
    expect(cosmeticPreview(profile,'knife')).toBe(choice.imageUrl);
    expect(cosmeticLabel(profile,'knife')).toBe(choice.label);
  });
});

describe('native UV knife painting and resource ownership',()=>{
  afterEach(()=>vi.restoreAllMocks());
  const finish=()=>data.cosmetics.find(item=>item.equipment==='knife'&&item.assetKey==='knife-bayonet')!;
  it('keeps stock handle maps and applies a UV mask without requiring a blade bone',async()=>{
    const root=new THREE.Group(),baseMap=new THREE.Texture(),base=new THREE.MeshStandardMaterial({map:baseMap});
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(),base);mesh.name='weapon_knife_bayonet.body_legacy';root.add(mesh);
    const sleeve=new THREE.Mesh(new THREE.BoxGeometry(),base);sleeve.name='firstperson_sleeves';root.add(sleeve);
    const pattern=new THREE.Texture(),mask=new THREE.Texture(),item=finish();
    const load=vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockResolvedValueOnce(pattern).mockResolvedValueOnce(mask);
    const profile=sanitizeProgression({version:2,owned:[item.id],equipped:{knife:item.id}},cosmeticCatalog);
    await applyCosmetic(root,profile,'knife');
    expect(load).toHaveBeenCalledTimes(2);expect(sleeve.material).toBe(base);
    const material=mesh.material as THREE.MeshStandardMaterial;
    expect(material).not.toBe(base);expect(material.map).toBe(baseMap);
    expect(mask.colorSpace).toBe(THREE.NoColorSpace);expect(mask.flipY).toBe(false);
    expect(mesh.geometry.getAttribute('paintMask')).toBeUndefined();
    const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>'} as Parameters<typeof material.onBeforeCompile>[0];
    material.onBeforeCompile(shader,{} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('vKnifeUv = uv');
    expect(shader.fragmentShader).toContain('texture2D(knifeMask, vKnifeUv).r');
    expect(shader.fragmentShader).toContain('mix(diffuseColor.rgb,');
    const patternDispose=vi.spyOn(pattern,'dispose'),maskDispose=vi.spyOn(mask,'dispose');
    disposeResources([root]);expect(patternDispose).toHaveBeenCalledOnce();expect(maskDispose).toHaveBeenCalledOnce();
  });
  it('cleans up the selected pattern when mask loading fails',async()=>{
    const pattern=new THREE.Texture(),dispose=vi.spyOn(pattern,'dispose'),item=finish();
    vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockResolvedValueOnce(pattern).mockRejectedValueOnce(new Error('mask missing'));
    const profile=sanitizeProgression({version:2,owned:[item.id],equipped:{knife:item.id}},cosmeticCatalog);
    await expect(applyCosmetic(new THREE.Group(),profile,'knife')).rejects.toThrow('mask missing');
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('owns no orphaned textures when an assembly has no paintable weapon mesh',async()=>{
    const pattern=new THREE.Texture(),mask=new THREE.Texture(),item=finish();
    const disposePattern=vi.spyOn(pattern,'dispose'),disposeMask=vi.spyOn(mask,'dispose');
    vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockResolvedValueOnce(pattern).mockResolvedValueOnce(mask);
    const profile=sanitizeProgression({version:2,owned:[item.id],equipped:{knife:item.id}},cosmeticCatalog);
    await applyCosmetic(new THREE.Group(),profile,'knife');
    expect(disposePattern).toHaveBeenCalledOnce();expect(disposeMask).toHaveBeenCalledOnce();
  });
  it('gives different shader branches distinct program cache keys',()=>{
    const material=new THREE.MeshStandardMaterial(),mask=new THREE.Texture();
    const common={id:'test',equipment:'knife',category:'knife' as const,label:'test',unlockLevel:1};
    const palette=nativeKnifeMaterial(material,{...common,style:5,colors:[[1,0,0]]},new THREE.Texture(),mask);
    const albedo=nativeKnifeMaterial(material,{...common,style:7},new THREE.Texture(),mask);
    const solid=nativeKnifeMaterial(material,{...common,style:1,colors:[[1,0,0]]},undefined,mask);
    expect(new Set([palette,albedo,solid].map(item=>item.customProgramCacheKey())).size).toBe(3);
  });
});
