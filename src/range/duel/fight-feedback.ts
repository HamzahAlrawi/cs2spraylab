import type {Equipment} from '../equipment';

export type ShotEvidence = {
  aimOnTarget: boolean; rayOnTarget: boolean; stoppedByCover: boolean;
  recoilDegrees: number; recovering: boolean;
};
export type FightTrace = {
  enemy: number; started: number; firstShot: number; range: number; speed: number;
  visibleEnemies: number;
  entered: boolean; oppositeInput: boolean; prepared: boolean | null; low: boolean;
  shots: number; hits: number; heads: number; damage: number; killed: boolean;
  openingHit: boolean; firstDamage?: number; killedAt?: number;
};
export type FeedbackShot = {
  id: number; at: number; equipment: Equipment; cycle: number; target?: number;
  appropriate: boolean; airborne: boolean; hit: boolean; hiddenHit: boolean;
  evidence?: ShotEvidence; fight?: FightTrace;
};
export type FightFinding = {key: string; title: string; evidence: string; action: string; goal: string};
export type DuelDebrief = {
  fights: FightTrace[];
  misses: {aim: number; spread: number; cover: number; unclassified: number};
  openingHits: number; openings: number; firstShotMs: number | null;
  findings: FightFinding[];
};
export type DamageEvidence = {amount: number; lethal: boolean; reloading: boolean; visible: boolean | null; visibleCount: number};
type Candidate = FightFinding & {priority: number};
export const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Only classify observed target shots. A random cone is not evidence of poor
// aim; a pre-spread ray is not a pure recoil-control measurement either.
export function fightDebrief(shots: FeedbackShot[], fights: FightTrace[], damage: DamageEvidence[] = []): DuelDebrief {
  const measured = shots.filter(shot => shot.target !== undefined && (!shot.hiddenHit || shot.hit));
  const measuredFights = new Set(measured.map(shot => shot.fight));
  const eligible = fights.filter(fight => measuredFights.has(fight));
  const misses = {aim: 0, spread: 0, cover: 0, unclassified: 0};
  for (const shot of measured) if (!shot.hit) {
    const e = shot.evidence;
    if (e?.stoppedByCover) misses.cover++;
    else if (e && !e.aimOnTarget) misses.aim++;
    else if (e?.aimOnTarget && !e.rayOnTarget) misses.spread++;
    else misses.unclassified++;
  }
  const findings: Candidate[] = [];
  const add = (key: string, title: string, evidence: string, action: string, goal: string, priority: number) =>
    findings.push({key, title, evidence, action, goal, priority});
  const bad = measured.filter(shot => !shot.appropriate && !shot.airborne);
  const early = eligible.filter(fight => {
    const opening = measured.find(shot => shot.fight === fight);
    return opening && !opening.appropriate && !opening.airborne;
  });
  const air = measured.filter(shot => shot.airborne);
  if (bad.length) {
    const speeds = early.map(fight => fight.speed);
    add('movement', early.length ? 'Counter-strafe before the first bullet' : 'Stop before the follow-up shot',
      `${early.length}/${eligible.length} openings fired before movement accuracy settled; ${bad.length}/${measured.length} shots had excess movement spread${speeds.length ? ` (opening speed ${Math.round(median(speeds)!)} u/s)` : ''}.`,
      early.length ? 'Stop the strafe before firing. Tap the opposite direction to brake; crouching alone does not instantly make a running shot accurate.'
        : 'Your opening stop was clean, but you moved during follow-up fire. Finish the controlled burst before strafing, or break the spray and reposition behind cover.',
      early.length ? 'Next five duels: at least four settled opening shots.' : 'Next three duels: keep the committed burst settled, then move.',
      early.length / Math.max(1, eligible.length) * 80 + bad.length / measured.length * 40);
  }
  if (air.length) add('air', 'Land before committing to the shot',
    `${air.length}/${measured.length} measured shots were airborne.`,
    'Jump spot for information, then take a separate grounded shooting peek.',
    'Next five committed duels: no airborne opening shots.', air.length / measured.length * 105);
  const crossfire = eligible.filter(fight => fight.visibleEnemies > 1);
  if (crossfire.length) add('exposure', 'Use cover to isolate the duel',
    `${crossfire.length}/${eligible.length} openings exposed you to more than one visible enemy at the shot.`,
    'Slice the pie around cover: finish the nearest threat without opening the second line. After a kill, deny the trade before taking the next duel.',
    'Next three openings: one visible opponent at the shot when cover allows.', crossfire.length / eligible.length * 75);
  const low = eligible.filter(fight => fight.low);
  const unprepared = eligible.filter(fight => fight.prepared === false);
  const prepared = eligible.filter(fight => fight.prepared !== null);
  if (unprepared.length) add('placement', low.length ? 'Carry your crosshair at head height' : 'Pre-aim the angle before you expose yourself',
    `${unprepared.length}/${prepared.length} known openings needed more than a micro-correction${low.length ? `; ${low.length} rifle openings began below the exposed head` : ''}.`,
    low.length ? 'Set head height before swinging, adjusting for elevation and crouched enemies. Use the mouse for the off-angle correction.'
      : 'Clear one likely position at a time with your crosshair already near it. Use your strafe for alignment, then correct the off-angle before firing.',
    'Next five openings: four prepared crosshair placements.', unprepared.length / Math.max(1, prepared.length) * 70);
  const chains: FeedbackShot[][] = [];
  for (const shot of measured) {
    const chain = chains[chains.length - 1], prev = chain?.[chain.length - 1];
    if (prev && prev.target === shot.target && prev.equipment === shot.equipment && shot.at - prev.at >= 0 &&
      shot.at - prev.at <= Math.max(.18, prev.cycle * 1.6)) chain!.push(shot);
    else chains.push([shot]);
  }
  const rifles = ['ak47', 'm4a4', 'm4a1s', 'galil', 'famas', 'sg553', 'aug'];
  const late = chains.filter(chain => chain.length >= 6 && rifles.includes(chain[0].equipment)).flatMap(chain => chain.slice(3));
  const lost = late.filter(shot => !shot.hit && shot.evidence && !shot.evidence.aimOnTarget && !shot.evidence.stoppedByCover);
  if (lost.length >= 2) add('control', 'Your follow-up aim left the target',
    `${lost.length}/${late.length} later rifle bullets missed the target shape even before random spread. This includes aim, recoil and damage punch, not spread alone.`,
    'Keep pulling down and tracking through the spray. If you lose the target at range, reset behind cover and re-peek with a short burst.',
    'Next three rifle duels: keep the follow-up aim on the model or reset behind cover.', lost.length / late.length * 85);
  if (misses.aim >= 2 && lost.length < 2) add('aim', 'Confirm the shot before committing',
    `${misses.aim} misses had the aim/recoil ray outside the target shape, before random spread was added.`,
    'Make the small mouse correction before the shot. At range, favor controlled taps or short bursts over chasing a missed opening with a long spray.',
    'Next three duels: line up the opening before committing to follow-ups.', misses.aim / measured.length * 70);
  if (misses.cover) add('cover', 'Wait for a hittable exposure',
    `${misses.cover} aimed shots were stopped by cover before reaching the target shape.`,
    'Shoot the exposed part of the model, or change the peek width. Do not keep spraying the same blocked line.',
    'Next three duels: move the firing line off the blocking edge.', misses.cover / measured.length * 60);
  if (misses.spread) add('spread', 'These misses were not all aim errors',
    `${misses.spread} misses had the aim/recoil ray on the model, but random dispersion moved the fired ray off it.`,
    'Do not chase a random miss with a large flick. Settle movement and allow recovery between distant bursts; one aligned shot can still miss.',
    'Compare another five settled openings at the same range.', 5);
  const reloadHits = damage.filter(hit => hit.reloading);
  if (reloadHits.length) add('reload', 'Break line of sight before reloading',
    `${Math.round(reloadHits.reduce((sum, hit) => sum + hit.amount, 0))} damage taken during reload${reloadHits.some(hit => hit.lethal) ? ', including the killing shot' : ''}.`,
    'Tuck fully behind cover before the magazine change. If the fight is still live, reposition or use the sidearm instead of reloading in the angle.',
    'Next three reloads: break the firing line first.', reloadHits.some(hit => hit.lethal) ? 95 : 50);
  const unseen = damage.filter(hit => hit.visible === false);
  if (unseen.length) add('awareness', 'Check the angle that can punish your fight',
    `${Math.round(unseen.reduce((sum, hit) => sum + hit.amount, 0))} damage came from enemies outside your current visible contacts${unseen.some(hit => hit.lethal) ? ', including the killing shot' : ''}. This does not prove their exact position was knowable.`,
    'Use cover to limit the angles that can shoot you. After contact or a kill, reposition instead of staying exposed to an unchecked line.',
    'Next three fights: protect the unchecked angle while taking the duel.', unseen.some(hit => hit.lethal) ? 65 : 30);
  const openingHits = eligible.filter(fight => fight.openingHit).length;
  if (!findings.length && misses.aim === 1) add('aim-sample', 'The recorded aim line missed the model',
    'One miss had the aim/recoil ray outside the target shape before random dispersion. One shot is not a consistency verdict.',
    'Check the small correction before the opening shot. Keep compensating if recoil is still active rather than treating every trigger press as a fresh first bullet.',
    'Compare five more openings at this range before judging consistency.', 0);
  if (!findings.length && eligible.length && openingHits === eligible.length) add('strength', 'Your openings connected',
    `${openingHits}/${eligible.length} opening shots hit; ${eligible.filter(fight => fight.killed).length} fights ended in a kill.`,
    'Keep that first-bullet setup. After the kill, use cover to deny the next enemy a free trade instead of staying on the same line.',
    'Repeat five openings with the same first-bullet consistency.', 0);
  if (!findings.length && eligible.length) add('opening-result', 'Check the opening, not just the final kill',
    `${openingHits}/${eligible.length} opening shots connected; ${eligible.filter(fight => fight.hits > 0).length} fights dealt damage. Remaining miss causes could not be established from the recording.`,
    'Keep the settled setup and confirm the exposed target before committing. Do not change your sensitivity or spray based on an unexplained single miss.',
    'Next five openings: compare first-shot hits with the same weapon and range.', 0);
  const firstShotMs = median(eligible.map(fight => Math.max(0, fight.firstShot - fight.started) * 1000));
  return {fights: eligible.slice(-6).map(fight => ({...fight})), misses, openingHits, openings: eligible.length, firstShotMs,
    findings: findings.sort((a, b) => b.priority - a.priority).slice(0, 3).map(({priority: _priority, ...finding}) => finding)};
}

