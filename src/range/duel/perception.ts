import {clamp, type Vec} from '../actor-physics';
import {isShotgun, weaponModeStats} from '../equipment';
import type {Arena} from './geometry';
import {actorFullyOccluded, actorInSensorView, visibleActorPoints, type SensorPoseProvider,
  type VisibleHitgroupCandidate} from './actor-visibility';
import {resolveDamage} from './damage';
import type {DuelActorSnapshot} from './types';
import {botSensorView, observeShadows, type EnemyShadowProxy, type SensorView, type ShadowCue,
  type VisibilityFilter} from './shadows';
export type {VisibilityFilter} from './shadows';

// Age is current simulation time minus observedAt; candidates are not live pose references.
export type VisibleAimCandidate = VisibleHitgroupCandidate & {observedAt: number};
export type VisibleEnemy = {id: number; generation?: number; aimPoint: Vec; headPoint?: Vec; bodyPoint?: Vec;
  /** Bots receive a sight point; player HUD spotting retains its radar position contract. */
  position: Vec;
  candidates?: readonly VisibleAimCandidate[]; aimCandidate?: VisibleAimCandidate;
  /** One revalidated visible endpoint while the finite aim motor transfers between parts. */
  aimTransitionFrom?: VisibleAimCandidate};
export type BotPerceptionOptions = {
  /** WeaponActions.horizontalFov, degrees (90 unscoped). Explicit SensorView wins. */
  horizontalFov?: number;
  /** Own spread/inaccuracy cone, in radians; shotAngles supplies residual aim error separately. */
  angularUncertainty?: number;
  /** Own current pre-spread ray, including recoil and damage punch, in radians. */
  shotAngles?: {yaw: number; pitch: number};
  previousVisible?: VisibleEnemy | null;
};
export type BotObservation = {time: number; self: DuelActorSnapshot; visible: VisibleEnemy | null;
  shadowCues?: readonly ShadowCue[]; view?: SensorView;
  /** Same sensor-frame smoke/flash predicate, including for negative sight evidence. */
  visibilityFilter?: VisibilityFilter};

export const copyVisibleEnemy = (enemy: VisibleEnemy): VisibleEnemy => ({...enemy,
  position: {...enemy.position}, aimPoint: {...enemy.aimPoint},
  headPoint: enemy.headPoint ? {...enemy.headPoint} : undefined,
  bodyPoint: enemy.bodyPoint ? {...enemy.bodyPoint} : undefined,
  ...(enemy.candidates ? {candidates: enemy.candidates.map(c => ({...c, point: {...c.point}}))} : {}),
  ...(enemy.aimTransitionFrom ? {aimTransitionFrom: {...enemy.aimTransitionFrom, point: {...enemy.aimTransitionFrom.point}}} : {}),
  ...(enemy.aimCandidate ? {aimCandidate: {...enemy.aimCandidate, point: {...enemy.aimCandidate.point}}} : {})});

const continuesCandidate = (candidate: VisibleAimCandidate, previous?: VisibleAimCandidate) => previous &&
  candidate.observedAt >= previous.observedAt && candidate.observedAt - previous.observedAt <= .075 &&
  candidate.group === previous.group && Math.hypot(candidate.point.x - previous.point.x,
    candidate.point.y - previous.point.y, candidate.point.z - previous.point.z) <= .35;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
function aimError(self: DuelActorSnapshot, point: Vec, angles: {yaw: number; pitch: number}) {
  const dx = point.x - self.position.x, dy = point.y - self.position.y, dz = point.z - self.position.z;
  return {yaw: wrap(Math.atan2(-dx, -dz) - angles.yaw), pitch: Math.atan2(dy, Math.hypot(dx, dz)) - angles.pitch};
}

