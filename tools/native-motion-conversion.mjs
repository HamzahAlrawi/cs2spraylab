import {Quaternion, Vector3} from 'three';

// Reverse VRF's ModelExtract.NmSkeleton DMX fixup, then apply its glTF
// BakeConversion. Children inherit root rotation; only translations use meters.
const fixup = new Quaternion(-.5, -.5, -.5, .5);
const inverse = fixup.clone().invert();
export function convertMotion(channel) {
  const path = channel.path === 'position' ? 'translation' : 'rotation';
  return {...channel, path, values: channel.values.map(value => {
    if (path === 'translation') {
      const v = new Vector3(...value);
      if (channel.parent === 'root_motion') v.applyQuaternion(inverse);
      if (!channel.parent) v.applyQuaternion(fixup);
      return v.multiplyScalar(.0254).toArray();
    }
    const q = new Quaternion(...value);
    if (channel.bone === 'root_motion') q.multiply(fixup);
    if (channel.parent === 'root_motion') q.premultiply(inverse);
    if (!channel.parent) q.premultiply(fixup);
    return q.normalize().toArray();
  })};
}
