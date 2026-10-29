import {UNIT, stanceCurve, type Vec} from '../actor-physics';
import {add, subtract, scale, dot, normalize} from '../terrain';
import {traceSolid, rayBoxInterval, type Arena} from './geometry';
import {armorDamage} from './damage';
import {DuelRandom} from './rng';
import {utilityKinds, type UtilityKind} from './utility-loadout';
import {buildSmokeVolume, smokeContains} from './smoke-volume';
import {nativeGrenadeVelocity,nativeGrenadeSpeed,nativeGrenadeThrowVelocity} from './grenade-native-launch';
import {sweepGrenadeHull} from './grenade-contact';
import {nativeHEStats,nativeHEBlastDamage,nativeHEArmorDamage,NATIVE_HE} from './grenade-native-blast';
import {nativeUtilityDefault} from './native-utility-defaults';
import {NATIVE_GRENADE_FLIGHT,nativeGrenadeContact,nativeGrenadeThinkTick,nativeGrenadeNextThinkTick} from './grenade-native-flight';
import {nativeFlashArguments,NATIVE_GRENADE_FLASH} from './grenade-native-flash';
import {nativeFlashVisibility} from './grenade-flash-visibility';
import {InfernoSpread,nativeInfernoDamage} from './inferno-native';
import {pointInSmokeHole, SMOKE_EXTINCTION, HE_SMOKE_DISPLACEMENT} from './smoke-density';
import {HE_EXPLOSION_SECONDS} from './he-explosion';

export type {UtilityKind} from './utility-loadout';
export const UTILITY_KERNEL_VERSION='native-launch-contact-think-inferno-2000935-v4';
// Extracted values and approximation boundaries: docs/utility-kernel.md.
export const UTILITY_RULES = Object.freeze({
  step: 1 / 128, gravity: NATIVE_GRENADE_FLIGHT.gravity * UNIT, throwSpeed: Math.fround(nativeGrenadeSpeed())*UNIT,
  restitution: NATIVE_GRENADE_FLIGHT.elasticity, radius: 2 * UNIT, stopSpeed: 20 * UNIT,
  fuse: 1.5, fireFuse: nativeUtilityDefault('molotov_throw_detonate_time'),
  minFireNormal: Math.cos(nativeUtilityDefault('weapon_molotov_maxdetonateslope')*Math.PI/180),
  fireDamage: nativeUtilityDefault('inferno_damage'), fireDamageCT:nativeUtilityDefault('inferno_damage_ct'),
  fireTick: nativeUtilityDefault('inferno_damage_timer'),
  molotovLifetime: nativeUtilityDefault('inferno_flame_lifetime'), incendiaryLifetime: nativeUtilityDefault('inferno_flame_lifetime_incendiary'),
  molotovRadius: nativeUtilityDefault('inferno_max_range') * UNIT, incendiaryRadius: nativeUtilityDefault('inferno_max_range_ct') * UNIT,
  heRadius: nativeHEStats.radiusUnits * UNIT, heDamage: nativeHEStats.damage, smokeRadius: 4.2, smokeLifetime: 20,
  smokeMinimumAge: Math.fround(1.188), smokeDetonateSpeed: Math.fround(.1)*UNIT,
  smokeBloom: 1, decoyLifetime: 15, projectileLifetime: 8,
  maxProjectiles: 32, maxEffects: 64, maxActors: 64, maxEvents: 4096,
  maxSteps: 128, maxContacts: 4, maxHoles: 16,
});

