export type HitReactionRegion = 'head' | 'chest' | 'stomach' | 'arm' | 'leg';
type Vector = {x: number; y: number; z: number};
type JointOffset = {rotation: Vector; position: Vector};
export type HitReactionPose = {pelvis: JointOffset; spine: JointOffset; head: JointOffset};
export type HitReactionEvent = {
  time: number;
  region: HitReactionRegion;
  helmet?: boolean;
  /** Facing yaw at impact in radians, not the current render yaw. */
  actorYaw: number;
  /** World-space bullet TRAVEL direction, projected onto the ground plane. */
  incoming: {x: number; z: number};
};

/** Magnitude caps per joint: radians for rotation, metres for position. */
export const HIT_REACTION_LIMITS = {
  pelvis: {rotation: .035, position: .012},
  spine: {rotation: .10, position: .018},
  head: {rotation: .20, position: .012},
} as const;

// Presentation heuristics, NOT measured CS2 timings or physical impulses.
const profiles = {
  head: {pelvis: .004, spine: .025, head: .16, drop: 0, duration: .22},
  chest: {pelvis: .008, spine: .065, head: .028, drop: .002, duration: .18},
  stomach: {pelvis: .025, spine: .05, head: .018, drop: .004, duration: .19},
  arm: {pelvis: .004, spine: .04, head: .015, drop: 0, duration: .16},
  leg: {pelvis: .028, spine: .025, head: .012, drop: .008, duration: .20},
} as const;
const joints = ['pelvis', 'spine', 'head'] as const;
const zeroJoint = (): JointOffset => ({rotation: {x: 0, y: 0, z: 0}, position: {x: 0, y: 0, z: 0}});

function cap(vector: Vector, limit: number) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length <= limit) return;
  const scale = limit / length;
  vector.x *= scale; vector.y *= scale; vector.z *= scale;
}

/** Pure absolute-time sampler; event times and sample time are seconds on one clock.
 * Use only the current actor/life's events. Local axes: +X right, +Y up, +Z back;
 * yaw 0 faces world -Z. Rotations are small XYZ Euler deltas in this actor frame.
 * Parent maps them into bone axes and composes ONCE onto the fresh animated pose,
 * never onto last frame's result. Do not apply to root, camera aim or spread.
 * The shared skeleton remains the authority for both visible pose and hitboxes.
 * No state is retained: repeated, render-ahead and rewind queries cannot integrate.
 */
export function sampleHitReaction(hits: readonly HitReactionEvent[], time: number): HitReactionPose {
  const pose: HitReactionPose = {pelvis: zeroJoint(), spine: zeroJoint(), head: zeroJoint()};
  if (!Number.isFinite(time)) return pose;
  for (const hit of hits) {
    if (![hit.time, hit.actorYaw, hit.incoming.x, hit.incoming.z].every(Number.isFinite)) continue;
    const profile = profiles[hit.region];
    if (!profile) continue;
    const helmetedHead = hit.region === 'head' && hit.helmet;
    const duration = helmetedHead ? .16 : profile.duration;
    const age = time - hit.time;
    if (age < 0 || age >= duration) continue;
    const length = Math.hypot(hit.incoming.x, hit.incoming.z);
    if (!Number.isFinite(length) || length < 1e-8) continue;
    const dx = hit.incoming.x / length, dz = hit.incoming.z / length;
    const side = dx * Math.cos(hit.actorYaw) - dz * Math.sin(hit.actorYaw);
    const back = dx * Math.sin(hit.actorYaw) + dz * Math.cos(hit.actorYaw);
    // Nonzero on impact, then a fast decay with zero slope at the exact settle.
    const weight = (1 - age / duration) ** 2 * (helmetedHead ? .65 : 1);
    for (const joint of joints) {
      const angle = profile[joint] * weight, offset = pose[joint];
      offset.rotation.x += back * angle;
      offset.rotation.y += side * angle * (hit.region === 'arm' ? .6 : .15);
      offset.rotation.z -= side * angle;
      offset.position.x += side * angle * .06;
      offset.position.z += back * angle * .06;
    }
    pose.pelvis.position.y -= profile.drop * weight;
  }
  for (const joint of joints) {
    cap(pose[joint].rotation, HIT_REACTION_LIMITS[joint].rotation);
    cap(pose[joint].position, HIT_REACTION_LIMITS[joint].position);
  }
  return pose;
}
