export const UNIT = .0254;
export const DEG = Math.PI / 180;
export const STEP = 1 / 128;
export const GRAVITY = 800 * UNIT;
export const JUMP_SPEED = 301.993 * UNIT;
export const DUCK_SECONDS = 1 / 6.4;
export const UNDUCK_SECONDS = 1 / 8;

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
  duckSpeed?: number;
  crouchHeld?: boolean;
  duckCooldown?: number;
  duckRecoveryOrigin?: {x: number; z: number};
  jumpHeld: boolean;
  grounded?: boolean;
  velocityModifier?: number;
};
export type ResolveMove = (from: Vec, desired: Vec, feet: number, height: number) => Vec;
export type CanOccupy = (position: Vec, feet: number, height: number) => boolean;
export type ResolveVertical = (position: Vec, from: number, to: number, height: number) =>
  {feet: number; grounded: boolean; ceiling: boolean};

export const idleInput = (): MoveInput => ({ forward: 0, side: 0, walk: false, crouch: false, jump: false });
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const stanceCurve = (amount: number) => amount * amount * (3 - 2 * amount);

type GroundStance = {weaponSpeed: number; ducking: boolean; walking: boolean};

// Build 2000919, server Accelerate (RVA ab1ff0): wish-speed and acceleration
// speed are different, especially while ducking, walking or damage-tagged.
export function accelerateGround(
  vx: number, vz: number, x: number, z: number, wishSpeed: number, dt: number,
  {weaponSpeed, ducking, walking}: GroundStance = {weaponSpeed: wishSpeed, ducking: false, walking: false},
) {
  const length = Math.hypot(x, z);
  if (!length) return {x: vx, z: vz};
  x /= length; z /= length;
  const current = vx * x + vz * z;
  const base = Math.max(250 * UNIT, wishSpeed);
  const weaponScale = Math.min(1, weaponSpeed / (250 * UNIT));
  const accelerationSpeed = base * (ducking ? .34 : walking ? .52 : weaponScale);
  const walkCap = base * weaponScale * .52;
  const taper = walking && !ducking ? clamp((walkCap - Math.max(0, current)) / (5 * UNIT), 0, 1) : 1;
  const add = Math.min(Math.max(0, wishSpeed - current), 5.5 * accelerationSpeed * taper * dt);
  return {x: vx + x * add, z: vz + z * add};
}

export function groundVelocity(vx: number, vz: number, x: number, z: number, speed: number, dt: number, stance?: GroundStance) {
  const v = Math.hypot(vx, vz);
  if (v > 0) {
    const retained = Math.max(0, v - Math.max(v, 80 * UNIT) * 5.2 * dt) / v;
    vx *= retained; vz *= retained;
  }
  return accelerateGround(vx, vz, x, z, speed, dt, stance);
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
  // Native CheckParameters consumes 2 on BOTH input edges; Duck recovers 3/s
  // to 8, with an extra 6/s after travelling 64 units outside a transition.
  let duckSpeed = Math.min(8, Math.max(0, (actor.duckSpeed ?? 8) - (crouch !== (actor.crouchHeld ?? false) ? 2 : 0)) + 3 * dt);
  let duckRecoveryOrigin = actor.duckRecoveryOrigin ?? {x: actor.position.x, z: actor.position.z};
  if (duckSpeed >= 8) duckRecoveryOrigin = {x: actor.position.x, z: actor.position.z};
  else if ((currentDuck === 0 || currentDuck === 1) &&
    Math.hypot(actor.position.x - duckRecoveryOrigin.x, actor.position.z - duckRecoveryOrigin.z) > 64 * UNIT) {
    duckSpeed = Math.min(8, duckSpeed + 6 * dt);
  }
  let duckCooldown = Math.max(0, (actor.duckCooldown ?? 0) - dt);
  const wantsDuck = crouch && duckSpeed >= 1.5 && (duckCooldown === 0 || currentDuck >= .75);
  const previousCurve = stanceCurve(currentDuck);
  const supported = vertical(actor.position, actor.feet, actor.feet - .001, (72 - 18 * previousCurve) * UNIT).grounded;
  let verticalVelocity = actor.verticalVelocity;
  if (jump && !actor.jumpHeld && supported) verticalVelocity = JUMP_SPEED;
  const airborne = !supported || verticalVelocity > 0;
  let duckAmount = clamp(currentDuck + (wantsDuck ? .8 * duckSpeed : -Math.max(1.5, duckSpeed)) * dt, 0, 1);
  let duckCurve = stanceCurve(duckAmount);
  let feet = Math.max(0, actor.feet + (airborne ? (duckCurve - previousCurve) * 18 * UNIT : 0));
  // Releasing crouch requires room for the full standing hull, not just the
  // next interpolation step. In air the hull expands downwards.
  const standingFeet = Math.max(0, actor.feet - (airborne ? previousCurve * 18 * UNIT : 0));
  if (duckAmount < currentDuck && !canOccupy(actor.position, standingFeet, 72 * UNIT)) {
    duckAmount = currentDuck;
    duckCurve = previousCurve; feet = actor.feet;
  }
  if (duckAmount === 1 && currentDuck < 1) duckCooldown = .4;
  const wishX = side * Math.cos(actor.yaw) - forward * Math.sin(actor.yaw);
  const wishZ = -side * Math.sin(actor.yaw) - forward * Math.cos(actor.yaw);
  const tag = clamp(actor.velocityModifier ?? 1, 0, 1);
  const ducking = crouch || duckAmount > 0;
  const speed = runningSpeed * (ducking ? 1 - .66 * duckAmount : walk ? .52 : 1) * tag;
  const velocity = airborne
    ? airVelocity(actor.velocity.x, actor.velocity.z, wishX, wishZ, runningSpeed, dt)
    : groundVelocity(actor.velocity.x, actor.velocity.z, wishX, wishZ, speed, dt,
      {weaponSpeed: runningSpeed, ducking, walking: walk && !ducking});
  // Ground tagging caps momentum as well as wish speed/acceleration. Do not
  // multiply velocity every tick, or apply the ground cap to an airborne actor.
  if (!airborne && tag < 1) {
    const actualSpeed = Math.hypot(velocity.x, velocity.z);
    if (actualSpeed > speed) {
      velocity.x *= speed / actualSpeed; velocity.z *= speed / actualSpeed;
    }
  }
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
    duckSpeed, crouchHeld: crouch, duckCooldown, duckRecoveryOrigin,
    velocityModifier: actor.velocityModifier,
  };
}