export type UtilitySide = 'player' | 'enemy';
export type UtilityActor = Readonly<{
  id: number; side: UtilitySide; position: Readonly<Vec>; feet: number;
  yaw: number; pitch: number; alive: boolean; duckAmount?: number; armor?: number;
}>;
export type UtilityThrow = {
  actorId: number; side: UtilitySide; kind: UtilityKind; origin: Vec; direction: Vec;
  velocity?: Vec; strength: number; time: number;
};
type Attribution = {actorId: number; side: UtilitySide; kind: UtilityKind};
export type UtilityProjectile = Attribution & {
  id: number; position: Vec; velocity: Vec; radius: number; thrownAt: number;
  resting: boolean; bounces: number;
};
export type SmokeHole = {from: Vec; to: Vec; radius: number; startedAt: number; expiresAt: number};
export type UtilityEffect = Attribution & {
  id: number; type: 'smoke' | 'fire' | 'decoy' | 'burst'; position: Vec; radius: number;
  startedAt: number; expiresAt: number; cells: Vec[]; holes: SmokeHole[];
};
type EventBase = Attribution & {utilityId: number; time: number; position: Vec};
export type UtilityEvent =
  | EventBase & {type: 'damage'; targetId: number; damage: number; cause: 'he' | 'fire' | 'decoy';
    shooter: number; victim: number; healthDamage: number; armorDamage: number; point: Vec; direction: Vec}
  | EventBase & {type: 'flash'; targetId: number; exposure: number; duration: number; hold?:number;fade?:number}
  | EventBase & {type: 'sound'; sound: 'bounce' | 'he' | 'flash' | 'smoke' | 'ignite' | 'extinguish' | 'decoy' | 'decoy-end'; radius: number}
  | EventBase & {type: 'detonate'}
  | EventBase & {type: 'bounce'; normal: Vec}
  | EventBase & {type: 'extinguish'; smokeId: number}
  | EventBase & {type: 'expire'};
type LiveEffect = UtilityEffect & {nextTick: number;inferno?:InfernoSpread};
const zero = (): Vec => ({x: 0, y: 0, z: 0});
const finite = (v: Readonly<Vec>) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const length = (v: Vec) => Math.hypot(v.x, v.y, v.z);
const distance = (a: Vec, b: Vec) => length(subtract(a, b));
const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const copyHole = (h: SmokeHole): SmokeHole => ({...h, from: {...h.from}, to: {...h.to}});
const copyEffect = (e: UtilityEffect): UtilityEffect => ({id: e.id, actorId: e.actorId, side: e.side,
  kind: e.kind, type: e.type, position: {...e.position}, radius: e.radius, startedAt: e.startedAt,
  expiresAt: e.expiresAt, cells: e.cells.map(v => ({...v})), holes: e.holes.map(copyHole)});

/** World metres/seconds, y-up; no implicit hand offset or pitch correction. */
export function utilityLaunchVelocity(direction: Vec, strength: number, actorVelocity: Vec = zero(),throwVelocity=750): Vec {
  if (!finite(direction) || !finite(actorVelocity) || !Number.isFinite(strength) || length(direction) < 1e-9) return zero();
  return nativeGrenadeVelocity(normalize(direction),strength,actorVelocity,throwVelocity);
}

const eye = (actor: UtilityActor): Vec => ({...actor.position});
const chest = (actor: UtilityActor): Vec => ({x: actor.position.x,
  y: actor.feet + (40 - 12 * clamp(actor.duckAmount ?? 0)) * UNIT, z: actor.position.z});
const clear = (from: Vec, to: Vec, arena: Arena) => {
  const delta = subtract(to, from), range = length(delta);
  return range < 1e-8 || traceSolid(from, scale(delta, 1 / range), arena, range).distance >= range - 1e-5;
};

function sphereInterval(from: Vec, direction: Vec, range: number, center: Vec, radius: number): [number, number] | undefined {
  const delta = subtract(from, center), b = dot(delta, direction), c = dot(delta, delta) - radius * radius;
  const discriminant = b * b - c;
  if (discriminant <= 0) return undefined;
  const root = Math.sqrt(discriminant), low = Math.max(0, -b - root), high = Math.min(range, -b + root);
  return high > low ? [low, high] : undefined;
}

function smokeRadius(effect: UtilityEffect, time: number) {
  return effect.radius * clamp((time - effect.startedAt) / UTILITY_RULES.smokeBloom) * clamp((effect.expiresAt - time) / 1.5);
}

