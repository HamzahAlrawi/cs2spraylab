import type {Vec} from '../actor-physics';
import type {CoverLane} from './geometry';

// Authored excursions can sit exactly on an angular threshold; rigid
// transforms must not change their role through floating-point roundoff.
const epsilon = 1e-8;

// side is a peek label, not a world-space hemisphere. Native openings face
// their authored watch; generated openings share a cover-relative role center.
export function laneThreatAlignment(lane: CoverLane, threat: Vec, lanes: readonly CoverLane[]): -1 | 0 | 1 {
  let origin = lane.edge, dx: number, dz: number;
  if (lane.watch) {
    dx = lane.watch.x - origin.x; dz = lane.watch.z - origin.z;
  } else {
    const peers = lanes.filter(peer => peer.role === lane.role);
    if (!peers.length) return 0;
    origin = {x: peers.reduce((sum, peer) => sum + peer.edge.x, 0) / peers.length,
      y: 0, z: peers.reduce((sum, peer) => sum + peer.edge.z, 0) / peers.length};
    dx = lane.edge.x - origin.x; dz = lane.edge.z - origin.z;
  }
  const tx = threat.x - origin.x, tz = threat.z - origin.z;
  const scale = Math.hypot(dx, dz) * Math.hypot(tx, tz);
  if (scale < epsilon) return 0;
  const dot = (dx * tx + dz * tz) / scale;
  return Math.abs(dot) < epsilon ? 0 : dot > 0 ? 1 : -1;
}

export function nativeLaneRole(lane: CoverLane, route: readonly Vec[]): NonNullable<CoverLane['role']> {
  if (!lane.watch) return 'camp';
  const watch = lane.watch;
  let best = Infinity, tangent: {x: number; z: number} | undefined;
  // Use the incoming segment at a route vertex, ignoring duplicate views.
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1], dx = route[i].x - from.x, dz = route[i].z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((watch.x - from.x) * dx + (watch.z - from.z) * dz) / (length * length)));
    const gap = Math.hypot(watch.x - from.x - t * dx, watch.z - from.z - t * dz);
    if (gap < best - epsilon) {best = gap; tangent = {x: dx / length, z: dz / length};}
  }
  if (!tangent) return 'camp';
  const dx = lane.edge.x - watch.x, dz = lane.edge.z - watch.z, range = Math.hypot(dx, dz);
  if (range < .15 - epsilon) return 'camp';
  const along = dx * tangent.x + dz * tangent.z;
  // Behind the watched approach: a rear ambush, not an ordinary frontal hold.
  if (along < -Math.max(.75, range * .25) - epsilon) return 'flank';
  const px = lane.edge.x - lane.anchor.x, pz = lane.edge.z - lane.anchor.z;
  const travel = Math.hypot(px, pz), advance = -(px * dx + pz * dz) / range;
  // Entry takes space toward the route; a sideways cover peek is not entry.
  if (advance >= .35 - epsilon && advance >= travel * .5 - epsilon) return 'entry';
  // A side-on sightline (>45 degrees from the approach), at least 1m wide.
  const lateral = Math.abs(dx * tangent.z - dz * tangent.x);
  if (lateral > Math.max(1, Math.abs(along)) + epsilon) return 'offAngle';
  return 'camp';
}
