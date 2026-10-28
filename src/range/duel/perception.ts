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
export type VisibleEnemy = {id: number; aimPoint: Vec; headPoint?: Vec; bodyPoint?: Vec; position: Vec;
  candidates?: readonly VisibleAimCandidate[]; aimCandidate?: VisibleAimCandidate};
export type BotPerceptionOptions = {
  /** WeaponActions.horizontalFov, degrees (90 unscoped). Explicit SensorView wins. */
  horizontalFov?: number;
  /** Own spread/inaccuracy plus residual aim/recoil uncertainty, in radians. */
  angularUncertainty?: number;
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
  ...(enemy.aimCandidate ? {aimCandidate: {...enemy.aimCandidate, point: {...enemy.aimCandidate.point}}} : {})});

/** Heuristic expected utility, not a calibrated physical hit-probability model. */
export function selectVisibleAimCandidate(self: DuelActorSnapshot, candidates: readonly VisibleAimCandidate[],
  options: BotPerceptionOptions = {}): VisibleAimCandidate | undefined {
  const stats = weaponModeStats(self.equipment, (options.horizontalFov ?? self.scopeFov ?? 90) < 90);
  const baseline = ('stand' in stats ? self.crouched ? stats.crouch : stats.stand : .01) +
    ('spread' in stats ? stats.spread : 0);
  const uncertainty = Number.isFinite(options.angularUncertainty)
    ? clamp(options.angularUncertainty!, 0, 1) : baseline;
  const previous = options.previousVisible?.aimCandidate;
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
    if (previous && candidate.observedAt >= previous.observedAt && candidate.observedAt - previous.observedAt <= .075 &&
      candidate.group === previous.group && Math.hypot(point.x - previous.point.x,
        point.y - previous.point.y, point.z - previous.point.z) <= .35) score *= 1.15;
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
    const distance = Math.hypot(opponent.position.x - self.position.x, opponent.position.z - self.position.z);
    if (distance >= nearest || !actorInSensorView(self, opponent, sensorView) || actorFullyOccluded(self, opponent, arena)) continue;
    const points = visibleActorPoints(self, opponent, arena, sensorView, poseProvider?.(opponent), visibilityFilter);
    if (points) {
      nearest = distance;
      const candidates = points.candidates.map(c => ({...c, observedAt: time}));
      const aimCandidate = selectVisibleAimCandidate(self, candidates, {...options,
        previousVisible: options.previousVisible?.id === opponent.id ? options.previousVisible : null});
      visible = {id: opponent.id, ...points, candidates, aimCandidate,
        aimPoint: {...(aimCandidate?.point ?? points.aimPoint)}, position: {...opponent.position}};
    }
  }
  return {time, self, visible, view: {...sensorView},
    ...(visibilityFilter ? {visibilityFilter} : {}),
    ...(shadows.length ? {shadowCues: observeShadows(time, self, shadows, arena, sensorView, visibilityFilter)} : {})};
}