/** Heuristic expected utility, not a calibrated physical hit-probability model. */
export function selectVisibleAimCandidate(self: DuelActorSnapshot, candidates: readonly VisibleAimCandidate[],
  options: BotPerceptionOptions = {}): VisibleAimCandidate | undefined {
  const stats = weaponModeStats(self.equipment, (options.horizontalFov ?? self.scopeFov ?? 90) < 90);
  const baseline = ('stand' in stats ? self.crouched ? stats.crouch : stats.stand : .01) +
    ('spread' in stats ? stats.spread : 0);
  const weaponUncertainty = Number.isFinite(options.angularUncertainty)
    ? clamp(options.angularUncertainty!, 0, 1) : baseline;
  const previous = options.previousVisible?.aimCandidate;
  const continuing = previous && candidates.some(candidate => continuesCandidate(candidate, previous));
  let residual = 0;
  if (continuing && options.shotAngles) {
    // Compare with the last actually observed setpoint. Do not count all recoil
    // again when the bot's mouse input has already compensated for it.
    const error = aimError(self, previous.point, options.shotAngles);
    const transition = options.previousVisible?.aimTransitionFrom;
    if (transition && candidates.some(candidate => continuesCandidate(candidate, transition))) {
      // Transferring between two visible parts is not new random aim error.
      // This segment estimates error only; it never becomes a firing setpoint.
      const from = aimError(self, transition.point, options.shotAngles);
      const dyaw = wrap(error.yaw - from.yaw), dpitch = error.pitch - from.pitch;
      const length2 = dyaw * dyaw + dpitch * dpitch;
      const t = length2 > 1e-12 ? clamp(-(from.yaw * dyaw + from.pitch * dpitch) / length2, 0, 1) : 0;
      error.yaw = wrap(from.yaw + t * dyaw); error.pitch = from.pitch + t * dpitch;
    }
    const magnitude = Math.hypot(error.yaw, error.pitch);
    if (Number.isFinite(magnitude)) residual = magnitude;
  }
  const uncertainty = clamp(Math.hypot(weaponUncertainty, residual), 0, 1);
  let best: VisibleAimCandidate | undefined, bestScore = -Infinity;
  for (const candidate of candidates) {
    const {point, exposureMargin: margin} = candidate;
    const distance = Math.hypot(point.x - self.position.x, point.y - self.position.y, point.z - self.position.z);
    if (![distance, margin, candidate.exposure, candidate.observedAt].every(Number.isFinite) || margin < 0) continue;
    const radius = Math.max(.005, distance * Math.tan(uncertainty));
    const hitEstimate = margin * margin / (margin * margin + radius * radius);
    // Ordinary full-health/armor assumptions only. Never inspect the opponent's
    // actual HP, armor or helmet. Shotguns value pellet coverage over head bonus.
    const damage = resolveDamage(self.equipment, candidate.group, distance, 100, true).healthDamage;
    const pellets = isShotgun(self.equipment) && 'pellets' in stats ? stats.pellets : 1;
    let score = hitEstimate * Math.min(100, damage * pellets) * (.75 + .25 * clamp(candidate.exposure, 0, 1));
    if (continuesCandidate(candidate, previous)) score *= 1.15;
    if (score > bestScore) {best = candidate; bestScore = score;}
  }
  return best;
}

// Sight normally updates every four simulation ticks. A stalled sensor must
// not leave a live target (and permission to fire) cached indefinitely.
export const currentVisible = (observation: BotObservation | null, time: number) =>
  observation && time >= observation.time && time - observation.time <= .075 ? observation.visible : null;

export function observeBot(time: number, self: DuelActorSnapshot, opponents: DuelActorSnapshot[], arena: Arena,
  view?: SensorView, shadows: readonly EnemyShadowProxy[] = [], poseProvider?: SensorPoseProvider,
  visibilityFilter?: VisibilityFilter, options: BotPerceptionOptions = {}): BotObservation {
  const sensorView = view ?? botSensorView(options.horizontalFov ?? self.scopeFov);
  let visible: VisibleEnemy | null = null;
  let nearest = Infinity;
  for (const opponent of opponents) {
    if (!opponent.alive || opponent.side === self.side) continue;
    if (!actorInSensorView(self, opponent, sensorView) || actorFullyOccluded(self, opponent, arena)) continue;
    const points = visibleActorPoints(self, opponent, arena, sensorView, poseProvider?.(opponent), visibilityFilter);
    if (points) {
      const candidates = points.candidates.map(c => ({...c, observedAt: time}));
      const previousVisible = options.previousVisible?.id === opponent.id &&
          (options.previousVisible.generation === undefined || options.previousVisible.generation === opponent.generation)
          ? options.previousVisible : null;
      const aimCandidate = selectVisibleAimCandidate(self, candidates, {...options, previousVisible});
      const aimPoint = aimCandidate?.point ?? points.aimPoint;
      const distance = Math.hypot(points.aimPoint.x - self.position.x, points.aimPoint.y - self.position.y,
        points.aimPoint.z - self.position.z);
      if (distance >= nearest) continue;
      nearest = distance;
      const previousCandidate = previousVisible?.aimCandidate;
      const transferFrom = aimCandidate && previousCandidate && aimCandidate.group !== previousCandidate.group
        ? previousCandidate : previousVisible?.aimTransitionFrom;
      let aimTransitionFrom = candidates.find(candidate => continuesCandidate(candidate, transferFrom));
      if (aimCandidate && options.shotAngles) {
        const error = aimError(self, aimPoint, options.shotAngles);
        if (Math.hypot(error.yaw, error.pitch) <= (options.angularUncertainty ?? 0))
          aimTransitionFrom = undefined;
      }
      visible = {id: opponent.id, generation: opponent.generation, ...points, candidates, aimCandidate,
        ...(aimTransitionFrom ? {aimTransitionFrom} : {}),
        ...(aimCandidate && aimCandidate.group !== 'head' ? {bodyPoint: {...aimPoint}} : {}),
        aimPoint: {...aimPoint},
        position: {...(self.id === 0 && self.side === 'player' ? opponent.position : points.aimPoint)}};
    }
  }
  return {time, self, visible, view: {...sensorView},
    ...(visibilityFilter ? {visibilityFilter} : {}),
    ...(shadows.length ? {shadowCues: observeShadows(time, self, shadows, arena, sensorView, visibilityFilter)} : {})};
}
