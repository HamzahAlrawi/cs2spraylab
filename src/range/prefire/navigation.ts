import type {Vec} from '../actor-physics';

export type RouteNavigation = {waypoint: number; total: number; distance: number; bearing: number;
  complete: boolean; destination: string; guidance?: 'off-route' | 'wrong-level'};

const ARRIVAL_RADIUS = .35;
const HEIGHT_TOLERANCE = .7;
const ROUTE_MARGIN = 2;

function project(point: Vec, from: Vec, to: Vec, minimum = 0) {
  const dx = to.x - from.x, dz = to.z - from.z, lengthSquared = dx * dx + dz * dz;
  const fraction = Math.max(minimum, Math.min(1, lengthSquared
    ? ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared : 1));
  return {fraction, position: {x: from.x + dx * fraction, y: from.y + (to.y - from.y) * fraction, z: from.z + dz * fraction}};
}

/** Ordered checkpoints, never hidden enemy coordinates or nearest-segment shortcuts. */
export class PrefireNavigator {
  private index = 0;
  private previous?: Vec;
  private start?: Vec;
  constructor(private readonly points: readonly Vec[], private readonly destination: string) {}
  update(position: Vec, yaw: number): RouteNavigation {
    const previous = this.previous;
    this.previous = {...position};
    this.start ??= {...position};
    const continuous = previous && Math.hypot(position.x - previous.x, position.y - previous.y, position.z - previous.z) < 2;
    let passed = 0;
    while (this.index < this.points.length) {
      const target = this.points[this.index];
      // Reuse only the still-untraversed part of this report, never a point passed before the last checkpoint.
      const reached = continuous ? project(target, previous!, position, passed) : {fraction: 1, position};
      if (Math.hypot(reached.position.x - target.x, reached.position.z - target.z) > ARRIVAL_RADIUS ||
        Math.abs(reached.position.y - target.y) > HEIGHT_TOLERANCE) break;
      passed = reached.fraction;
      this.index++;
    }
    const complete = this.index === this.points.length;
    const target = this.points[this.index] ?? position;
    const distance = Math.hypot(target.x - position.x, target.z - position.z);
    const nearest = project(position, this.points[this.index - 1] ?? this.start, target).position;
    const guidance = complete ? undefined : distance <= ARRIVAL_RADIUS && Math.abs(position.y - target.y) > HEIGHT_TOLERANCE
      ? 'wrong-level' : Math.hypot(position.x - nearest.x, position.z - nearest.z) > ROUTE_MARGIN ? 'off-route' : undefined;
    const heading = Math.atan2(-(target.x - position.x), -(target.z - position.z));
    return {waypoint: Math.min(this.index + 1, this.points.length), total: this.points.length,
      distance, bearing: complete || guidance ? 0 : Math.atan2(Math.sin(yaw - heading), Math.cos(yaw - heading)),
      complete, destination: this.destination, guidance};
  }
}
