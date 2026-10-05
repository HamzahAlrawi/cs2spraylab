import {fitsTerrain, moveOnTerrain, clipContactVelocity, verticalContact} from './actor-collision';
import {actorContactSolids, actorHull, supportDisplacement, resizeSupportedStack, type ContactActor} from './actor-contact';
import {TERRAIN_RULES, CONTACT_EPSILON, ladderAt, waterLevel, normalize, dot, add, scale, subtract,
  type ContactId, type TerrainSolid, type TerrainWorld} from './terrain';
import {acceptedJumpPress, isBhopPress, jumpLandingFactor, groundLandingFactor, ballisticContactTime, type JumpRules} from './actor-jump';

export const UNIT = .0254;
export const DEG = Math.PI / 180;
export const STEP = 1 / 128;
export const GRAVITY = 800 * UNIT;
export const JUMP_SPEED = 301.993 * UNIT;
export const DUCK_SECONDS = 1 / 6.4;
export const UNDUCK_SECONDS = 1 / 8;

export type Vec = { x: number; y: number; z: number };
export type MoveInput = { forward: number; side: number; walk: boolean; crouch: boolean; jump: boolean;
  jumpPressed?: boolean; jumpPressOffset?: number };
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
  movementTime?: number;
  lastJumpPressTime?: number;
  pendingJumpPressTime?: number;
  landedAt?: number;
  landingVelocity?: number;
  landingVelocityXY?: {x: number; z: number};
  supportId?: ContactId;
  moveMode?: 'ground' | 'air' | 'ladder' | 'water';
  waterLevel?: 0 | 1 | 2 | 3;
  ladderDetached?: boolean;
};
export type ActorEnvironment = TerrainWorld & {actors?: readonly ContactActor[]; selfId?: ContactId;
  time?: number; pitch?: number; jumpRules?: JumpRules};
