import type {Vec, MoveInput} from '../actor-physics';
import type {Equipment, Slot} from '../equipment';
import type {PunchAngle} from '../aim-punch';
import type {ShotState} from '../shot-state';
import type {UtilityKind} from './utility-loadout';

export type ActorId = number;
export type ActorCommand = MoveInput & {
  yawDelta: number;
  pitchDelta: number;
  fireHeld: boolean;
  firePressed: boolean;
  reloadPressed: boolean;
  reloadHeld?: boolean;
  usePressed?: boolean;
  pickupPressed?:boolean;
  dropPressed?: boolean;
  secondaryPressed?: boolean;
  secondaryHeld?: boolean;
  equipSlot?: Slot;
  utilityKind?: UtilityKind | null;
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
  verticalVelocity?: number;
  velocity: {x: number; z: number};
  yaw: number;
  pitch: number;
  aimPunch?: PunchAngle;
  deathDirection?: Vec;
  deathGroup?:Hitgroup;
  recentHits?:readonly import('./hit-reaction').HitReactionEvent[];
  crouched: boolean;
  duckAmount: number;
  health: number;
  armor: number;
  helmet: boolean;
  alive: boolean;
  equipment: Equipment;
  ammo: number;
  reloading: boolean;
  reserve?: number;
  reloadSilent?: boolean;
  action?: 'reload' | 'fire' | 'draw' | 'inspect';
  actionAt?: number;
  supportingActor?: number;
  scopeFov?: number;
  utility?: UtilityKind;
  flashAmount?: number;
};
export type DuelEvent =
  | {kind: 'utility-pickup'; tick: number; actorId: ActorId; dropId: number; utility: UtilityKind}
  | {kind: 'utility'; tick: number; actorId: ActorId; utility: UtilityKind;
      action: 'throw' | 'bounce' | 'detonate' | 'decoy' | 'extinguish'; point: Vec; sound?: string; equipment?: Equipment; strength?: number; throwStartedAt?: number}
  | {kind: 'action'; tick: number; actorId: ActorId; equipment: Equipment; action: string; silent?: boolean}
  | {kind: 'environment'; tick: number; actorId: ActorId; environmentId: string; action: 'open' | 'close' | 'break' | 'move'; point: Vec}
  | {kind: 'pickup'; tick: number; actorId: ActorId; dropId: number; equipment: Equipment}
  | {kind: 'sound'; tick: number; actorId: ActorId; sound: 'footstep' | 'landing'; point: Vec}
  | {kind: 'fire'; tick: number; actorId: ActorId; shotId: number; equipment: Equipment; origin: Vec; direction: Vec; pelletDirections?:Vec[]; alternate?:boolean; ordinal?:number; accuracy?: ShotState}
  | {kind: 'hit'; tick: number; shooter: ActorId; victim: ActorId; shotId: number; group: Hitgroup; point: Vec; healthDamage: number; armorDamage: number; lethal: boolean;
      armored?:boolean;helmet?:boolean;direction?:Vec;utility?:UtilityKind}
  | {kind: 'surface'; tick: number; shooter: ActorId; shotId: number; point: Vec; surfaceId: number; phase?: 'entry' | 'exit'; material?: string; residualDamage?: number}
  | {kind: 'round'; tick: number; outcome: 'won' | 'lost' | 'draw'; seconds: number};
