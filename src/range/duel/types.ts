import type {Vec, MoveInput} from '../actor-physics';
import type {Equipment, Slot} from '../equipment';

export type ActorId = number;
export type ActorCommand = MoveInput & {
  yawDelta: number;
  pitchDelta: number;
  fireHeld: boolean;
  firePressed: boolean;
  reloadPressed: boolean;
  equipSlot?: Slot;
};
export const idleCommand = (): ActorCommand => ({forward: 0, side: 0, walk: false, crouch: false, jump: false,
  yawDelta: 0, pitchDelta: 0, fireHeld: false, firePressed: false, reloadPressed: false});
export type Hitgroup = 'head' | 'chest' | 'stomach' | 'arm' | 'leg';
export type DuelActorSnapshot = {
  id: ActorId;
  generation: number;
  side: 'player' | 'enemy';
  position: Vec;
  feet: number;
  grounded?: boolean;
  velocity: {x: number; z: number};
  yaw: number;
  pitch: number;
  crouched: boolean;
  duckAmount: number;
  health: number;
  armor: number;
  helmet: boolean;
  alive: boolean;
  equipment: Equipment;
  ammo: number;
  reloading: boolean;
};
export type DuelEvent =
  | {kind: 'sound'; tick: number; actorId: ActorId; sound: 'footstep' | 'landing'; point: Vec}
  | {kind: 'fire'; tick: number; actorId: ActorId; shotId: number; equipment: Equipment; origin: Vec; direction: Vec}
  | {kind: 'hit'; tick: number; shooter: ActorId; victim: ActorId; shotId: number; group: Hitgroup; point: Vec; healthDamage: number; armorDamage: number; lethal: boolean}
  | {kind: 'surface'; tick: number; shooter: ActorId; shotId: number; point: Vec; surfaceId: number}
  | {kind: 'round'; tick: number; outcome: 'won' | 'lost' | 'draw'; seconds: number};