export type ResolveMove = (from: Vec, desired: Vec, feet: number, height: number) => Vec;
export type CanOccupy = (position: Vec, feet: number, height: number) => boolean;
export type ResolveVertical = (position: Vec, from: number, to: number, height: number) =>
  {feet: number; grounded: boolean; ceiling: boolean; normal?: Vec; support?: TerrainSolid};

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
  environment?: ActorEnvironment,
): ActorKinematics {
  if (dt < 0 || !Number.isFinite(dt)) return {...actor, position: {...actor.position}, velocity: {...actor.velocity}};
  const time = environment?.time ?? actor.movementTime ?? 0;
  const pressOffset = clamp(input.jumpPressOffset ?? 0, 0, dt);
  if (pressOffset > 0 && (input.jumpPressed || input.jump && !actor.jumpHeld)) {
    const before = advanceActor(actor, {...input, jump: actor.jumpHeld, jumpPressed: false, jumpPressOffset: 0},
      runningSpeed, pressOffset, resolve, canOccupy, vertical, environment);
    return advanceActor(before, {...input, jumpPressed: true, jumpPressOffset: 0}, runningSpeed, dt - pressOffset,
      resolve, canOccupy, vertical, environment ? {...environment, time: time + pressOffset,
        actors: environment.actors?.map(body => ({...body, previous: undefined}))} : undefined);
  }
  const bodies = environment?.actors ?? [];
  const world = environment ? {...environment,
    solids: [...environment.solids, ...actorContactSolids(bodies, environment.selfId)]} : undefined;
  if (world) {
    const displacement = supportDisplacement(actor, bodies);
    if (Math.hypot(displacement.x, displacement.y, displacement.z) > CONTACT_EPSILON) {
      const from = {...actor.position, y: actor.feet};
      const carried = moveOnTerrain(from, add(from, displacement), (72 - 18 * stanceCurve(actor.duckAmount ?? 0)) * UNIT,
        {...world, solids: world.solids.filter(s => s.traversal?.kind !== 'actor' || s.traversal.actorId !== actor.supportId)});
      actor = {...actor, position: {...carried.position, y: carried.position.y + actor.eyeHeight}, feet: carried.position.y};
    }
    canOccupy = (p, feet, height) => fitsTerrain(p, feet, height, world) ||
      environment?.selfId !== undefined && resizeSupportedStack({...actor, id: environment.selfId},
        {position: p, feet, height}, bodies, environment) !== undefined;
    vertical = (p, from, to, height) => verticalContact(p, from, to, height, world.solids, world.floor === undefined ? 0 : world.floor);
  }
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
  const support = vertical(actor.position, actor.feet, actor.feet - CONTACT_EPSILON, (72 - 18 * previousCurve) * UNIT);
  const baseId = support.support?.traversal?.kind === 'actor' ? support.support.traversal.actorId : undefined;
  const base = bodies.find(body => body.id === baseId);
  const supported = support.grounded && actor.verticalVelocity <= 0 && base?.grounded !== false;
  const rules = environment?.jumpRules;
  const pressed = input.jumpPressed || jump && !actor.jumpHeld;
  const validPress = !!pressed && acceptedJumpPress(time, actor.lastJumpPressTime, rules);
  let pendingJumpPressTime = validPress ? time : actor.pendingJumpPressTime;
  const wantsJump = validPress || !!rules?.autoBhop && jump;
  const bhop = isBhopPress(validPress ? time : undefined, actor.landedAt, rules);
  let verticalVelocity = actor.verticalVelocity;
  if (wantsJump && supported) {
    verticalVelocity = JUMP_SPEED * (actor.landedAt === undefined ? 1 :
      jumpLandingFactor(actor.landingVelocity ?? 0, time - actor.landedAt));
    pendingJumpPressTime = undefined;
  }
  const airborne = !supported || verticalVelocity > 0;
  let duckAmount = clamp(currentDuck + (wantsDuck ? .8 * duckSpeed : -Math.max(1.5, duckSpeed)) * dt, 0, 1);
  let duckCurve = stanceCurve(duckAmount);
  const floor = world?.floor === null ? -Infinity : world?.floor ?? 0;
  let feet = Math.max(floor, actor.feet + (airborne ? (duckCurve - previousCurve) * 18 * UNIT : 0));
  // Releasing crouch requires room for the full standing hull, not just the
  // next interpolation step. In air the hull expands downwards.
  const standingFeet = Math.max(floor, actor.feet - (airborne ? previousCurve * 18 * UNIT : 0));
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
  let velocity = airborne
    ? airVelocity(actor.velocity.x, actor.velocity.z, wishX, wishZ, runningSpeed, dt)
    : groundVelocity(actor.velocity.x, actor.velocity.z, wishX, wishZ, speed, dt,
      {weaponSpeed: runningSpeed, ducking, walking: walk && !ducking});
  if (bhop && actor.landingVelocityXY) velocity = {...actor.landingVelocityXY};
  let moveMode: NonNullable<ActorKinematics['moveMode']> = airborne ? 'air' : 'ground';
  const hullHeight = (72 - 18 * duckCurve) * UNIT;
  if (world && environment?.selfId !== undefined && duckAmount !== currentDuck) {
    const resized = resizeSupportedStack({...actor, id: environment.selfId}, {position: actor.position, feet, height: hullHeight}, bodies, environment);
    if (resized && resized.length > 1) {
      const riders = new Map(resized.slice(1).map(body => [body.id, actorHull(body)]));
      world.solids = world.solids.map(solid => solid.traversal?.kind === 'actor' ?
        riders.get(solid.traversal.actorId) ?? solid : solid);
    }
  }
  const water = world ? waterLevel(actor.position, feet, hullHeight, world.solids) : 0;
  const ladder = world && ladderAt(actor.position, feet, hullHeight, world.solids);
  let ladderDetached = ladder ? actor.ladderDetached ?? false : false;
  let specialVelocity: Vec | undefined;
  if (ladder?.traversal?.kind === 'ladder' && !ladderDetached) {
    const normal = normalize({...ladder.traversal.normal, y: 0});
    if (wantsJump) {
      // Static server ladder-detach block acf5e8..acf613: normal * 270 u/s.
      velocity = {x: normal.x * TERRAIN_RULES.ladderDetachSpeed, z: normal.z * TERRAIN_RULES.ladderDetachSpeed};
      verticalVelocity = 0;
      moveMode = 'air';
      ladderDetached = true;
    } else {
      moveMode = 'ladder';
      const pitch = environment?.pitch ?? 0;
      const wish = {x: wishX * Math.cos(pitch), y: -forward * Math.sin(pitch), z: wishZ * Math.cos(pitch)};
      const inward = dot(wish, normal), tangent = subtract(wish, scale(normal, inward));
      const climb = -inward;
      const requested = add(tangent, {x: 0, y: climb, z: 0});
      const speedLimit = runningSpeed * TERRAIN_RULES.ladderSpeedScale * (ducking ? .34 : 1);
      specialVelocity = scale(normalize(requested), speedLimit * Math.min(1, Math.hypot(requested.x, requested.y, requested.z)));
      velocity = {x: specialVelocity.x, z: specialVelocity.z}; verticalVelocity = specialVelocity.y;
    }
  } else if (water >= 2) {
    moveMode = 'water';
    const volume = world?.solids.find(s => s.traversal?.kind === 'water' &&
      waterLevel(actor.position, feet, hullHeight, [s]) >= 2);
    const waterSettings = volume?.traversal?.kind === 'water' ? volume.traversal : undefined;
    const swimming = swimVelocity({x: actor.velocity.x, y: actor.verticalVelocity, z: actor.velocity.z},
      {x: wishX * Math.cos(environment?.pitch ?? 0), y: jump ? 1 : crouch ? -1 : -forward * Math.sin(environment?.pitch ?? 0),
        z: wishZ * Math.cos(environment?.pitch ?? 0)}, runningSpeed, dt, waterSettings);
    specialVelocity = add(swimming, waterSettings?.current ?? {x: 0, y: 0, z: 0});
    velocity = {x: specialVelocity.x, z: specialVelocity.z}; verticalVelocity = specialVelocity.y;
  }
  // Ground tagging caps momentum as well as wish speed/acceleration. Do not
  // multiply velocity every tick, or apply the ground cap to an airborne actor.
  if (!airborne && tag < 1) {
    const actualSpeed = Math.hypot(velocity.x, velocity.z);
    if (actualSpeed > speed) {
      velocity.x *= speed / actualSpeed; velocity.z *= speed / actualSpeed;
    }
  }
  const beforeVertical = feet, initialVerticalVelocity = verticalVelocity;
  if (specialVelocity) feet += specialVelocity.y * dt;
  else if (airborne || moveMode === 'air') {
    feet += verticalVelocity * dt - GRAVITY * dt * dt / 2;
    verticalVelocity -= GRAVITY * dt;
  }
  const desired = { ...actor.position, x: actor.position.x + velocity.x * dt, z: actor.position.z + velocity.z * dt };
  // Horizontal collision is evaluated at the pre-fall height so landing on an
  // edge does not get mistaken for walking into its side.
  const terrainMove = world && moveOnTerrain({...actor.position, y: beforeVertical}, {...desired, y: feet}, hullHeight,
    world, supported && !wantsJump && !specialVelocity);
  const resolved = terrainMove ? terrainMove.position : resolve(actor.position, desired, Math.max(beforeVertical, feet), hullHeight);
  const contact = terrainMove ? {feet: terrainMove.position.y, grounded: terrainMove.grounded,
    ceiling: terrainMove.ceiling, support: terrainMove.support} : vertical(resolved, beforeVertical, feet - (airborne ? 0 : CONTACT_EPSILON), hullHeight);
  if (dt === 0 && verticalVelocity > 0) contact.grounded = false;
  if (terrainMove) {
    let clipped = {x: velocity.x, y: verticalVelocity, z: velocity.z};
    for (const hit of terrainMove.contacts) {
      if (supported && !wantsJump && hit.normal.y >= TERRAIN_RULES.standableNormal) continue;
      clipped = clipContactVelocity(clipped, hit.normal);
    }
    velocity = {x: clipped.x, z: clipped.z}; verticalVelocity = clipped.y;
  }
  feet = contact.feet;
  if (contact.support?.traversal?.kind === 'actor' &&
    bodies.find(body => body.id === (contact.support?.traversal?.kind === 'actor' ? contact.support.traversal.actorId : undefined))?.grounded === false) {
    contact.grounded = false;
  }
  let landedAt = actor.landedAt, landingVelocity = actor.landingVelocity, landingVelocityXY = actor.landingVelocityXY;
  if (contact.grounded && airborne && !specialVelocity) {
    const initialV = initialVerticalVelocity;
    const landingOffset = ballisticContactTime(beforeVertical, feet, initialV, GRAVITY, dt);
    landedAt = time + landingOffset;
    landingVelocity = initialV - GRAVITY * landingOffset;
    landingVelocityXY = {...velocity};
    if (isBhopPress(pendingJumpPressTime, landedAt, rules) || rules?.autoBhop && jump) {
      const remainder = dt - landingOffset;
      verticalVelocity = JUMP_SPEED * jumpLandingFactor(landingVelocity, 0);
      pendingJumpPressTime = undefined;
      const bounceFeet = feet + verticalVelocity * remainder - GRAVITY * remainder * remainder / 2;
      const bounce = vertical(resolved, feet, bounceFeet, hullHeight);
      feet = bounce.feet; contact.grounded = false; contact.ceiling = bounce.ceiling;
      verticalVelocity -= GRAVITY * remainder;
    }
  }
  if (contact.grounded && landedAt !== undefined && landingVelocity !== undefined && !rules?.enableBunnyhopping) {
    const cap = speed * groundLandingFactor(landingVelocity, time + dt - landedAt);
    const length = Math.hypot(velocity.x, velocity.z);
    if (length > cap) velocity = {x: velocity.x * cap / length, z: velocity.z * cap / length};
  }
  if (contact.grounded || contact.ceiling) verticalVelocity = 0;
  if (dt > 0 && resolved.x === actor.position.x) velocity.x = 0;
  if (dt > 0 && resolved.z === actor.position.z) velocity.z = 0;
  velocity.x = clamp(velocity.x, -TERRAIN_RULES.maxVelocity, TERRAIN_RULES.maxVelocity);
  velocity.z = clamp(velocity.z, -TERRAIN_RULES.maxVelocity, TERRAIN_RULES.maxVelocity);
  verticalVelocity = clamp(verticalVelocity, -TERRAIN_RULES.maxVelocity, TERRAIN_RULES.maxVelocity);
  const eyeHeight = (64 - 18 * duckCurve) * UNIT;
  return {
    position: { x: resolved.x, y: feet + eyeHeight, z: resolved.z }, velocity,
    yaw: actor.yaw, feet, verticalVelocity, eyeHeight, duckAmount, jumpHeld: jump, grounded: contact.grounded,
    duckSpeed, crouchHeld: crouch, duckCooldown, duckRecoveryOrigin,
    velocityModifier: actor.velocityModifier,
    movementTime: time + dt, lastJumpPressTime: pressed ? time : actor.lastJumpPressTime, pendingJumpPressTime,
    landedAt, landingVelocity, landingVelocityXY,
    supportId: contact.grounded && contact.support?.traversal?.kind === 'actor' ? contact.support.traversal.actorId : undefined,
    moveMode: specialVelocity ? moveMode : contact.grounded ? 'ground' : 'air', waterLevel: water, ladderDetached,
  };
}

export function swimVelocity(velocity: Vec, wish: Vec, speed: number, dt: number,
  settings: {speedScale?: number; drag?: number} = {}): Vec {
  const length = Math.hypot(velocity.x, velocity.y, velocity.z);
  const retained = length ? Math.max(0, 1 - Math.max(0, settings.drag ?? TERRAIN_RULES.waterFriction) * dt) : 0;
  const v = scale(velocity, retained), direction = normalize(wish);
  const wishSpeed = speed * clamp(settings.speedScale ?? TERRAIN_RULES.waterSpeedScale, 0, 1) * Math.min(1, Math.hypot(wish.x, wish.y, wish.z));
  const amount = Math.min(Math.max(0, wishSpeed - dot(v, direction)), TERRAIN_RULES.waterAccelerate * wishSpeed * dt);
  return add(v, scale(direction, amount));
}

export function resetActorMovementHistory(actor: ActorKinematics): ActorKinematics {
  return {...actor, movementTime: undefined, lastJumpPressTime: undefined, pendingJumpPressTime: undefined,
    landedAt: undefined, landingVelocity: undefined, landingVelocityXY: undefined, supportId: undefined,
    moveMode: actor.grounded ? 'ground' : 'air', waterLevel: 0, ladderDetached: false};
}
