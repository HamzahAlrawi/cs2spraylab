export const UNIT = .0254;
export const DEG = Math.PI / 180;
export const STEP = 1 / 128;
export const GRAVITY = 800 * UNIT;
export const JUMP_SPEED = 301.993 * UNIT;
export const DUCK_SECONDS = 1 / 6.4;
export const UNDUCK_SECONDS = 1 / 6.4;

export type Vec = { x: number; y: number; z: number };
export type MoveInput = { forward: number; side: number; walk: boolean; crouch: boolean; jump: boolean };
export type ActorKinematics = {
  position: Vec;
  velocity: { x: number; z: number };
  yaw: number;
  feet: number;
  verticalVelocity: number;
  eyeHeight: number;
  duckAmount?: number;
  jumpHeld: boolean;
  grounded?: boolean;
};
export type ResolveMove = (from: Vec, desired: Vec, feet: number, height: number) => Vec;
export type CanOccupy = (position: Vec, feet: number, height: number) => boolean;
export type ResolveVertical = (position: Vec, from: number, to: number, height: number) =>
  {feet: number; grounded: boolean; ceiling: boolean};

export const idleInput = (): MoveInput => ({ forward: 0, side: 0, walk: false, crouch: false, jump: false });
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function groundVelocity(vx: number, vz: number, x: number, z: number, speed: number, dt: number) {
  const v = Math.hypot(vx, vz);
  if (v > 0) {
    const retained = Math.max(0, v - Math.max(v, 80 * UNIT) * 5.2 * dt) / v;
    vx *= retained; vz *= retained;
  }
  const length = Math.hypot(x, z);
  if (length > 0) {
    x /= length; z /= length;
    const add = Math.min(Math.max(0, speed - (vx * x + vz * z)), 5.5 * speed * dt);
    vx += x * add; vz += z * add;
  }
  return { x: vx, z: vz };
}

export function airVelocity(vx: number, vz: number, x: number, z: number, speed: number, dt: number) {
  const length = Math.hypot(x, z);
  if (!length) return { x: vx, z: vz };
  x /= length; z /= length;
  const add = Math.min(Math.max(0, Math.min(speed, 30 * UNIT) - vx * x - vz * z), 12 * speed * dt);
  return { x: vx + x * add, z: vz + z * add };
}

export function advanceActor(
  actor: ActorKinematics, input: MoveInput, runningSpeed: number, dt: number,
  resolve: ResolveMove = (_from, desired) => desired,
  canOccupy: CanOccupy = () => true,
  vertical: ResolveVertical = (_position, _from, to) => ({feet: Math.max(0, to), grounded: to <= 0, ceiling: false}),
): ActorKinematics {
  const { forward, side, walk, crouch, jump } = input;
  const currentDuck = actor.duckAmount ?? 0;
  const previousCurve = currentDuck * currentDuck * (3 - 2 * currentDuck);
  const supported = vertical(actor.position, actor.feet, actor.feet - .001, (72 - 18 * previousCurve) * UNIT).grounded;
  let verticalVelocity = actor.verticalVelocity;
  if (jump && !actor.jumpHeld && supported) verticalVelocity = JUMP_SPEED;
  const airborne = !supported || verticalVelocity > 0;
  let duckAmount = clamp(currentDuck + (crouch ? dt / DUCK_SECONDS : -dt / UNDUCK_SECONDS), 0, 1);
  let duckCurve = duckAmount * duckAmount * (3 - 2 * duckAmount);
  let feet = Math.max(0, actor.feet + (airborne ? (duckCurve - previousCurve) * 18 * UNIT : 0));
  // Releasing crouch requires room for the full standing hull, not just the
  // next interpolation step. In air the hull expands downwards.
  const standingFeet = Math.max(0, actor.feet - (airborne ? previousCurve * 18 * UNIT : 0));
  if (duckAmount < currentDuck && !canOccupy(actor.position, standingFeet, 72 * UNIT)) {
    duckAmount = currentDuck;
    duckCurve = previousCurve; feet = actor.feet;
  }
  const wishX = side * Math.cos(actor.yaw) - forward * Math.sin(actor.yaw);
  const wishZ = -side * Math.sin(actor.yaw) - forward * Math.cos(actor.yaw);
  const speed = runningSpeed * (duckAmount > 0 ? 1 - .66 * duckCurve : walk ? .52 : 1);
  const velocity = (airborne ? airVelocity : groundVelocity)(actor.velocity.x, actor.velocity.z, wishX, wishZ,
    airborne ? runningSpeed : speed, dt);
  const beforeVertical = feet;
  if (airborne) {
    feet += verticalVelocity * dt - GRAVITY * dt * dt / 2;
    verticalVelocity -= GRAVITY * dt;
  }
  const desired = { ...actor.position, x: actor.position.x + velocity.x * dt, z: actor.position.z + velocity.z * dt };
  const hullHeight = (72 - 18 * duckCurve) * UNIT;
  // Horizontal collision is evaluated at the pre-fall height so landing on an
  // edge does not get mistaken for walking into its side.
  const resolved = resolve(actor.position, desired, Math.max(beforeVertical, feet), hullHeight);
  const contact = vertical(resolved, beforeVertical, feet - (airborne ? 0 : .001), hullHeight);
  feet = contact.feet;
  if (contact.grounded || contact.ceiling) verticalVelocity = 0;
  if (resolved.x === actor.position.x) velocity.x = 0;
  if (resolved.z === actor.position.z) velocity.z = 0;
  const eyeHeight = (64 - 18 * duckCurve) * UNIT;
  return {
    position: { x: resolved.x, y: feet + eyeHeight, z: resolved.z }, velocity,
    yaw: actor.yaw, feet, verticalVelocity, eyeHeight, duckAmount, jumpHeld: jump, grounded: contact.grounded,
  };
}
