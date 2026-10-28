import type {CoachingSummary, SkillMetric} from './coaching-types';
import {equipmentStats, isShotgun} from './equipment';
import type {ImpactSample, Result} from './simulation';
import {movementInaccuracy, type AccuracyParameters} from './ballistics';
import {accuracySpeedUnits, direction} from './shot-model';
import {DEG, type Vec} from './actor-physics';

export type RangePractice = {spread: boolean; moving: boolean; distance: number; burst: number;
  transferRule: 'bullet' | 'kill'; transferAfter: number; pace?: 'practice' | 'challenge'; peekDuration?: number};
export type RangeShotSkill = {
  at: number; distance: number; aimX: number; aimY: number; settled: boolean;
  target: number; wrongTarget: boolean; targetAlive: boolean;
};
export function measureRangeShot(input: {origin: Vec; targetPoint: Vec; yaw: number; pitch: number;
  recoil: {yaw: number; pitch: number}; velocity: {x: number; z: number}; stats: AccuracyParameters;
  walking: boolean; grounded: boolean; at: number; target: number; wrongTarget: boolean; targetAlive: boolean}): RangeShotSkill {
  const ray = direction(input.yaw - input.recoil.yaw * DEG, input.pitch + input.recoil.pitch * DEG);
  const t = (input.targetPoint.z - input.origin.z) / ray.z;
  const speed = accuracySpeedUnits(input.velocity);
  return {at: input.at, target: input.target, wrongTarget: input.wrongTarget, targetAlive: input.targetAlive,
    distance: Math.hypot(input.targetPoint.x - input.origin.x, input.targetPoint.y - input.origin.y, input.targetPoint.z - input.origin.z),
    aimX: t > 0 && Number.isFinite(t) ? input.origin.x + ray.x * t - input.targetPoint.x : 100,
    aimY: t > 0 && Number.isFinite(t) ? input.origin.y + ray.y * t - input.targetPoint.y : 100,
    settled: input.grounded && movementInaccuracy(input.stats, speed / (input.stats.speed ?? 1), input.walking, speed) === 0};
}
const percent = (n: number, d: number) => d ? n / d * 100 : 0;
const bounded = (n: number) => Math.max(0, Math.min(100, n));
const bodyAim = (weapon: Result['weapon']) => ['awp', 'g3sg1', 'scar20', 'zeus'].includes(weapon) || isShotgun(weapon);
const measured = (s: ImpactSample): s is ImpactSample & RangeShotSkill =>
  ['at', 'distance', 'aimX', 'aimY', 'target'].every(k => Number.isFinite(s[k as keyof ImpactSample]))
  && typeof s.settled === 'boolean' && typeof s.targetAlive === 'boolean' && typeof s.wrongTarget === 'boolean';

function inEnvelope(s: RangeShotSkill, guided: boolean, body: boolean) {
  if (guided && !body) return Math.hypot(s.aimX, s.aimY) <= .2;
  // This is a coaching envelope, never a replacement for the physical hit test.
  return Math.abs(s.aimX) <= .3 && s.aimY >= -1.35 && s.aimY <= .17;
}
function preparation(s: RangeShotSkill, body: boolean) {
  const center = body ? -.65 : 0, radius = body ? .45 : .22;
  return bounded(100 * (1 - Math.max(0, Math.hypot(s.aimX, s.aimY - center) - radius) / (radius * 4)));
}
export function comparableRangePractice(a: Result, b: Result) {
  const x = a.practice, y = b.practice;
  return !!x && !!y && a.mode === b.mode && a.weapon === b.weapon && x.spread === y.spread && x.moving === y.moving
    && x.burst === y.burst && Math.abs(x.distance - y.distance) <= Math.max(2, x.distance * .2)
    && x.pace === y.pace && x.peekDuration === y.peekDuration
    && (a.mode !== 'transfer' || x.transferRule === y.transferRule && x.transferAfter === y.transferAfter);
}

