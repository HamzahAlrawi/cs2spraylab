import fs from 'node:fs';
import crypto from 'node:crypto';
import {Matrix4, Quaternion, Vector3} from 'three';

const data = JSON.parse(fs.readFileSync('src/range/game-data.json'));
const mounts = {};
for (const id of Object.keys(data.weapons)) {
  const file = `research/raw-models/${id}-rigged.glb`, bytes = fs.readFileSync(file);
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  const index = document.nodes.findIndex(node => node.name === 'weapon');
  if (index < 0) throw new Error(`${id}: native weapon root absent`);
  const matrix = at => {
    const node = document.nodes[at];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3().fromArray(node.translation ?? [0, 0, 0]), new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new Vector3().fromArray(node.scale ?? [1, 1, 1]));
    const parent = document.nodes.findIndex(candidate => candidate.children?.includes(at));
    return parent < 0 ? local : matrix(parent).multiply(local);
  };
  const bind = matrix(index);
  if (!Number.isFinite(bind.determinant()) || Math.abs(bind.determinant()) < .01) throw new Error(`${id}: invalid native root`);
  mounts[id] = {inverseBind: bind.invert().toArray(), sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex')};
  if (id === 'elite') {
    const left = document.nodes.findIndex(node => node.name === 'weapon_hand_l');
    const right = document.nodes.findIndex(node => node.name === 'weapon_hand_r');
    if (left < 0 || right < 0) throw new Error('Dual Berettas native hand anchors missing');
    mounts[id].leftGripOffset = new Vector3().setFromMatrixPosition(bind.clone().multiply(matrix(left)))
      .sub(new Vector3().setFromMatrixPosition(bind.clone().multiply(matrix(right)))).toArray();
  }
}
fs.writeFileSync('src/range/weapon-mounts.json', JSON.stringify({source: 'Native model weapon-root bind transforms', mounts}, null, 2) + '\n');
console.log(`Extracted ${Object.keys(mounts).length} native world-weapon attachment transforms`);
