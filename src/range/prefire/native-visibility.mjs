// Source 2 VXVS layout reference: Source 2 Viewer (MIT), see data/VRF.LICENSE.txt.
// Conservative queries fail open rather than erase a playable space.
export class NativeVisibility {
  constructor(metadata, bytes) {
    this.metadata = metadata;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const blocks = [['m_NodeBlock', 8], ['m_RegionBlock', 8], ['m_MasksBlock', 8], ['m_nVisBlocks', 1]];
    for (const [name, size] of blocks) {
      const b = metadata[name];
      if (!b || !Number.isInteger(b.m_nOffset) || !Number.isInteger(b.m_nElementCount) || b.m_nOffset < 0 || b.m_nElementCount < 0 ||
          b.m_nOffset + b.m_nElementCount * size > bytes.byteLength) throw new Error(`Invalid native visibility block ${name}`);
    }
    if (metadata.m_nBaseClusterCount < 1 || metadata.m_nBaseClusterCount > 32768 ||
        metadata.m_nPVSBytesPerCluster < Math.ceil(metadata.m_nBaseClusterCount / 8) ||
        metadata.m_nVisBlocks.m_nElementCount < metadata.m_nBaseClusterCount * metadata.m_nPVSBytesPerCluster) throw new Error('Invalid native visibility rows');
    this.view = view;
    this.row = new Uint8Array(metadata.m_nPVSBytesPerCluster);
    this.key = '';
  }
  node(index) {
    const block = this.metadata.m_NodeBlock;
    if (index >= block.m_nElementCount) return null;
    const offset = block.m_nOffset + index * 8;
    const first = this.view.getUint32(offset, true), second = this.view.getUint32(offset + 4, true);
    return {leaf: !!(first & 1), offset: first >>> 1, count: second & 255};
  }
  region(index) {
    const block = this.metadata.m_RegionBlock;
    if (index >= block.m_nElementCount) return null;
    const offset = block.m_nOffset + index * 8;
    const cluster = this.view.getUint32(offset, true) & 0x7fff, mask = this.view.getUint32(offset + 4, true) >>> 8;
    if (mask >= this.metadata.m_MasksBlock.m_nElementCount) return null;
    const at = this.metadata.m_MasksBlock.m_nOffset + mask * 8;
    return {cluster, lo: this.view.getUint32(at, true), hi: this.view.getUint32(at + 4, true)};
  }
  pointRow(point) {
    let min = [...this.metadata.m_vMinBounds], max = [...this.metadata.m_vMaxBounds], index = 0;
    if (point.some((v, i) => !Number.isFinite(v) || v < min[i] || v > max[i])) return this.allVisible();
    let node;
    for (let depth = 0; depth < 32; depth++) {
      node = this.node(index);
      if (!node) return this.allVisible();
      if (node.leaf) break;
      let octant = 0;
      for (let axis = 0; axis < 3; axis++) {
        const mid = (min[axis] + max[axis]) / 2;
        if (point[axis] > mid) {octant |= 1 << axis; min[axis] = mid;} else max[axis] = mid;
      }
      index = node.offset + octant;
    }
    if (!node?.leaf) return this.allVisible();
    const cell = point.map((v, axis) => Math.max(0, Math.min(3, Math.ceil((v - min[axis]) / (max[axis] - min[axis]) * 4) - 1)));
    const bit = cell[0] + 4 * cell[1] + 16 * cell[2], key = `${index}:${bit}`;
    if (key === this.key) return this.row;
    this.key = key; this.row.fill(0);
    let found = false;
    for (let i = 0; i < node.count; i++) {
      const region = this.region(node.offset + i);
      if (!region || region.cluster >= this.metadata.m_nBaseClusterCount || !((bit < 32 ? region.lo : region.hi) & (1 << (bit & 31)))) continue;
      const offset = this.metadata.m_nVisBlocks.m_nOffset + region.cluster * this.row.length;
      for (let b = 0; b < this.row.length; b++) this.row[b] |= this.view.getUint8(offset + b);
      found = true;
    }
    if (!found) this.row.fill(255);
    return this.row;
  }
  allVisible() {this.key = ''; this.row.fill(255); return this.row;}
  boxClusters(inputMin, inputMax) {
    const epsilon = 1 / 32;
    const bmin = inputMin.map((v, i) => Math.min(v, inputMax[i]) - epsilon);
    const bmax = inputMax.map((v, i) => Math.max(v, inputMax[i]) + epsilon);
    if ([...bmin, ...bmax].some(v => !Number.isFinite(v))) return [0];
    const clusters = new Set();
    const visit = (index, min, max, depth) => {
      if (depth > 32 || min.some((v, i) => v > bmax[i] || max[i] < bmin[i])) return;
      const node = this.node(index); if (!node) return;
      if (node.leaf) {
        let lo = 0, hi = 0;
        for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
          const cell = [x, y, z];
          if (cell.some((c, axis) => {
            const size = (max[axis] - min[axis]) / 4, start = min[axis] + c * size;
            return start >= bmax[axis] || bmin[axis] >= start + size;
          })) continue;
          const bit = x + 4 * y + 16 * z;
          if (bit < 32) lo |= 1 << bit; else hi |= 1 << (bit - 32);
        }
        for (let i = 0; i < node.count; i++) {
          const region = this.region(node.offset + i);
          if (region && ((lo & region.lo) || (hi & region.hi)) && region.cluster < this.metadata.m_nBaseClusterCount) clusters.add(region.cluster);
        }
        return;
      }
      const mid = min.map((v, i) => (v + max[i]) / 2);
      for (let octant = 0; octant < 8; octant++) {
        const childMin = min.map((v, i) => octant & (1 << i) ? mid[i] : v);
        const childMax = max.map((v, i) => octant & (1 << i) ? v : mid[i]);
        visit(node.offset + octant, childMin, childMax, depth + 1);
      }
    };
    visit(0, this.metadata.m_vMinBounds, this.metadata.m_vMaxBounds, 0);
    return clusters.size ? [...clusters].sort((a, b) => a - b) : [0];
  }
  static visible(clusters, row) {return clusters.includes(0) || clusters.some(cluster => !!(row[cluster >>> 3] & (1 << (cluster & 7))));}
}