function coachTapSeries(result: Result, previous: readonly Result[]): CoachingSummary | undefined {
  if (result.mode === 'transfer' || equipmentStats(result.weapon).fullAuto || result.shots > 2 || !result.samples.some(measured)) return;
  const now = Date.parse(result.date);
  const attempts = [result, ...previous.filter(row => comparableRangePractice(result, row)
    && row.shots <= 2 && Date.parse(row.date) <= now && now - Date.parse(row.date) <= 30000)].slice(0, 10);
  const rows = attempts.flatMap(row => row.samples.filter(measured));
  if (rows.length < 3) return;
  const body = bodyAim(result.weapon), eligible = rows.filter(row => row.settled).length;
  const timing = percent(eligible, rows.length), alignment = rows.reduce((n, row) => n + preparation(row, body), 0) / rows.length;
  const hitCount = rows.filter(row => row.hit).length, accuracy = percent(hitCount, rows.length);
  const score = Math.round(timing * .4 + alignment * .4 + accuracy * .2);
  let focus = 'Repeat the deliberate tap series';
  let action = body ? 'Keep the upper-body pre-aim. Use cover between shots instead of chasing headshot percentage with this weapon.'
    : 'Keep the first-bullet placement and stop-shoot rhythm. Re-aim each tap; do not let the click get ahead of the crosshair.';
  let goal = 'Next five taps: at least four grounded, movement-settled shots with a prepared shot center.';
  if (eligible < rows.length) {focus = 'Brake before the next tap'; action = 'Counter-strafe before each tap. Clicking faster does not clear running or jump inaccuracy.'; goal = 'Next five taps: zero movement-penalized or airborne shots.';}
  else if (alignment < 80) {focus = 'Recenter the follow-up taps'; action = 'Let recoil reset between taps, or compensate what remains. Releasing fire is not an instant reset; re-aim before the next click.'; goal = 'Next five taps: average shot-center preparation above 80/100 before increasing pace.';}
  else if (accuracy < 50 && result.practice?.spread) {focus = 'Compare recovered taps'; action = 'The recoil-corrected aim was close, but hits were low. Compare slower taps at the same range to check accuracy recovery; do not change your pull for every spread miss.'; goal = 'Compare two five-tap sets at the same range; retain prepared centers and improve actual hit rate.';}
  const range = rows.reduce((n, row) => n + row.distance, 0) / rows.length;
  return {score, focus, action, goal,
    evidence: `Recent ${rows.length} taps: ${hitCount}/${rows.length} physical hits, ${eligible}/${rows.length} settled, ${Math.round(alignment)}/100 average shot-center preparation at ${range.toFixed(1)} m. Latest attempt: ${result.hits}/${result.shots} hits.`,
    confidence: `${rows.length} measured taps across ${attempts.length} comparable attempts in the last 30 s. Small local sample, not a rank. No shot or recoil state is reset for scoring.`,
    strength: eligible === rows.length ? 'Every recent tap avoided running and jump inaccuracy. Keep that stop-shoot timing.' : undefined,
    metrics: [
      {label: 'Tap shot discipline', value: `${eligible}/${rows.length}`, score: timing, detail: '40% weight. Grounded, native firing-mode movement eligibility over recent comparable taps.'},
      {label: 'Tap preparation', value: `${Math.round(alignment)}/100`, score: alignment, detail: '40% weight. Recoil-corrected centers at each press, including persistent punch between presses.'},
      {label: 'Tap physical hits', value: `${hitCount}/${rows.length}`, score: accuracy, detail: '20% weight. Actual impact results; random spread remains in these outcomes.'},
    ]};
}