/** Analytic smoke optical depth [0,1], not native volumetric smoke. */
export function smokeSegmentExposure(from: Vec, to: Vec, effects: readonly UtilityEffect[], time: number): number {
  if (!finite(from) || !finite(to) || !Number.isFinite(time)) return 0;
  const delta = subtract(to, from), range = length(delta);
  if (range < 1e-8) return 0;
  const direction = scale(delta, 1 / range);
  let opticalDepth = 0;
  for (const effect of effects) {
    if (effect.type !== 'smoke' || time <= effect.startedAt || time >= effect.expiresAt) continue;
    const interval = sphereInterval(from, direction, range, effect.position, smokeRadius(effect, time));
    if (!interval) continue;
    if (!effect.cells.length && !effect.holes.some(h => h.startedAt <= time && h.expiresAt > time)) {
      opticalDepth += interval[1] - interval[0]; continue;
    }
    // Subdivide the chord so partial bullet/HE holes do not erase the whole cloud.
    const count = 24, stride = (interval[1] - interval[0]) / count;
    for (let i = 0; i < count; i++) {
      const point = add(from, scale(direction, interval[0] + (i + .5) * stride));
      if (!smokeContains(point, effect)) continue;
      const inHole = effect.holes.some(h => pointInSmokeHole(point, h, time));
      if (!inHole) opticalDepth += stride;
    }
  }
  return 1 - Math.exp(-opticalDepth * SMOKE_EXTINCTION);
}

/** Seeded, bounded browser-only kernel. advance time is the interval END. */
export class UtilitySimulation {
  private moving: UtilityProjectile[] = [];
  private active: LiveEffect[] = [];
  private nextId = 1;
  private simulatedAt: number | undefined;
  private lastTime: number | undefined;
  private nextExtinguishAt = -Infinity;
  private readonly fuseClocks=new Map<number,{deadline:number;nextTick:number}>();
  private random: DuelRandom;

  constructor(private readonly seed = 1) {this.random = new DuelRandom(seed, 'utilities');}
  /** Borrowed renderer views: do not mutate or retain as historical snapshots. */
  get projectiles(): readonly UtilityProjectile[] {return this.moving;}
  get effects(): readonly UtilityEffect[] {return this.active;}
  snapshot(): {projectiles: UtilityProjectile[]; effects: UtilityEffect[]} {
    return {projectiles: this.moving.map(p => ({...p, position: {...p.position}, velocity: {...p.velocity}})),
      effects: this.active.map(copyEffect)};
  }
  reset() {
    this.moving = []; this.active = []; this.simulatedAt = undefined; this.lastTime = undefined;
    this.fuseClocks.clear();
    this.nextId = 1; this.nextExtinguishAt = -Infinity; this.random = new DuelRandom(this.seed, 'utilities');
  }

  throw(input: UtilityThrow): number | undefined {
    if (!utilityKinds.includes(input.kind) || !finite(input.origin) || !finite(input.direction) ||
      !finite(input.velocity ?? zero()) || !Number.isFinite(input.time) || !Number.isFinite(input.strength) ||
      !Number.isSafeInteger(input.actorId) || !['player', 'enemy'].includes(input.side) ||
      length(input.direction) < 1e-9 || this.moving.length >= UTILITY_RULES.maxProjectiles ||
      (this.lastTime !== undefined && input.time < this.lastTime - 1e-8)) return undefined;
    const id = this.nextId++;
    if(input.kind==='he'||input.kind==='flash')this.fuseClocks.set(id,{deadline:Math.fround(Math.fround(input.time)+UTILITY_RULES.fuse),
      nextTick:nativeGrenadeThinkTick(input.time)});
    this.moving.push({id, actorId: input.actorId, side: input.side, kind: input.kind, position: {...input.origin},
      velocity: utilityLaunchVelocity(input.direction, input.strength, input.velocity,nativeGrenadeThrowVelocity(input.kind)), radius: UTILITY_RULES.radius,
      thrownAt: input.time, resting: false, bounces: 0});
    return id;
  }

