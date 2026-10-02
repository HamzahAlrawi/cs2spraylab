import * as THREE from 'three';
import data from './cosmetics-data.json';
import {equipmentIds, equipmentNames, type Equipment} from './equipment';
import {equippedCosmetic, type CosmeticDefinition, type ProgressionProfile} from './progression';
import {actorCosmetics, applyGloves} from './actor-cosmetics';

type NativeFinish = CosmeticDefinition & {map?: string | null; colors?: number[][]; style?: number; patternScale?: number; kitId?: string;
  paintMaskMap?: string; patternRotation?: number; patternOffset?: number[]; paintRoughness?: number; stockOnly?: boolean};
const finishes = data.cosmetics as readonly NativeFinish[];
export const DEFAULT_GLOVE_PREVIEW = '/textures/cosmetics/gloves-standard-preview.webp';
const legacyLevels: Record<string,number> = {'142':10,'106':7,'137':12,'138':5,'139':6,'144':4,'939':3,'937':3,'936':6,'883':5,'568':20};

export const cosmeticCatalog: CosmeticDefinition[] = [
  ...equipmentIds.map(equipment => ({id: equipment === 'knife' ? 'knife-standard' : `${equipment}-standard`, equipment,
    label: equipment === 'knife' ? 'Standard knife' : 'Stock', category: equipment === 'knife' ? 'knife' as const : 'weapon' as const,
    price: 0, unlockLevel: 1, isDefault: true, imageUrl: `/models/${equipment}.png`, assetKey: equipment})),
  ...finishes.map(item=>({...item,...(item.kitId && legacyLevels[item.kitId] &&
    (item.equipment !== 'knife' || item.id === 'knife-butterfly-emerald') ? {legacyUnlockLevel:legacyLevels[item.kitId]} : {})})),
  {id:'gloves-standard',equipment:'gloves',category:'gloves',label:'Standard gloves',price:0,unlockLevel:1,isDefault:true,imageUrl:DEFAULT_GLOVE_PREVIEW},
  {id:'agent-standard',equipment:'agent',category:'agent',label:'SAS',price:0,unlockLevel:1,isDefault:true,imageUrl:'/models/target.png'},
  ...actorCosmetics,
];
/** Small runtime model-filter list derived from the catalog, never the build manifest. */
export const knifeTypes: readonly {assetKey: string; label: string}[] = [...new Map(
  cosmeticCatalog.filter(item=>item.category==='knife'&&item.assetKey).map(item=>[
    item.assetKey!, {assetKey:item.assetKey!,label:item.label.split(' | ')[0]},
  ])).values()];
export const cosmeticAsset = (profile: ProgressionProfile, equipment: Equipment) => equippedCosmetic(profile, cosmeticCatalog, equipment)?.assetKey ?? equipment;
export const cosmeticPreview = (profile: ProgressionProfile, equipment: Equipment) => equippedCosmetic(profile, cosmeticCatalog, equipment)?.imageUrl ?? `/models/${equipment}.png`;
export const cosmeticLabel = (profile: ProgressionProfile, equipment: Equipment) => {
  const item = equippedCosmetic(profile, cosmeticCatalog, equipment);
  return item && !item.isDefault ? item.category === 'knife' ? item.label : `${equipmentNames[equipment]} | ${item.label}` : equipmentNames[equipment];
};

/** A native UV mask works on fixed and articulated blades, including both daggers. */
export function nativeKnifeMaterial(material: THREE.MeshStandardMaterial, finish: NativeFinish,
  pattern: THREE.Texture | undefined, mask: THREE.Texture) {
  const clone = material.clone();
  const colors = finish.colors?.filter(color => color.length >= 3 && color.slice(0,3).every(Number.isFinite)) ?? [];
  const color = (index: number) => {
    const value = colors[index] ?? colors[0] ?? [1,1,1];
    return new THREE.Color().setRGB(value[0],value[1],value[2],THREE.SRGBColorSpace);
  };
  // Keep auxiliary shader textures discoverable by the existing resource disposer.
  Object.assign(clone, {cosmeticPattern:pattern, cosmeticPaintMask:mask});
  clone.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 vKnifeUv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvKnifeUv = uv;');
    Object.assign(shader.uniforms, {
      knifePattern:{value:pattern ?? mask}, knifeMask:{value:mask}, knifeScale:{value:finish.patternScale ?? 1},
      knifeRotation:{value:(finish.patternRotation ?? 0)*Math.PI/180},
      knifeOffset:{value:new THREE.Vector2().fromArray(finish.patternOffset ?? [0,0])},
      knifeColor0:{value:color(0)},knifeColor1:{value:color(1)},knifeColor2:{value:color(2)},knifeColor3:{value:color(3)},
      knifeRoughness:{value:finish.paintRoughness ?? .3},
    });
    shader.fragmentShader = `uniform sampler2D knifePattern; uniform sampler2D knifeMask;
uniform float knifeScale; uniform float knifeRotation; uniform float knifeRoughness;
varying vec2 vKnifeUv; uniform vec2 knifeOffset; uniform vec3 knifeColor0; uniform vec3 knifeColor1; uniform vec3 knifeColor2; uniform vec3 knifeColor3;
` + shader.fragmentShader;
    // Preserve the stock albedo/normal/roughness on the handle and other unpainted regions.
    const palette = colors.length && ![7,9].includes(finish.style ?? 0);
    const sample = !pattern || finish.style === 1 ? 'knifeColor0' : palette
      ? 'mix(mix(mix(knifeColor0, knifeColor1, knifeChannels.r), knifeColor2, knifeChannels.g), knifeColor3, knifeChannels.b)'
      : 'knifeChannels.rgb';
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
float knifeCoverage = texture2D(knifeMask, vKnifeUv).r;
vec2 knifeUv = (vKnifeUv - 0.5) * knifeScale;
knifeUv = mat2(cos(knifeRotation), -sin(knifeRotation), sin(knifeRotation), cos(knifeRotation)) * knifeUv + 0.5 + knifeOffset;
vec4 knifeChannels = texture2D(knifePattern, knifeUv);
diffuseColor.rgb = mix(diffuseColor.rgb, ${sample}, knifeCoverage);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, knifeRoughness, knifeCoverage);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>',
      '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.9, knifeCoverage);');
  };
  clone.customProgramCacheKey = () => `spraylab-native-knife-v3-${Boolean(pattern)}-${colors.length>0}-${finish.style ?? 0}`;
  return clone;
}