export function coachRangeAttempt(result: Result, previous: readonly Result[] = []): CoachingSummary {
  const taps = coachTapSeries(result, previous);
  if (taps) return taps;
  const rows = result.samples.filter(measured), body = bodyAim(result.weapon), guided = result.mode === 'guided';
  const transfer = result.mode === 'transfer', stats = equipmentStats(result.weapon);
  const first = rows[0], settled = percent(rows.filter(s => s.settled).length, rows.length);
  const useful = rows.filter(s => s.targetAlive), containment = percent(useful.filter(s => inEnvelope(s, guided, body)).length, useful.length);
  const opening = first ? preparation(first, body) : 0;
  const early = useful.slice(0, Math.min(6, useful.length)), late = useful.slice(6);
  const earlyRate = percent(early.filter(s => s.hit).length, early.length), lateRate = percent(late.filter(s => s.hit).length, late.length);
  const earlyControl = percent(early.filter(s => inEnvelope(s, guided, body)).length, early.length);
  const lateControl = percent(late.filter(s => inEnvelope(s, guided, body)).length, late.length);
  const hitRate = percent(result.hits, result.shots), range = rows.length ? rows.reduce((n, s) => n + s.distance, 0) / rows.length : result.practice?.distance ?? 0;
  const laneA = useful.filter(s => s.target === 0), laneB = useful.filter(s => s.target === 1);
  const firstB = laneB.findIndex(s => s.hit), wrong = rows.filter(s => s.wrongTarget).length;
  const acquired = firstB < 0 ? 0 : bounded(100 - firstB * 20);
  const aControl = percent(laneA.filter(s => inEnvelope(s, false, body)).length, laneA.length);
  const bControl = percent(laneB.filter(s => inEnvelope(s, false, body)).length, laneB.length);
  const control = transfer ? aControl * .4 + bControl * .4 + acquired * .2 : containment;
  let score: number | null = rows.length >= 3 ? Math.round(settled * .25 + opening * .25 + control * .5) : null;
  if (score !== null && transfer && !laneB.length) score = Math.min(50, score);
  if (score !== null && transfer && !laneA.some(s => s.hit)) score = Math.min(35, score);
  let focus = 'Repeat the same control', evidence = `${result.hits}/${result.shots} hits at ${range.toFixed(1)} m; ${Math.round(containment)}% of aim points after recoil correction stayed ${guided && !body ? 'near the head guide' : 'on the target area'}, before random spread.`;
  let action = guided ? 'Keep the spray grouped, then try the same range without the guide. Learn the correction before adding distance.' : 'Keep the first bullet prepared and the spray grouped. Controlled body follow-ups are fine; do not chase headshots through the whole magazine.';
  let goal = guided ? 'Keep at least 80% of shot centers near the guide for three attempts, then repeat without it.' : 'Keep at least 80% of shot centers on the target envelope, with a settled opening, for three attempts.';
  if (!rows.length) {
    focus = 'New measurements needed'; evidence = `${result.hits}/${result.shots} hits are recorded, but this older attempt has no shot-state measurements.`;
    action = 'Fire a new attempt to measure preparation, movement and recoil control separately.'; goal = 'Complete one measured attempt; old hit rates are not converted into skill scores.';
  } else if (settled < 90) {
    focus = 'Remove movement inaccuracy'; evidence = `${rows.filter(s => !s.settled).length}/${rows.length} shots carried movement or airborne inaccuracy at ${range.toFixed(1)} m.`;
    action = 'Counter-strafe before starting this spray rep. Crouching is not an instant brake; keep controlling recoil if you crouch into the spray.';
    goal = 'Fire the next attempt with every shot grounded and below this weapon mode\'s movement-inaccuracy threshold.';
  } else if (opening < 70) {
    focus = body ? 'Pre-aim the upper body' : 'Prepare the opening aim';
    evidence = `Your first shot center started ${Math.abs(first.aimX).toFixed(2)} m sideways and ${Math.abs(first.aimY - (body ? -.65 : 0)).toFixed(2)} m from ${body ? 'upper-body' : 'head'} height.`;
    action = `Pre-aim the ${body ? 'exposed upper body' : 'head'} before firing. Start on target; extra pull through the spray will not fix a misplaced first bullet.`;
    goal = `Start the next three attempts within ${body ? '45' : '22'} cm of the ${body ? 'upper-body' : 'head'} coaching anchor.`;
  } else if (transfer && !laneB.length) {
    focus = 'Complete the second target'; evidence = `A received ${laneA.length} shots; no shot reached the scheduled B phase.`;
    action = result.practice?.transferRule === 'kill' ? 'Secure the first kill on A, then transfer the spray to B. Keep the trigger held and carry the recoil correction across.' : `Spray A until bullet ${result.practice?.transferAfter ?? '?'}, then transfer to B as the phase changes. Keep the recoil correction going.`;
    goal = 'Connect on both A and B in one continuous attempt; control on A alone cannot complete a transfer.';
  } else if (transfer && (firstB < 0 || firstB > 2 || wrong)) {
    focus = 'Acquire B without restarting recoil'; evidence = `A: ${laneA.filter(s => s.hit).length}/${laneA.length} hits. B: ${laneB.filter(s => s.hit).length}/${laneB.length} hits; ${firstB < 0 ? 'no B hit' : `${firstB} missed rounds before its first hit`}${wrong ? `; ${wrong} shots struck the wrong target` : ''}.`;
    action = 'Transfer the crosshair to B while keeping your current recoil correction. You are still mid-spray, not firing a fresh first bullet.';
    goal = 'Hit B within its first three scheduled rounds while still connecting on A.';
  } else if (late.length >= 3 && containment < 80 && lateControl < 80) {
    // Diagnose only centers outside this exercise's actual coaching area.
    // The head guide is circular; body-spray thresholds mislabelled low/side head misses as climb.
    const missed = late.filter(s => !inEnvelope(s, guided, body)), headGuide = guided && !body;
    const high = missed.filter(s => headGuide ? s.aimY >= 0 && Math.abs(s.aimY) >= Math.abs(s.aimX) : s.aimY > .17).length;
    const low = missed.filter(s => headGuide ? s.aimY < 0 && Math.abs(s.aimY) >= Math.abs(s.aimX) : s.aimY < -1.35).length;
    const horizontal = missed.filter(s => headGuide ? Math.abs(s.aimX) > Math.abs(s.aimY) : Math.abs(s.aimX) > .3).length;
    focus = high >= Math.max(low, horizontal) ? 'Control the later climb' : low >= horizontal ? 'Ease the downward correction'
      : result.practice?.moving ? 'Track while controlling recoil' : 'Match the sideways recoil';
    evidence = `Rounds 1-${early.length}: ${Math.round(earlyRate)}% hits. Later rounds: ${Math.round(lateRate)}%; ${high} centers high, ${low} low, ${horizontal} outside the sides. These counts can overlap.`;
    action = focus === 'Control the later climb' ? 'The spray is climbing. Add downward correction as it rises; practise a shorter section at this range, then extend it once the group stays on target.'
      : focus === 'Ease the downward correction' ? 'You are overpulling the late spray. Ease the downward pull and watch the low impacts; recoil control is not one constant-speed drag.'
      : result.practice?.moving ? 'Follow the moving target laterally while keeping the recoil correction. Sideways misses here can include tracking error, not just the weapon pattern.'
      : 'The late spray is drifting sideways. Keep the vertical control and learn the horizontal change with the guide, then repeat without it.';
    goal = 'Improve late-section containment to 80% before extending the spray or distance.';
  } else if (early.length >= 3 && containment < 80 && earlyControl < 80) {
    focus = 'Control the opening shots';
    evidence = `First ${early.length} rounds: ${Math.round(earlyControl)}% of recoil-corrected aim points stayed on the practice area${late.length ? `; later rounds: ${Math.round(lateControl)}%` : ''}.`;
    action = stats.fullAuto ? 'Keep the first-bullet pre-aim and practise the opening burst. Start the recoil correction with the first few rounds, then extend the spray once that group stays on target.'
      : 'Keep the first-bullet pre-aim and re-aim the early follow-ups. Compare a slower tap rhythm before increasing pace.';
    goal = 'Next three attempts: keep at least 80% of opening shot centers on the practice area.';
  } else if (containment >= 80 && hitRate < 50 && result.practice?.spread) {
    focus = 'Separate dispersion from recoil error'; evidence = `${Math.round(containment)}% of shot centers were controlled, but only ${Math.round(hitRate)}% physically hit at ${range.toFixed(1)} m with spread on.`;
    action = range > 25 && !body ? 'Keep the good correction. Compare short bursts or taps with a reset at this range; random spread cannot be cancelled by pulling harder.' : 'Keep the correction for another set. Check accuracy recovery between follow-ups; one spread miss is not a reason to relearn the pattern.';
    goal = 'Compare three same-distance attempts before changing the correction. Keep spread settings the same.';
  } else if (!stats.fullAuto || body) {
    focus = 'Make each follow-up deliberate'; evidence = `${result.hits}/${result.shots} hits at ${range.toFixed(1)} m; ${Math.round(settled)}% settled shots. ${body ? 'Body hits are valid for this weapon.' : 'A semi-automatic weapon is not graded as a rifle spray.'}`;
    action = body ? 'Center the exposed upper body and use cover between shots. Headshot percentage is not the goal for this weapon.' : 'Re-aim and allow accuracy to reset between taps. Speed up only while the follow-up shots stay on target.';
    goal = 'Connect the next three deliberate openings without adding movement inaccuracy.';
  }
  const metrics: SkillMetric[] = [
    {label: 'Shot discipline', value: rows.length ? `${Math.round(settled)}%` : '--', score: rows.length ? settled : null, detail: '25% of score. Actual grounded state and weapon-mode movement inaccuracy, not keys pressed.'},
    {label: 'Opening preparation', value: first ? `${Math.round(opening)}/100` : '--', score: first ? opening : null, detail: '25% of score. Unrandomized recoil-corrected shot center relative to the head or body coaching anchor; not the visible crosshair.'},
    {label: transfer ? 'Transfer control' : 'Recoil containment', value: rows.length ? `${Math.round(control)}%` : '--', score: rows.length ? control : null, detail: transfer ? '50% of score: A/B shot-center control (40/40) and B acquisition (20). Dead-target shots are excluded.' : '50% of score. Shot centers in the practice envelope, before random spread. Guided uses a 20 cm head envelope; Free accepts controlled body follow-ups.'},
    {label: transfer ? 'B acquisition' : 'Physical hit rate', value: transfer ? firstB < 0 ? '--' : `Round ${firstB + 1}` : `${result.hits}/${result.shots}`, score: null, detail: transfer ? 'Scheduled B-phase round of the first actual B hit. Misses and wrong-target hits are preserved.' : 'Real mesh-hit results, including random spread. This is kept separate from control quality.'},
  ];
  const comparable = previous.filter(row => comparableRangePractice(result, row) && row.coaching?.score != null).slice(0, 5);
  const repeated = comparable.length >= 2 && comparable.slice(0, 2).every(row => row.coaching?.focus === focus);
  if (repeated) action = `Same issue in three comparable reps. ${action}`;
  const strength = rows.length >= 3 && settled >= 95 ? 'Clean stop-shoot timing: at least 95% of shots avoided running and jump inaccuracy.' : undefined;
  const trend = score !== null && comparable.length >= 3 ? ` Last-three comparable average: ${Math.round(comparable.slice(0, 3).reduce((sum, row) => sum + row.coaching!.score!, 0) / 3)}/100.` : '';
  return {score, focus, evidence, action, goal, strength, metrics,
    confidence: `${rows.length} measured shots${rows.length < 3 ? '; too few for an overall score' : ''}. Local practice criteria, not a FACEIT rating.${trend}`};
}
