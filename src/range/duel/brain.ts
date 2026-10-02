import {DEG, STEP, UNIT, clamp, type Vec} from '../actor-physics';
import {gameData, type Weapon} from '../config';
import type {BotBehavior} from './config';
import {currentVisible, type BotObservation} from './perception';
import {SightingMemory} from './awareness';
import type {BotTraits} from './skill';
import type {ActorCommand} from './types';

const difference = (target: number, current: number) => Math.atan2(Math.sin(target - current), Math.cos(target - current));
const normal = (random: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());

export class BotBrain {
  private firstSeen = -1;
  private readyAt = Infinity;
  private nextShotAt = 0;
  private readonly memory = new SightingMemory(5);
  private aimYawError = 0;
  private aimPitchError = 0;
  private willStop = true;
  private observation: BotObservation | null = null;

  constructor(private readonly traits: BotTraits, private readonly behavior: BotBehavior,
    private readonly accuracy: number, private readonly random: () => number) {}

  perceive(observation: BotObservation) {
    this.memory.observe(observation);
    this.observation = {...observation, visible: observation.visible ? this.memory.seen : null};
    if (!observation.visible) {
      if (observation.time - this.memory.seenAt > .35) this.firstSeen = -1;
      return;
    }
    if (this.firstSeen < 0) {
      this.firstSeen = observation.time;
      this.readyAt = observation.time + this.traits.recognitionMedianMs / 1000 * Math.exp(.2 * normal(this.random));
      this.aimYawError = normal(this.random) * this.traits.endpointErrorDegrees / this.accuracy * DEG;
      this.aimPitchError = normal(this.random) * this.traits.endpointErrorDegrees / this.accuracy * DEG;
      this.willStop = this.random() < this.traits.stopTendency;
    }
  }

  command(self: BotObservation['self'], time: number): Partial<ActorCommand> {
    const visible = currentVisible(this.observation, time);
    const memoryAim = this.memory.focus(time);
    const remembered = memoryAim ? this.memory.seen : null;
    const identified = visible !== null && time >= this.readyAt;
    const target = visible ?? remembered;
    const approachPoint: Vec = target?.position ?? {x: 0, y: self.position.y, z: 5};
    const dx = approachPoint.x - self.position.x, dz = approachPoint.z - self.position.z;
    const distance = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(-dx, -dz);
    const aimPoint = visible?.aimPoint ?? memoryAim;
    const yawGoal = aimPoint ? Math.atan2(-(aimPoint.x - self.position.x), -(aimPoint.z - self.position.z)) + (visible ? this.aimYawError : 0) : targetYaw;
    const pitchGoal = aimPoint ? Math.atan2(aimPoint.y - self.position.y,
      Math.hypot(aimPoint.x - self.position.x, aimPoint.z - self.position.z)) + (visible ? this.aimPitchError : 0) : 0;
    const maxTurn = (this.traits.motorSettlingMs > 250 ? 170 : 340) * DEG * STEP;
    const viewYaw = self.yaw - (self.aimPunch?.yaw ?? 0) * DEG, viewPitch = self.pitch + (self.aimPunch?.pitch ?? 0) * DEG;
    const yawDelta = clamp(difference(yawGoal, viewYaw), -maxTurn, maxTurn);
    const pitchDelta = clamp(pitchGoal - viewPitch, -maxTurn, maxTurn);
    const engageDistance = this.behavior === 'aggressive' ? 5 : this.behavior === 'holder' ? 18 : 9;
    const advancing = distance > engageDistance && (this.behavior !== 'holder' || !visible);
    const headingError = difference(targetYaw, self.yaw);
    const stop = identified && this.willStop && time >= this.readyAt + this.traits.brakeErrorMs / 1000;
    const moving = advancing && !stop;
    const speed = Math.hypot(self.velocity.x, self.velocity.z);
    const brake = stop && speed > .25;
    const aimError = Math.hypot(difference(yawGoal, viewYaw), pitchGoal - viewPitch);
    const stats = gameData.weapons[self.equipment as Weapon];
    const fire = identified && self.ammo > 0 && !self.reloading && aimError < (this.traits.endpointErrorDegrees + 1.5) * DEG &&
      time >= this.readyAt + this.traits.motorSettlingMs / 1000 &&
      (!this.willStop || speed <= stats.speed * UNIT * .18);
    const press = fire && time >= this.nextShotAt;
    if (press) this.nextShotAt = time + stats.cycle;
    return {
      forward: brake ? (self.velocity.x * Math.sin(self.yaw) + self.velocity.z * Math.cos(self.yaw)) / speed
        : moving ? Math.cos(headingError) : 0,
      side: brake ? (-self.velocity.x * Math.cos(self.yaw) + self.velocity.z * Math.sin(self.yaw)) / speed
        : moving ? -Math.sin(headingError) : 0,
      walk: this.behavior === 'patient' && !identified,
      crouch: false, jump: false, yawDelta, pitchDelta,
      fireHeld: fire, firePressed: press, reloadPressed: self.ammo === 0,
    };
  }
}
