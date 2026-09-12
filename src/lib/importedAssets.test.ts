import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getImportedWeaponAsset, importedMapAssets } from './importedAssets';

const root = process.cwd();
function publicFile(url: string) {
  return join(root, 'public', url.replace(/^\//, ''));
}

describe('direct public runtime assets', () => {
  it('includes the current six GLB viewmodels and native sound samples', () => {
    for (const id of ['ak47', 'm4a4', 'm4a1s', 'sg553', 'famas', 'galil'] as const) {
      expect(existsSync(publicFile(`/revamp/models/${id}.glb`))).toBe(true);
      expect(existsSync(publicFile(`/revamp/audio/${id}.wav`))).toBe(true);
    }
  });

  it('loads the replacement range materials from its isolated public directory', () => {
    for (const name of ['wall', 'wall-normal', 'floor', 'floor-normal']) {
      expect(existsSync(publicFile(`/revamp/textures/${name}.webp`)), name).toBe(true);
    }
  });

  it('uses direct root URLs rather than requiring public/assets/imported', () => {
    expect(getImportedWeaponAsset('ak47')!.fbxUrl).toBe('/AK-47/AK47.fbx');
    expect(getImportedWeaponAsset('m4a4')!.fbxUrl).toBe('/M4A1/M4A1.fbx');
    expect(importedMapAssets.wallColor).toBe('/concretewall/textures/concrete_wall_006_diff_4k.jpg');
    expect(importedMapAssets.floorColor).toBe('/concrete2/Concrete012_1K-JPG_Color.jpg');
    expect(importedMapAssets.indoorPreview).toBe('/morenvironments/IndoorEnvironmentHDRI018_1K_TONEMAPPED.jpg');
  });

  it('leaves SMGs without imported FBX assets to the procedural fallback', () => {
    expect(getImportedWeaponAsset('mp9')).toBeUndefined();
    expect(getImportedWeaponAsset('mp7')).toBeUndefined();
    expect(getImportedWeaponAsset('mac10')).toBeUndefined();
    expect(getImportedWeaponAsset('p90')).toBeUndefined();
  });
});