  smokeExposure(from: Vec, to: Vec, time: number): number {return smokeSegmentExposure(from, to, this.active, time);}
  obscuresSegment(from: Vec, to: Vec, time: number): boolean {return this.smokeExposure(from, to, time) >= .5;}
  /** Invoke separately for each sight/shadow sample, never only the actor aimpoint. */
  sightFilter(from: Vec, time: number): (point: Vec) => boolean {return point => !this.obscuresSegment(from, point, time);}
  clearSmokeSegment(from: Vec, to: Vec, time: number, radius = .12, duration = .35): void {
    if (!finite(from) || !finite(to) || !Number.isFinite(time) || !Number.isFinite(radius) || !Number.isFinite(duration)) return;
    const delta = subtract(to, from), range = length(delta), direction = range > 1e-9 ? scale(delta, 1 / range) : zero();
    for (const effect of this.active) {
      if (effect.type !== 'smoke' || effect.expiresAt <= time || time < effect.startedAt ||
        (range > 1e-9 ? !sphereInterval(from, direction, range, effect.position, effect.radius + Math.max(0, radius))
          : distance(from, effect.position) > effect.radius + Math.max(0, radius))) continue;
      this.hole(effect, {from: {...from}, to: {...to}, radius: clamp(radius, .01, 5), startedAt: time,
        expiresAt: time + clamp(duration, .01, 2)});
    }
  }

