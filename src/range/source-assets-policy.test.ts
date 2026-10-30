import {describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
// @ts-expect-error Offline source-policy helper is deliberately JavaScript.
import {isAssetPath,embeddedMedia,inspectTrackedAssets} from '../../tools/asset-policy.mjs';

describe('source-only repository policy',()=>{
  it('keeps deploy configuration but excludes generated runtime media and manifests',()=>{
    expect(isAssetPath('public/revamp/_headers')).toBe(false);
    for(const path of ['public/revamp/favicon.svg','public/revamp/models/range-kit.glb',
      'public/revamp/utility-presentation/sounds.json','old-assets/weapon.wav','docs/texture.webp'])expect(isAssetPath(path)).toBe(true);
    expect(isAssetPath('src/range/game-data.json')).toBe(false);
    expect(isAssetPath('tools/import-game.mjs')).toBe(false);
  });
  it('finds embedded media but permits source paths and generating code',()=>{
    expect(embeddedMedia.test('data:image/webp;base64,'+'A'.repeat(256))).toBe(true);
    expect(embeddedMedia.test('/utility-presentation/he-core-260a4b3fd319.webp')).toBe(false);
    expect(embeddedMedia.test("data:image/webp;base64,${atlas.toString('base64')}" )).toBe(false);
  });
  it('contains no tracked runtime asset files or embedded media payloads',ctx=>{
    try{execFileSync('git',['rev-parse','--is-inside-work-tree'],{stdio:'pipe'});}catch{ctx.skip();return;}
    expect(inspectTrackedAssets()).toEqual({files:[],embedded:[]});
  });
  it('rebuilds external HE/USP assets in the local pipeline instead of embedding them',()=>{
    const script=readFileSync('tools/build-assets.mjs','utf8');
    expect(script).toContain('tools/import-he-explosion.mjs');expect(script).toContain('tools/repair-usp-bleeding-edge.mjs');
    expect(script).toContain('tools/build-duel-flinches.mjs');expect(script).toContain('tools/build-brand-assets.mjs');
  });
});