// History is user-controlled and can predate this schema. Keep malformed optional
// evidence out of React without discarding an otherwise valid saved round.
export function readDuelDebrief(value: unknown): DuelDebrief | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as DuelDebrief;
  const n = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const s = (x: unknown) => typeof x === 'string' && x.length <= 1500 && !/NaN|undefined|\[object|[\x00-\x08]/.test(x);
  if (!n(v.openings) || !n(v.openingHits) || v.openingHits > v.openings || !(v.firstShotMs === null || n(v.firstShotMs)) ||
    !v.misses || !['aim', 'spread', 'cover', 'unclassified'].every(k => n(v.misses[k as keyof typeof v.misses])) ||
    !Array.isArray(v.findings) || !Array.isArray(v.fights)) return;
  const findings = v.findings.slice(0, 3).filter(row => row && [row.key, row.title, row.evidence, row.action, row.goal].every(s));
  const fights = v.fights.slice(-6).filter(row => row &&
    [row.enemy, row.started, row.firstShot, row.range, row.speed, row.visibleEnemies, row.shots, row.hits, row.heads, row.damage].every(n) &&
    (row.firstDamage === undefined || n(row.firstDamage)) &&
    (row.killedAt === undefined || n(row.killedAt)) &&
    [row.entered, row.oppositeInput, row.low, row.killed, row.openingHit].every(x => typeof x === 'boolean') &&
    (row.prepared === null || typeof row.prepared === 'boolean'));
  return {...v, findings, fights};
}
