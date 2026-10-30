import {advanceActor, idleInput, STEP, UNIT, type ActorKinematics, type Vec} from '../actor-physics';
import {moveOnTerrain} from '../actor-collision';
import type {NativeMapCollision} from './native-collision';
import {placePrefireTarget} from './placement';
import type {SourcePoint} from './schema';

type Collision = Pick<NativeMapCollision, 'ray' | 'vertical' | 'fits' | 'sweep'>;

export function prefireUpperBodyExtrema(feet: Vec, crouched = false): Vec[] {
  const samples: Vec[] = [], duck = crouched ? 18 : 0;
  for (const [radius, bottom, top] of [[20, 34, 58], [8, 58, 72]]) {
    for (const y of [bottom, top]) for (const x of [-radius, 0, radius]) for (const z of [-radius, 0, radius]) {
      samples.push({x: feet.x + x * UNIT, y: feet.y + (y - duck) * UNIT, z: feet.z + z * UNIT});
    }
  }
  return samples;
}

// Conservative, orientation-independent envelopes include both shoulders and
// the crown, not just the analytic head/chest centers. Four-unit surface spacing
// catches narrow corner slivers; the torso extends beyond the movement hull.
export function prefireUpperBodySamples(feet: Vec, crouched = false): Vec[] {
  const samples: Vec[] = [], duck = crouched ? 18 : 0;
  for (const [radius, bottom, top] of [[20, 34, 58], [8, 58, 72]]) {
    for (let x = -radius; x <= radius; x += 4) for (let z = -radius; z <= radius; z += 4) {
      for (let y = bottom; y <= top; y += 2) {
        if (Math.abs(x) !== radius && Math.abs(z) !== radius && y !== bottom && y !== top) continue;
        samples.push({x: feet.x + x * UNIT, y: feet.y + (y - duck) * UNIT, z: feet.z + z * UNIT});
      }
    }
  }
  samples.push({...feet, y: feet.y + (64 - duck) * UNIT}, {...feet, y: feet.y + (48 - duck) * UNIT});
  return samples;
}

export function nativeSightBlocked(collision: Pick<Collision, 'ray'>, eye: Vec, sample: Vec) {
  const d = Math.hypot(sample.x - eye.x, sample.y - eye.y, sample.z - eye.z);
  if (d < 1e-6) return false;
  // Do not count the target's own wall contact as cover. This uses the native
  // shot mask, so invisible playerclip/passbullet volumes cannot hide a bot.
  const hit = collision.ray(eye, {x: (sample.x - eye.x) / d, y: (sample.y - eye.y) / d, z: (sample.z - eye.z) / d}, d);
  return !!hit && hit.distance > 1e-4 && hit.distance < d - UNIT;
}

export function prefireSpawnEyes(feet: Vec): Vec[] {
  // Include the crouch transition and a small horizontal safety margin against
  // a single exposed shoulder at a corner. Camera yaw is deliberately absent.
  return [46, 52, 58, 64].flatMap(height => [[0, 0], [-4, 0], [4, 0], [0, -4], [0, 4]].map(([x, z]) =>
    ({x: feet.x + x * UNIT, y: feet.y + height * UNIT, z: feet.z + z * UNIT})));
}

export function prefireBodyExposed(collision: Pick<Collision, 'ray'>, eyes: readonly Vec[],
  bodies: readonly (readonly Vec[])[]): boolean {
  for (const body of bodies) for (const eye of eyes) for (const sample of body) {
    if (!nativeSightBlocked(collision, eye, sample)) return true;
  }
  return false;
}

export function walkPrefireAuditPath(collision: NativeMapCollision, points: readonly SourcePoint[], crouched = false): Vec[] {
  const height = (crouched ? 54 : 72) * UNIT, world = {floor: null, solids: [], native: collision};
  let p = placePrefireTarget(collision, points[0], crouched);
  const walked = [{...p}];
  for (const point of points.slice(1)) {
    const target = placePrefireTarget(collision, point, crouched);
    let tick = 0;
    while (Math.hypot(target.x - p.x, target.z - p.z) > .025 && tick++ < 2400) {
      const d = Math.hypot(target.x - p.x, target.z - p.z), step = Math.min(d, .05);
      const requested = {...p, x: p.x + (target.x - p.x) / d * step, z: p.z + (target.z - p.z) / d * step};
      const moved = moveOnTerrain(p, requested, height, world, true), next = moved.position;
      // Match placement's six-unit same-floor tolerance at overlapping native
      // triangles. Test clearance at the queried support, not a float32 seam.
      const support = collision.vertical(next, next.y + 6 * UNIT, next.y - 6 * UNIT, height);
      if (!moved.grounded || !support.grounded || !collision.fits(next, support.feet, height)) {
        throw new Error(`Unsupported or embedded route step toward ${point.join(',')}`);
      }
      if (Math.hypot(next.x - p.x, next.z - p.z) < .0001) break;
      p = next;
      walked.push({...p});
    }
    if (Math.hypot(target.x - p.x, target.z - p.z) > .05 || Math.abs(target.y - p.y) > .05) {
      throw new Error(`Blocked walking segment toward ${point.join(',')}`);
    }
  }
  return walked;
}

export function auditPrefireMotorPath(collision: NativeMapCollision, points: readonly SourcePoint[]) {
  const feet = placePrefireTarget(collision, points[0]), world = {floor: null, solids: [], native: collision};
  let actor: ActorKinematics = {position: {...feet, y: feet.y + 64 * UNIT}, velocity: {x: 0, z: 0}, yaw: 0,
    feet: feet.y, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true};
  for (const point of points.slice(1)) {
    const target = placePrefireTarget(collision, point), gap = () => Math.hypot(target.x - actor.position.x, target.z - actor.position.z);
    const budget = Math.ceil(gap() / (215 * UNIT) / STEP) + 128;
    for (let tick = 0; tick < budget && gap() > .16; tick++) {
      actor.yaw = Math.atan2(-(target.x - actor.position.x), -(target.z - actor.position.z));
      actor = advanceActor(actor, {...idleInput(), forward: 1}, 215 * UNIT, STEP, undefined, undefined, undefined, world);
      if (!actor.grounded) throw new Error(`Airborne full-speed route step toward ${point.join(',')}`);
    }
    if (gap() > .16) throw new Error(`Full-speed motor stalled toward ${point.join(',')}`);
  }
}
