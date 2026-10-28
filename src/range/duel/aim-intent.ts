import type {Vec} from '../actor-physics';

export type GazeOwner = 'combat' | 'trade' | 'repeek' | 'audio' | 'support' | 'shadow' | 'clearing' | 'travel';
export type AimIntent = {owner: GazeOwner; point: Vec; observedAt: number; expiresAt: number; confidence: number};
const priority: Record<GazeOwner, number> = {combat: 8, trade: 7, repeek: 6, audio: 5, support: 4, shadow: 3, clearing: 2, travel: 1};

// Inputs are already-sensed points, never live hidden actor state. Re-peek
// evidence outranks navigation even when the sensor no longer permits fire.
export function arbitrateGaze(time: number, intents: readonly AimIntent[]): AimIntent | null {
  let winner: AimIntent | null = null;
  for (const intent of intents) {
    if (!Number.isFinite(time) || !Number.isFinite(intent.observedAt) || !Number.isFinite(intent.expiresAt) ||
      time < intent.observedAt || time >= intent.expiresAt ||
      ![intent.point.x, intent.point.y, intent.point.z, intent.confidence].every(Number.isFinite) || intent.confidence <= 0) continue;
    if (!winner || priority[intent.owner] > priority[winner.owner] ||
      priority[intent.owner] === priority[winner.owner] && intent.observedAt > winner.observedAt) winner = intent;
  }
  return winner ? {...winner, point: {...winner.point}} : null;
}

export type FireBlockedReason = 'no-sight' | 'stale-sensor' | 'reaction' | 'settling' | 'empty' | 'reload' |
  'weapon-not-ready' | 'information-peek' | 'disengage' | 'closing' | 'range' | 'burst-recovery' |
  'phase' | 'alignment' | 'movement' | 'cooldown';
// Absolute simulation deadline supplied by the shared weapon/equip machinery.
export type TacticalReadiness = {weaponReadyAt?: number};

export function firingVeto(gates: {
  visible: boolean; stale: boolean; recognized: boolean; settled: boolean; ammo: number; reloading: boolean;
  weaponReady: boolean; informationPeek: boolean; disengaging: boolean; closing: boolean; inRange: boolean;
  burstReady: boolean; firingPhase: boolean; aligned: boolean; accurateMovement: boolean; cycleReady: boolean;
}): FireBlockedReason | null {
  if (gates.reloading) return 'reload';
  if (gates.ammo <= 0) return 'empty';
  if (!gates.visible) return gates.stale ? 'stale-sensor' : 'no-sight';
  if (!gates.recognized) return 'reaction';
  if (gates.informationPeek) return 'information-peek';
  if (gates.disengaging) return 'disengage';
  if (!gates.weaponReady) return 'weapon-not-ready';
  if (gates.closing) return 'closing';
  if (!gates.inRange) return 'range';
  if (!gates.burstReady) return 'burst-recovery';
  if (!gates.firingPhase) return 'phase';
  if (!gates.settled) return 'settling';
  if (!gates.aligned) return 'alignment';
  if (!gates.accurateMovement) return 'movement';
  return gates.cycleReady ? null : 'cooldown';
}