  advance(dt: number, time: number, arena: Arena, actors: readonly UtilityActor[]): UtilityEvent[] {
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(time) ||
      (this.lastTime !== undefined && (time < this.lastTime - 1e-8 || Math.abs(time - dt - this.lastTime) > 1e-6))) {
      throw new RangeError('UtilitySimulation requires finite, contiguous end-time intervals');
    }
    const events: UtilityEvent[] = [];
    const emit = (event: UtilityEvent) => {if (events.length < UTILITY_RULES.maxEvents) events.push(event);};
    this.simulatedAt ??= time - dt;
    this.lastTime = time;
    if (!this.moving.length && !this.active.length) {
      this.simulatedAt = time;
      return events;
    }
    const targets = actors.slice(0, UTILITY_RULES.maxActors).filter(a => a.alive && finite(a.position) && Number.isFinite(a.feet) &&
      Number.isFinite(a.yaw) && Number.isFinite(a.pitch));
    const armor = new Map(targets.map(a => [a.id, Number.isFinite(a.armor) ? Math.max(0, a.armor!) : 0]));
    // Suspension/clock jumps drop old projectiles rather than delivering stale damage.
    if (time - this.simulatedAt > UTILITY_RULES.maxSteps * UTILITY_RULES.step + 1e-8) {
      this.simulatedAt = time - UTILITY_RULES.maxSteps * UTILITY_RULES.step;
      this.moving = this.moving.filter(p => {
        if (p.thrownAt >= this.simulatedAt!) return true;
        this.fuseClocks.delete(p.id);emit({...this.base(p, time), type: 'expire'}); return false;
      });
      this.active = this.active.filter(e => {
        e.nextTick = Math.max(e.nextTick, this.simulatedAt!);
        if (e.expiresAt > this.simulatedAt!) return true;
        emit({...this.base(e, time), type: 'expire'}); return false;
      });
    }
    let steps = 0;
    while (this.simulatedAt + UTILITY_RULES.step <= time + 1e-9 && steps++ < UTILITY_RULES.maxSteps) {
      const start = this.simulatedAt;
      this.simulatedAt += UTILITY_RULES.step;
      const now = this.simulatedAt;
      this.active = this.active.filter(e => {
        if (e.holes.length) e.holes = e.holes.filter(h => h.expiresAt > now);
        if (e.expiresAt > now + 1e-9) return true;
        if (e.type === 'decoy') {
          this.sound(e, e.expiresAt, 'decoy-end', 15, emit);
          this.radial(e, e.expiresAt, 2, 5, 'decoy', arena, targets, armor, emit);
        }
        emit({...this.base(e, e.expiresAt), type: 'expire'}); return false;
      });
      this.moving = this.moving.filter(p => {
        if (p.thrownAt > now + 1e-9) return true;
        const step = now - Math.max(start, p.thrownAt), age = now - p.thrownAt;
        if (step <= 0) return true;
        if (age >= UTILITY_RULES.projectileLifetime) {this.fuseClocks.delete(p.id);emit({...this.base(p, now), type: 'expire'}); return false;}
        const floorImpact = this.move(p, step, now, arena, targets, emit);
        const fire = p.kind === 'molotov' || p.kind === 'incendiary';
        const clock=this.fuseClocks.get(p.id),tick=Math.floor(now*64+1e-8);
        let timed=false;
        if(clock&&tick>=clock.nextTick) {
          const checkTime=Math.fround(tick/64);
          timed=checkTime>clock.deadline;
          if(!timed)clock.nextTick=nativeGrenadeNextThinkTick(checkTime);
        }
        const settled = p.kind==='smoke'?age>=UTILITY_RULES.smokeMinimumAge&&length(p.velocity)<=UTILITY_RULES.smokeDetonateSpeed:
          p.kind==='decoy'&&age>=.2&&p.resting;
        if (timed || settled || (fire && (floorImpact || age >= UTILITY_RULES.fireFuse - 1e-9))) {
          this.fuseClocks.delete(p.id);this.detonate(p, now, arena, targets, armor, emit); return false;
        }
        return true;
      });
      for(const effect of this.active)if(effect.type==='fire'&&effect.inferno) {
        effect.cells=effect.inferno.advance(now,(from,point)=>{
          const candidate=this.floor({...point,y:point.y+.3},arena);
          return candidate&&Math.abs(candidate.y-from.y)<=.35&&
            clear(add(from,{x:0,y:.1,z:0}),add(candidate,{x:0,y:.1,z:0}),arena)?candidate:undefined;
        });
        effect.expiresAt=effect.inferno.expiresAt;
      }
      if (now >= this.nextExtinguishAt) {
        this.extinguish(now, arena, emit); this.nextExtinguishAt = now + .1;
      }
      for (const effect of this.active) {
        if (effect.type === 'fire' && effect.nextTick <= now + 1e-9) {
          const tick = now; effect.nextTick += UTILITY_RULES.fireTick;
          for (const actor of targets) {
            const feet = {x: actor.position.x, y: actor.feet + .1, z: actor.position.z};
            if (!effect.cells.some(cell => Math.abs(actor.feet - cell.y) <= .35 &&
              Math.hypot(actor.position.x - cell.x, actor.position.z - cell.z) <= .8 &&
              clear(add(cell, {x: 0, y: .1, z: 0}), feet, arena))) continue;
            const dps=effect.kind==='incendiary'?UTILITY_RULES.fireDamageCT:UTILITY_RULES.fireDamage;
            this.damage(effect,actor,tick,nativeInfernoDamage(now,effect.startedAt,dps,UTILITY_RULES.fireTick),'fire',armor,emit);
          }
        } else if (effect.type === 'decoy' && effect.nextTick <= now + 1e-9) {
          this.sound(effect, effect.nextTick, 'decoy', 35, emit);
          effect.nextTick += .45 + this.random.next() * .35;
        }
      }
    }
    return events;
  }

  private base(source: Attribution & {id: number; position: Vec}, time: number): EventBase {
    return {utilityId: source.id, actorId: source.actorId, side: source.side, kind: source.kind, time, position: {...source.position}};
  }
  private sound(source: Attribution & {id: number; position: Vec}, time: number,
    sound: Extract<UtilityEvent, {type: 'sound'}>['sound'], radius: number, emit: (e: UtilityEvent) => void) {
    emit({...this.base(source, time), type: 'sound', sound, radius});
  }
  private damage(source: Attribution & {id: number; position: Vec}, actor: UtilityActor, time: number,
    raw: number, cause: 'he' | 'fire' | 'decoy', armor: Map<number, number>, emit: (e: UtilityEvent) => void) {
    const protection = armor.get(actor.id) ?? 0;
    const result = cause === 'he'?nativeHEArmorDamage(raw,protection):
      cause === 'fire' || protection <= 0 ? {healthDamage: raw, armorDamage: 0} : armorDamage(raw, protection, 1);
    armor.set(actor.id, Math.max(0, protection - result.armorDamage));
    const point = chest(actor);
    emit({...this.base(source, time), type: 'damage', targetId: actor.id, damage: result.healthDamage, cause,
      shooter: source.actorId, victim: actor.id, ...result, point, direction: normalize(subtract(point, source.position))});
  }
  private radial(source: Attribution & {id: number; position: Vec}, time: number, radius: number, damage: number,
    cause: 'he' | 'decoy', arena: Arena, actors: readonly UtilityActor[], armor: Map<number, number>, emit: (e: UtilityEvent) => void) {
    for (const actor of actors) {
      if(cause==='he') {
        const from=add(source.position,{x:0,y:NATIVE_HE.sourceLiftUnits*UNIT,z:0}),point=chest(actor),r=16*UNIT;
        const height=(72-18*stanceCurve(actor.duckAmount??0))*UNIT;
        const nearest={x:clamp(from.x,actor.position.x-r,actor.position.x+r),y:clamp(from.y,actor.feet,actor.feet+height),
          z:clamp(from.z,actor.position.z-r,actor.position.z+r)};
        // Native uses an entity-shape query. This hull broad phase is not a body-point cutoff.
        if(distance(from,nearest)>radius)continue;
        const side={x:Math.cos(actor.yaw)*r,y:0,z:-Math.sin(actor.yaw)*r};
        const samples=[point,{...actor.position,y:actor.feet+71*UNIT},{...actor.position,y:actor.feet},add(point,side),subtract(point,side)];
        // Native weights; binary world rays remain an approximation of its obstruction helper.
        let exposure=0;
        for(let i=0;i<samples.length;i++)exposure=Math.fround(exposure+(clear(from,samples[i],arena)?NATIVE_HE.exposureWeights[i]:0));
        if(exposure>0)this.damage({...source,position:from},actor,time,nativeHEBlastDamage(distance(from,point)/UNIT,exposure),cause,armor,emit);
        continue;
      }
      const point = chest(actor), d = distance(point, source.position);
      if (d >= radius || !clear(source.position, point, arena)) continue;
      this.damage(source, actor, time, damage * (1 - d / radius) ** 2, cause, armor, emit);
    }
  }

  private move(p: UtilityProjectile, dt: number, time: number, arena: Arena, actors: readonly UtilityActor[], emit: (e: UtilityEvent) => void): boolean {
    if (p.resting) {
      const support = this.contact(p.position, {x: 0, y: -.02, z: 0}, p.radius, arena);
      if (support && support.normal.y > NATIVE_GRENADE_FLIGHT.slowSlopeNormal) return support.normal.y>=UTILITY_RULES.minFireNormal;
      p.resting = false;
    }
    let remaining = dt, floorImpact = false;
    const initialDelta=scale(p.velocity,dt);initialDelta.y-=.5*UTILITY_RULES.gravity*dt*dt;
    p.velocity.y-=UTILITY_RULES.gravity*dt;
    for (let contact = 0; contact < UTILITY_RULES.maxContacts && remaining > 1e-7; contact++) {
      const delta = contact===0?initialDelta:scale(p.velocity, remaining);
      let hit = this.contact(p.position, delta, p.radius, arena);
      let worldSupport=true;
      const range=length(delta),direction=range>1e-10?scale(delta,1/range):zero();
      if(range>1e-10)for(const actor of actors) {
        if(actor.id===p.actorId&&time-p.thrownAt<.2)continue;
        const r=16*UNIT+p.radius,height=(72-18*stanceCurve(actor.duckAmount??0))*UNIT;
        if(Math.hypot(actor.position.x-p.position.x,actor.position.z-p.position.z)>range+r*1.5)continue;
        const interval=rayBoxInterval(p.position,direction,
          {x:actor.position.x-r,y:actor.feet-p.radius,z:actor.position.z-r},
          {x:actor.position.x+r,y:actor.feet+height+p.radius,z:actor.position.z+r},range);
        if(interval&&interval.entryDistance>1e-6&&interval.entryDistance/range<(hit?.fraction??1)) {
          hit={fraction:Math.max(0,interval.entryDistance/range-.0001/range),normal:interval.entryNormal};worldSupport=false;
        }
      }
      const fraction = hit?.fraction ?? 1, used = remaining * fraction;
      p.position = add(p.position, scale(delta, fraction));
      if (!hit) break;
      p.position = add(p.position, scale(hit.normal, .0002));
      const into = dot(p.velocity, hit.normal);
      const response=nativeGrenadeContact(p.velocity,hit.normal,worldSupport);
      p.velocity=response.velocity;p.resting=response.resting;
      p.bounces++;
      floorImpact ||= hit.normal.y >= UTILITY_RULES.minFireNormal;
      emit({...this.base(p, time - remaining + used), type: 'bounce', normal: {...hit.normal}});
      if (Math.abs(into) > .7) this.sound(p, time - remaining + used, 'bounce', 12, emit);
      if (p.resting) break;
      remaining -= Math.max(used, 1e-6);
    }
    return floorImpact;
  }

  private contact(origin: Vec, delta: Vec, radius: number, arena: Arena): {fraction: number; normal: Vec} | undefined {
    const range = length(delta);
    if (range < 1e-10) return undefined;
    const direction = scale(delta, 1 / range);
    let closest = Infinity, normal = zero();
    const sweep = sweepGrenadeHull(origin, add(origin, delta), radius, arena);
    if (sweep && (sweep.contact || sweep.startSolid)) {
      closest = sweep.fraction * range;
      normal = sweep.contact ? normalize(sweep.contact.normal) : scale(direction, -1);
    }
    const plane = (t: number, n: Vec) => {if (t >= 0 && t <= 1 && t * range < closest) {closest = t * range; normal = n;}};
    if (!arena.native && delta.y < 0) plane((radius - origin.y) / delta.y, {x: 0, y: 1, z: 0});
    if(!arena.native) {
      if (delta.x < 0) plane((arena.minX + radius - origin.x) / delta.x, {x: 1, y: 0, z: 0});
      if (delta.x > 0) plane((arena.maxX - radius - origin.x) / delta.x, {x: -1, y: 0, z: 0});
      if (delta.z < 0) plane((arena.minZ + radius - origin.z) / delta.z, {x: 0, y: 0, z: 1});
      if (delta.z > 0) plane((arena.maxZ - radius - origin.z) / delta.z, {x: 0, y: 0, z: -1});
    }
    return closest <= range ? {fraction: clamp(closest / range), normal} : undefined;
  }

  private floor(point: Vec, arena: Arena, maxDrop = .6): Vec | undefined {
    if (point.x < arena.minX || point.x > arena.maxX || point.z < arena.minZ || point.z > arena.maxZ) return undefined;
    const from = add(point, {x: 0, y: .05, z: 0}), hit = traceSolid(from, {x: 0, y: -1, z: 0}, arena, maxDrop + .05);
    if (hit.normal && hit.normal.y >= UTILITY_RULES.minFireNormal && Number.isFinite(hit.distance)) {
      return {x: point.x, y: from.y - hit.distance, z: point.z};
    }
    if (!arena.native && point.y >= -.001 && point.y <= maxDrop && !Number.isFinite(hit.distance)) return {...point, y: 0};
    return undefined;
  }
  private effect(p: UtilityProjectile, time: number, type: UtilityEffect['type'], radius: number, lifetime: number): LiveEffect {
    const e: LiveEffect = {id: p.id, actorId: p.actorId, side: p.side, kind: p.kind, type,
      position: {...p.position}, radius, startedAt: time, expiresAt: time + lifetime, cells: [], holes: [],
      nextTick: time + (type === 'fire' ? UTILITY_RULES.fireTick : 0)};
    if (this.active.length >= UTILITY_RULES.maxEffects) return e;
    this.active.push(e); return e;
  }
  private detonate(p: UtilityProjectile, time: number, arena: Arena, actors: readonly UtilityActor[],
    armor: Map<number, number>, emit: (e: UtilityEvent) => void) {
    emit({...this.base(p, time), type: 'detonate'});
    if (p.kind === 'he') {
      this.sound(p, time, 'he', 60, emit);
      this.radial(p, time, UTILITY_RULES.heRadius, UTILITY_RULES.heDamage, 'he', arena, actors, armor, emit);
      this.effect(p, time, 'burst', UTILITY_RULES.heRadius, HE_EXPLOSION_SECONDS);
      for (const smoke of this.active) if (smoke.type === 'smoke' &&
        distance(p.position, smoke.position) < smoke.radius + HE_SMOKE_DISPLACEMENT.radius && clear(p.position, smoke.position, arena)) {
        this.hole(smoke, {from: {...p.position}, to: {...p.position}, radius: HE_SMOKE_DISPLACEMENT.radius,
          startedAt: time, expiresAt: time + HE_SMOKE_DISPLACEMENT.lifetime});
      }
    } else if (p.kind === 'flash') {
      this.sound(p, time, 'flash', 35, emit); this.effect(p, time, 'burst', .3, .25);
      const from=add(p.position,{x:0,y:UNIT,z:0});
      for (const actor of actors) {
        const point = eye(actor), d = distance(point, from);
        if (d >= NATIVE_GRENADE_FLASH.radiusUnits*UNIT) continue;
        const visibility=nativeFlashVisibility(point,from,arena);
        if(visibility<=0)continue;
        const forward = {x: -Math.sin(actor.yaw) * Math.cos(actor.pitch), y: Math.sin(actor.pitch),
          z: -Math.cos(actor.yaw) * Math.cos(actor.pitch)};
        const facing = d < 1e-8 ? 0 : dot(forward, normalize(subtract(from, point)));
        const args=nativeFlashArguments(d/UNIT,facing,visibility);
        if(args.duration>0)emit({...this.base(p,time),type:'flash',targetId:actor.id,exposure:visibility,...args});
      }
    } else if (p.kind === 'smoke') {
      const smoke = this.effect(p, time, 'smoke', UTILITY_RULES.smokeRadius, UTILITY_RULES.smokeLifetime);
      smoke.cells = buildSmokeVolume(p.position, smoke.radius, arena);
      this.nextExtinguishAt = time;
      this.sound(p, time, 'smoke', 20, emit);
    } else if (p.kind === 'decoy') {
      this.effect(p, time, 'decoy', .1, UTILITY_RULES.decoyLifetime);
    } else {
      // An air-fused firebomb never projects fire through a floor/ceiling below it.
      const floor = this.floor(p.position, arena, .2);
      if (!floor) return;
      const radius = p.kind === 'molotov' ? UTILITY_RULES.molotovRadius : UTILITY_RULES.incendiaryRadius;
      const e = this.effect(p, time, 'fire', radius, p.kind === 'molotov' ? UTILITY_RULES.molotovLifetime : UTILITY_RULES.incendiaryLifetime);
      this.nextExtinguishAt = time;
      e.position = floor;
      e.inferno=new InfernoSpread(floor,time,radius,e.expiresAt-time,p.kind==='incendiary',this.seed,e.id);
      e.cells=e.inferno.advance(time,()=>undefined);
      this.sound(p, time, 'ignite', 25, emit);
    }
  }
  private hole(effect: LiveEffect, hole: SmokeHole) {
    effect.holes = effect.holes.filter(h => h.expiresAt > hole.startedAt);
    if (effect.holes.length >= UTILITY_RULES.maxHoles) {
      // Sustained fire must not evict a still-active explosion window.
      let smallest = 0;
      for (let i = 1; i < effect.holes.length; i++) if (effect.holes[i].radius < effect.holes[smallest].radius) smallest = i;
      if (hole.radius < effect.holes[smallest].radius) return;
      effect.holes.splice(smallest, 1);
    }
    effect.holes.push(hole);
  }
  private extinguish(time: number, arena: Arena, emit: (e: UtilityEvent) => void) {
    const smokes = this.active.filter(e => e.type === 'smoke');
    if (!smokes.length) return;
    this.active = this.active.filter(e => {
      if (e.type !== 'fire') return true;
      const covered = e.cells.filter(cell => smokes.some(s => smokeContains(add(cell, {x: 0, y: .1, z: 0}), s) && distance(add(cell, {x: 0, y: .1, z: 0}), s.position) <
        Math.max(.3, smokeRadius(s, time)) && clear(add(cell, {x: 0, y: .1, z: 0}), s.position, arena)));
      if (!covered.length) return true;
      const smoke = smokes.find(s => distance(s.position, e.position) < s.radius + e.radius)!;
      if (covered.length <= e.cells.length / 3) {e.inferno?.suppress(covered);e.cells = e.cells.filter(c => !covered.includes(c)); return true;}
      emit({...this.base(e, time), type: 'extinguish', smokeId: smoke?.id ?? 0});
      this.sound(e, time, 'extinguish', 20, emit); return false;
    });
  }
}
