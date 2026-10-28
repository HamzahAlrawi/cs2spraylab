import {describe, expect, it} from 'vitest';
import fs from 'node:fs';

const base = 'public/revamp/maps/dust2';
describe.skipIf(!fs.existsSync(`${base}/visual.json`))('native Dust 2 material fidelity', () => {
  it('preserves individual opaque/cutout/blended materials and signs, rather than one low resolution atlas', () => {
    const manifest = JSON.parse(fs.readFileSync(`${base}/visual.json`, 'utf8'));
    expect(manifest.version).toBe(2);
    const materials = manifest.files.flatMap((file: string) => JSON.parse(fs.readFileSync(`${base}/${file}`, 'utf8')).materials);
    expect(materials.length).toBeGreaterThan(100);
    expect(materials.every((m: any) => m.extras.nativeDust2 && !/materials\/tools\//.test(m.extras.nativeMaterial))).toBe(true);
    for (const alpha of ['OPAQUE', 'MASK', 'BLEND']) expect(materials.some((m: any) => (m.alphaMode ?? 'OPAQUE') === alpha)).toBe(true);
    expect(materials.some((m: any) => /overlay_sign/.test(m.extras.nativeMaterial))).toBe(true);
    expect(materials.some((m: any) => m.normalTexture && m.pbrMetallicRoughness?.baseColorTexture)).toBe(true);
    expect(materials.some((m: any) => m.extras.dust2AtlasColumns)).toBe(false);
  });
  it('has no unresolved texture/buffer URLs and uses Pages-safe spatial geometry', () => {
    const manifest = JSON.parse(fs.readFileSync(`${base}/visual.json`, 'utf8'));
    for (const file of manifest.files) {
      const gltf = JSON.parse(fs.readFileSync(`${base}/${file}`, 'utf8'));
      expect(gltf.extensionsRequired).toContain('EXT_meshopt_compression');
      for (const resource of [...gltf.images ?? [], ...gltf.buffers ?? []]) {
        if (!resource.uri && resource.extensions?.EXT_meshopt_compression?.fallback) continue;
        if (resource.uri?.startsWith('data:')) continue;
        expect(manifest.resources.some((r: any) => r.name === resource.uri)).toBe(true);
        expect(fs.statSync(`${base}/${resource.uri}`).size).toBeLessThan(25 * 1024 * 1024);
      }
    }
    expect(manifest.resources.filter((r: any) => r.name.endsWith('.webp')).length).toBeGreaterThan(60);
  });
});
