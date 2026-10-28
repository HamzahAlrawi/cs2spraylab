import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {NativeVisibility} from './native-visibility.mjs';
import {prefireRoutes, sourcePoint} from './routes';

function fixture() {
  const bytes = new Uint8Array(8 + 16 + 16 + 3), view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true); view.setUint32(4, 2, true);
  view.setUint32(8, 1, true); view.setUint32(12, 0, true);
  view.setUint32(16, 2, true); view.setUint32(20, 1 << 8, true);
  view.setUint32(24, 0x0000ffff, true); view.setUint32(28, 0, true);
  view.setUint32(32, 0, true); view.setUint32(36, 0xffffffff, true);
  bytes.set([1, 3, 5], 40);
  return new NativeVisibility({m_vMinBounds: [0, 0, 0], m_vMaxBounds: [4, 4, 4], m_nBaseClusterCount: 3,
    m_nPVSBytesPerCluster: 1, m_NodeBlock: {m_nOffset: 0, m_nElementCount: 1},
    m_RegionBlock: {m_nOffset: 8, m_nElementCount: 2}, m_MasksBlock: {m_nOffset: 24, m_nElementCount: 2},
    m_nVisBlocks: {m_nOffset: 40, m_nElementCount: 3}}, bytes);
}
describe('native VXVS visibility', () => {
  it('reads masked regions and switches rows, including upper-half 64-bit occupancy', () => {
    const vis = fixture();
    expect([...vis.pointRow([.5, .5, .5])]).toEqual([3]);
    expect(NativeVisibility.visible([1], vis.row)).toBe(true);
    expect(NativeVisibility.visible([2], vis.row)).toBe(false);
    expect([...vis.pointRow([.5, .5, 3.5])]).toEqual([5]);
    expect(NativeVisibility.visible([2], vis.row)).toBe(true);
    expect(NativeVisibility.visible([1], vis.row)).toBe(false);
  });
  it('fails open in solid/unmapped/outside space and never hides catch-all geometry', () => {
    const vis = fixture();
    expect([...vis.pointRow([.5, .5, 1.5])]).toEqual([255]);
    expect([...vis.pointRow([-1, 2, 2])]).toEqual([255]);
    expect(NativeVisibility.visible([0], new Uint8Array([0]))).toBe(true);
  });
  it('maps boxes conservatively across occupied cells and regions', () => {
    const vis = fixture();
    expect(vis.boxClusters([.1, .1, .1], [.9, .9, .9])).toEqual([1]);
    expect(vis.boxClusters([.1, .1, 3.1], [.9, .9, 3.9])).toEqual([2]);
    expect(vis.boxClusters([.1, .1, .1], [3.9, 3.9, 3.9])).toEqual([1, 2]);
    expect(vis.boxClusters([20, 20, 20], [30, 30, 30])).toEqual([0]);
  });
  it('rejects malformed byte offsets and incomplete rows', () => {
    expect(() => new NativeVisibility({...fixture().metadata, m_NodeBlock: {m_nOffset: 100, m_nElementCount: 1}}, new Uint8Array(43))).toThrow('Invalid native visibility');
  });
});

describe.skipIf(!fs.existsSync('public/revamp/maps/dust2/visibility.bin'))('installed Dust 2 visibility', () => {
  it('has a bounded nonempty native row at every standing and crouched practice position', () => {
    const base = 'public/revamp/maps/dust2';
    const visibility = new NativeVisibility(JSON.parse(fs.readFileSync(`${base}/visibility.json`, 'utf8')), fs.readFileSync(`${base}/visibility.bin`));
    for (const route of prefireRoutes) for (const point of [route.spawn, ...route.path, ...route.angles.map(angle => angle.position)]) {
      const p = sourcePoint(point), row = visibility.pointRow([p.x / .0254, -p.z / .0254, p.y / .0254 + 64]);
      expect(row.length).toBe(512);
      expect(row.some(byte => byte !== 0)).toBe(true);
    }
  });
});
