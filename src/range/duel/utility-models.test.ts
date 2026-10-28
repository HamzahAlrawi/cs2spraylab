import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {Matrix4} from 'three';
import {describe, expect, it} from 'vitest';
import inventory from './utility-models.json';
import {utilityKinds} from './utility-loadout';

function readGlb(url: string) {
  const bytes = readFileSync(`public/revamp${url}`);
  expect(bytes.toString('utf8', 0, 4)).toBe('glTF'); expect(bytes.readUInt32LE(4)).toBe(2);
  return {bytes, document: JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))};
}
describe('native grenade asset provenance', () => {
  it.each(utilityKinds)('%s retains all nine audited view clips and the native grip transform', kind => {
    const model = inventory.models[kind];
    expect(model.model).toMatch(/^weapons\/models\/grenade\/.+\.vmdl$/);
    expect(model.build).toMatch(/^\d+$/); expect(model.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(model.handInverseBind).toHaveLength(16);
    expect(new Matrix4().fromArray(model.handInverseBind).determinant()).toBeCloseTo(1, 4);
    expect(Object.keys(model.clips).sort()).toEqual(['idle', 'draw', 'inspect', 'pullpin', 'hold-high', 'hold-mid', 'hold-low', 'throw-high', 'throw-low'].sort());
    for (const clip of Object.values(model.clips)) {
      expect(clip.path).toMatch(/^animation\/anims\/viewmodel\/grenade\//);
      expect(clip.maxMountMatrixError).toBeLessThan(1e-4); expect(clip.maxPartMatrixError).toBeLessThan(1e-4);
      expect(clip.quaternionContinuity).toBe(true); expect(clip.seconds).toBeGreaterThanOrEqual(0);
    }
  });
});
describe.skipIf(!existsSync('public/revamp/models/view-utility-he.glb'))('built native grenade assets', () => {
  it.each(utilityKinds)('%s has verified textured native hands and distinct held/flying exports', kind => {
    const model = inventory.models[kind];
    for (const entry of [model.world, model.projectile, model.view]) {
      const {bytes, document} = readGlb(entry.url);
      expect(bytes.length).toBe(entry.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      expect(document.meshes.length).toBeGreaterThan(0); expect(document.images.length).toBeGreaterThan(0);
      expect(document.images.some((image: {uri?: string}) => image.uri)).toBe(false);
      expect(bytes.length).toBeLessThan(entry === model.view ? 3 * 1048576 : 1048576);
      if (entry === model.view) {
        expect(document.nodes.some((node: {extras?: {native_view_weapon?: string}}) => node.extras?.native_view_weapon === `utility-${kind}`)).toBe(true);
        expect(document.meshes.some((mesh: {name: string}) => mesh.name.includes('firstperson_default_gloves'))).toBe(true);
        expect(document.animations.map((clip: {name: string}) => clip.name).sort()).toEqual(Object.keys(model.clips).sort());
        expect(document.nodes.some((node: {name: string}) => node.name === 'hand_R')).toBe(true);
        expect(document.nodes.some((node: {name: string}) => node.name === 'hand_L')).toBe(true);
      } else expect(document.skins?.length ?? 0).toBe(0);
    }
    expect(model.world.sha256).not.toBe(model.projectile.sha256);
  });
  it('keeps explicit absolute native grenade idles, not neutral RelativeToFrame deltas', () => {
    const {document} = readGlb('/models/utility-gestures.glb');
    expect(document.animations).toHaveLength(20);
    for (const clip of document.animations.filter((animation: {name: string}) => animation.name.startsWith('gesture_idle'))) {
      expect(clip.extras.nativeSource).toContain('.vnmclip+non_additive');
      expect(clip.extras.authoredAbsolutePose).toBe(true);
    }
  });
});
