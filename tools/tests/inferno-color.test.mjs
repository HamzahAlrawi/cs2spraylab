import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tintInfernoPixels} from '../inferno-color.mjs';

const gradient = [{m_flPosition: 0, m_Color: [0, 0, 0]}, {m_flPosition: .5, m_Color: [210, 92, 29]}, {m_flPosition: 1, m_Color: [255, 255, 255]}];
test('red-hot texture does not incorrectly address the white end of the ramp', () => {
  const result = tintInfernoPixels(new Uint8Array([255, 100, 10, 128]), gradient, .5);
  assert(result[0] > 190); assert(result[1] < 100); assert(result[2] < 10);
  assert.equal(result[3], 96);
});
test('zero-weight multiply preserves source and full white remains white', () => {
  assert.deepEqual(tintInfernoPixels(new Uint8Array([190, 80, 20, 128]), gradient, 0), new Uint8Array([190, 80, 20, 128]));
  assert.deepEqual(tintInfernoPixels(new Uint8Array([255, 255, 255, 255]), gradient, .5), new Uint8Array([255, 255, 255, 255]));
});
