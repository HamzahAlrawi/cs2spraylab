import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativePaintInputs, isMissingTexturePixels} from '../cosmetic-paint.mjs';

const variables = () => [
  ...[[211,69,67],[84,38,38],[94,94,94],[64,44,44]].map((color,i) => ({m_strName:`g_vColor${i}`,m_cValueColor4:color})),
  {m_strName:'g_bUsePaintByNumberMasks',m_bValueBoolean:true},
  {m_strName:'g_bOverrideDefaultMasks',m_bValueBoolean:true},
  {m_strName:'g_tPaintByNumberMasks',m_strTextureRuntimeResourcePath:'native-mask.vtex'},
  {m_strName:'g_tPattern',m_strTextureRuntimeResourcePath:'unused-pattern.vtex'},
];
test('reads Color4 as byte colors and keeps native UV mask distinct from the pattern', () => {
  const inputs = nativePaintInputs({nested:{variables:variables()}});
  assert.deepEqual(inputs.colors[0], [211/255,69/255,67/255]);
  assert.equal(inputs.paintByNumberTexture,'native-mask.vtex');
  assert.equal(inputs.texture,'unused-pattern.vtex');
});
test('rejects incomplete and null paint-by-number palettes', () => {
  const v = variables(); v[0].m_cValueColor4 = [null,null,null];
  assert.throws(() => nativePaintInputs({v}), /Invalid native paint palette/);
  assert.throws(() => nativePaintInputs({v:variables().slice(1)}), /Incomplete/);
});
test('does not select override masks when their native conditions are disabled', () => {
  const v = variables(); v[4].m_bValueBoolean = false;
  assert.equal(nativePaintInputs({v}).paintByNumberTexture,undefined);
});
test('detects the solid magenta export without rejecting real red paint or yellow masks', () => {
  assert.equal(isMissingTexturePixels(Uint8Array.from([255,0,255,255,255,0,255,255])),true);
  assert.equal(isMissingTexturePixels(Uint8Array.from([211,69,67,255,255,255,0,255])),false);
  assert.throws(() => isMissingTexturePixels(new Uint8Array(3)),/RGBA/);
});
