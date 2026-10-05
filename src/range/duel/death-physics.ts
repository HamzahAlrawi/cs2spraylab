import {GRAVITY, type Vec} from '../actor-physics';

export type DeathBody = {name: string; position: Vec; radius: number; mass?: number};
export type DeathLink = {a: string; b: string};
export type DeathContact = {body: string; point: Vec; normal: Vec; speed: number; solid: number};
export type DeathBox = {center: Vec; size: Vec};
export type DeathWorld = {floor?: number; boxes?: readonly DeathBox[]; gravity?: number};
const axes = ['x', 'y', 'z'] as const;
const STEP = 1 / 120;

/** Cosmetic sphere/link PBD, deliberately independent of damage and live actor collision. */
export class DeathPhysics {
  readonly bodies: DeathBody[];
  readonly positions: Float64Array;
  private previous: Float64Array;
  private inverseMass: Float64Array;
  private links: {a: number; b: number; length: number}[];
  private accumulator = 0;
  private age = 0;
  private quiet = 0;
  private lastContacts = new Map<number, number>();
  sleeping = false;
  constructor(bodies: readonly DeathBody[], links: readonly DeathLink[], velocity: Vec = {x: 0, y: 0, z: 0}) {
    if (bodies.length > 24 || new Set(bodies.map(b => b.name)).size !== bodies.length ||
      bodies.some(b => !axes.every(a => Number.isFinite(b.position[a])) || !Number.isFinite(b.radius) || b.radius <= 0 ||
        b.mass !== undefined && (!Number.isFinite(b.mass) || b.mass <= 0)))
      throw new Error('Death bodies must be finite, unique, positive-radius and bounded to 24.');
    this.bodies = bodies.map(b => ({...b, position: {...b.position}}));
    this.positions = new Float64Array(bodies.flatMap(b => axes.map(a => b.position[a])));
    this.previous = this.positions.slice();
    this.inverseMass = new Float64Array(bodies.map(b => 1 / Math.max(.1, b.mass ?? 1)));
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z), cap = Number.isFinite(speed) ? Math.min(1, 8 / (speed || 1)) : 0;
    for (let i = 0; i < bodies.length; i++) for (let axis = 0; axis < 3; axis++)
      this.previous[i * 3 + axis] -= (cap ? velocity[axes[axis]] * cap : 0) * STEP;
    this.links = links.slice(0, 64).map(link => {
      const a = bodies.findIndex(b => b.name === link.a), b = bodies.findIndex(b => b.name === link.b);
      if (a < 0 || b < 0 || a === b) throw new Error('Death link endpoints must exist and differ.');
      return {a, b, length: Math.hypot(...axes.map((_, k) => this.positions[a * 3 + k] - this.positions[b * 3 + k]))};
    });
  }
  point(name: string): Vec | undefined {
    const i = this.bodies.findIndex(body => body.name === name) * 3;
    return i < 0 ? undefined : {x: this.positions[i], y: this.positions[i + 1], z: this.positions[i + 2]};
  }
  impulse(name: string, velocity: Vec) {
    const index = this.bodies.findIndex(body => body.name === name) * 3;
    if (index < 0 || !axes.every(a => Number.isFinite(velocity[a]))) return;
    for (let k = 0; k < 3; k++) this.previous[index + k] -= Math.max(-6, Math.min(6, velocity[axes[k]])) * STEP;
    this.sleeping = false; this.quiet = 0;
  }
  step(dt: number, world: DeathWorld = {}): DeathContact[] {
    if (this.sleeping || !Number.isFinite(dt) || dt <= 0) return [];
    this.accumulator = Math.min(this.accumulator + dt, STEP * 8);
    const contacts: DeathContact[] = [], boxes = world.boxes?.slice(0, 128) ?? [];
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator -= STEP; this.age += STEP;
      for (let i = 0; i < this.positions.length; i++) {
        const p = this.positions[i], delta = Math.max(-.08, Math.min(.08, (p - this.previous[i]) * .992));
        const gravity = Number.isFinite(world.gravity) && world.gravity! >= 0 ? world.gravity! : GRAVITY;
        this.previous[i] = p; this.positions[i] += delta - (i % 3 === 1 ? gravity * STEP * STEP : 0);
      }
      // Sweep before link relaxation, then project contacts after every iteration.
      for (let i = 0; i < this.bodies.length; i++) boxes.forEach((box, solid) => this.sweep(i, box, solid, contacts));
      for (let iteration = 0; iteration < 8; iteration++) {
        for (const link of this.links) {
          const a = link.a * 3, b = link.b * 3;
          const x = this.positions[b] - this.positions[a], y = this.positions[b + 1] - this.positions[a + 1],
            z = this.positions[b + 2] - this.positions[a + 2], length = Math.hypot(x, y, z);
          if (length < 1e-9) continue;
          const correction = (length - link.length) / length / (this.inverseMass[link.a] + this.inverseMass[link.b]);
          for (let k = 0; k < 3; k++) {
            const delta = [x, y, z][k] * correction;
            this.positions[a + k] += delta * this.inverseMass[link.a]; this.positions[b + k] -= delta * this.inverseMass[link.b];
          }
        }
        for (let i = 0; i < this.bodies.length; i++) {
          const at = i * 3, floor = (world.floor ?? 0) + this.bodies[i].radius;
          if (this.positions[at + 1] < floor) this.contact(i, 1, floor, -1, contacts);
          boxes.forEach((box, solid) => this.collide(i, box, solid, contacts));
        }
      }
      let motion = 0;
      for (let i = 0; i < this.positions.length; i++) motion = Math.max(motion, Math.abs(this.positions[i] - this.previous[i]) / STEP);
      this.quiet = motion < .045 ? this.quiet + STEP : 0;
      // Sleeping freezes a solved contact pose; it does not switch to a canned floor pose.
      if (this.quiet > .5 || this.age > 8) this.sleeping = true;
    }
    return contacts;
  }
  private contact(body: number, axis: number, value: number, solid: number, contacts: DeathContact[]) {
    const index = body * 3 + axis, speed = Math.abs(this.positions[index] - this.previous[index]) / STEP;
    const normal: Vec = {x: 0, y: 0, z: 0}; normal[axes[axis]] = value >= this.positions[index] ? 1 : -1;
    this.positions[index] = value; this.previous[index] = value;
    for (let k = 0; k < 3; k++) if (k !== axis) this.previous[body * 3 + k] += (this.positions[body * 3 + k] - this.previous[body * 3 + k]) * .18;
    if (speed > .6 && this.age - (this.lastContacts.get(body) ?? -Infinity) > .1) {
      this.lastContacts.set(body, this.age);
      const point = this.point(this.bodies[body].name)!;
      point[axes[axis]] -= normal[axes[axis]] * this.bodies[body].radius;
      contacts.push({body: this.bodies[body].name, point, normal, speed, solid});
    }
  }
  private collide(body: number, box: DeathBox, solid: number, contacts: DeathContact[]) {
    const at = body * 3, radius = this.bodies[body].radius;
    const x = this.positions[at], y = this.positions[at + 1], z = this.positions[at + 2];
    const minX = box.center.x - box.size.x / 2 - radius, maxX = box.center.x + box.size.x / 2 + radius;
    if (x >= maxX || x <= minX) return;
    const minY = box.center.y - box.size.y / 2 - radius, maxY = box.center.y + box.size.y / 2 + radius;
    if (y >= maxY || y <= minY) return;
    const minZ = box.center.z - box.size.z / 2 - radius, maxZ = box.center.z + box.size.z / 2 + radius;
    if (z >= maxZ || z <= minZ) return;
    // Same edge order and strict tie break as the array-based solver, without
    // allocating six bounds/edge arrays for every joint/box/relaxation pass.
    let axis = 0, value = minX, gap = Math.abs(minX - x);
    let d = Math.abs(maxX - x); if (d < gap) {value = maxX; gap = d;}
    d = Math.abs(minY - y); if (d < gap) {axis = 1; value = minY; gap = d;}
    d = Math.abs(maxY - y); if (d < gap) {axis = 1; value = maxY; gap = d;}
    d = Math.abs(minZ - z); if (d < gap) {axis = 2; value = minZ; gap = d;}
    d = Math.abs(maxZ - z); if (d < gap) {axis = 2; value = maxZ;}
    this.contact(body, axis, value, solid, contacts);
  }
  private sweep(body: number, box: DeathBox, solid: number, contacts: DeathContact[]) {
    const at = body * 3, radius = this.bodies[body].radius;
    let near = 0, far = 1, hitAxis = -1, edge = 0;
    for (let k = 0; k < 3; k++) {
      const min = box.center[axes[k]] - box.size[axes[k]] / 2 - radius, max = min + box.size[axes[k]] + radius * 2;
      const from = this.previous[at + k], d = this.positions[at + k] - from;
      if (Math.abs(d) < 1e-9) {if (from < min || from > max) return; continue;}
      const a = (min - from) / d, b = (max - from) / d, enter = Math.min(a, b);
      if (enter > near) {near = enter; hitAxis = k; edge = d > 0 ? min : max;}
      far = Math.min(far, Math.max(a, b)); if (near > far) return;
    }
    if (hitAxis >= 0 && near >= 0 && near <= 1) {
      this.contact(body, hitAxis, edge, solid, contacts);
    }
  }
}

export const skeletalDeathLinks: DeathLink[] = [
  ['pelvis', 'spine_2'], ['spine_2', 'head_0'],
  ['spine_2', 'arm_upper_L'], ['arm_upper_L', 'arm_lower_L'], ['arm_lower_L', 'hand_L'],
  ['spine_2', 'arm_upper_R'], ['arm_upper_R', 'arm_lower_R'], ['arm_lower_R', 'hand_R'],
  ['pelvis', 'leg_lower_L'], ['leg_lower_L', 'ankle_L'], ['pelvis', 'leg_lower_R'], ['leg_lower_R', 'ankle_R'],
  ['arm_upper_L', 'arm_upper_R'], ['pelvis', 'arm_upper_L'], ['pelvis', 'arm_upper_R'],
].map(([a, b]) => ({a, b}));