/** Applies only to an exclusively owned model. Its normal disposal owns the new textures/materials. */
export async function applyCosmetic(root: THREE.Object3D, profile: ProgressionProfile, equipment: Equipment) {
  await applyGloves(root, profile);
  const choice = equippedCosmetic(profile, cosmeticCatalog, equipment);
  const finish = finishes.find(item => item.id === choice?.id);
  if (!finish || finish.stockOnly) return;
  const knife = equipment === 'knife';
  const paint = finish.map ? await new THREE.TextureLoader().loadAsync(finish.map) : undefined;
  if (paint) {paint.flipY = false; paint.colorSpace = knife && finish.colors?.length && ![7,9].includes(finish.style ?? 0) ? THREE.NoColorSpace : THREE.SRGBColorSpace;}
  let mask: THREE.Texture | undefined;
  if (knife) {
    try {
      if (!finish.paintMaskMap) throw new Error(`Missing native knife paint mask: ${finish.id}`);
      mask = await new THREE.TextureLoader().loadAsync(finish.paintMaskMap);
      mask.flipY = false; mask.colorSpace = THREE.NoColorSpace;
      if (paint) paint.wrapS = paint.wrapT = THREE.RepeatWrapping;
    } catch(error) {paint?.dispose();throw error;}
  }
  const retired = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !/weapon|body_hd|body_legacy/i.test(object.name) || /firstperson|glove|sleeve/i.test(object.name)) return;
    const original = Array.isArray(object.material) ? object.material : [object.material];
    const painted = original.map(material => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return material;
      if (knife && mask) return nativeKnifeMaterial(material, finish, paint, mask);
      const clone = material.clone();
      const colors = finish.colors?.filter(color => color.length >= 3 && color.slice(0, 3).every(Number.isFinite)) ?? [];
      const procedural = finish.style !== undefined && ![7, 9].includes(finish.style);
      if (!procedural && paint) {clone.map = paint; clone.color.set('#ffffff');}
      else if (!paint) {
        if (colors[0]) clone.color.setRGB(colors[0][0], colors[0][1], colors[0][2]);
      } else {
        const color = colors[0] ?? [1, 1, 1], second = colors[1] ?? color;
        // Native paint palettes/patterns, not Valve's wear/seed material compositor.
        clone.map = paint;
        clone.onBeforeCompile = shader => {
          shader.uniforms.cosmeticPattern = {value: paint};
          shader.uniforms.cosmeticColor = {value: new THREE.Color(color[0], color[1], color[2])};
          shader.uniforms.cosmeticColor2 = {value: new THREE.Color(second[0], second[1], second[2])};
          shader.uniforms.cosmeticScale = {value: finish.patternScale ?? 1};
          shader.fragmentShader = 'uniform sampler2D cosmeticPattern; uniform vec3 cosmeticColor; uniform vec3 cosmeticColor2; uniform float cosmeticScale;\n' + shader.fragmentShader;
          const painted = colors.length ? 'mix(cosmeticColor, cosmeticColor2, texture2D(cosmeticPattern, vMapUv * cosmeticScale).r)' : 'texture2D(cosmeticPattern, vMapUv * cosmeticScale).rgb';
          shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `diffuseColor.rgb *= ${painted};`);
        };
        clone.customProgramCacheKey = () => `spraylab-native-paint-v2-false-${colors.length > 0}`;
      }
      return clone;
    });
    object.material = Array.isArray(object.material) ? painted : painted[0];
    for (const material of original) retired.add(material);
  });
  if (!retired.size) {paint?.dispose();mask?.dispose();return;}
  root.userData.cosmeticTexture = paint;
  root.userData.cosmeticFinish = finish.id;
  root.userData.cosmeticOriginalMaterials = [...retired];
}
