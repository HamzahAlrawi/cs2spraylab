import {useContext, useMemo} from 'react';
import {Download, GraduationCap, Play} from 'lucide-react';
import type {DuelHistory, DuelReview} from './coaching';
import {CoachingActions} from '../CoachingReview';
import {readCoachingSummary, sameCoachingMetrics, type SkillMetric} from '../coaching-types';
import {skillName} from '../coaching-language';
import {practicePlan} from '../adaptive-practice';
import {SkillTrends} from '../PracticeBlock';
import {readDuelDebrief} from './fight-feedback';
import {readAimMetrics} from './aim-metrics';
import {DuelAimProfile} from './DuelAimProfile';
import './duel-scorecard.css';

// Stored reviews can predate optional measurements and the coaching summary.
const number = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const text = (value: unknown) => typeof value === 'string' && value.trim() && value.length <= 1500 &&
  !/\b(?:NaN|undefined|Infinity|null)\b|\[object \w+\]|[\x00-\x08\x0b\x0c\x0e-\x1f]/i.test(value) ? value.trim() : undefined;
const measured = (value: unknown, digits = 0, unit = '', max = Number.MAX_SAFE_INTEGER) =>
  number(value, max) ? `${value.toFixed(digits)}${unit}` : '--';
const count = (value: unknown) => number(value) && Number.isSafeInteger(value) ? String(value) : '--';
const scoreLabel = (value: unknown) => number(value, 100) ? `${Math.round(value)}/100` : 'Unscored';
const hasActivity = (review?: DuelReview) => !!review &&
  [review.shots, review.hits, review.kills, review.damage, review.taken].some(value => number(value) && value > 0);
const scoreFor = (review: DuelReview) => review.coaching?.score === undefined ? review.score : review.coaching.score;
type Stat = [label: string, value: string, help: string];

function Stats({rows}: {rows: Stat[]}) {
  return <dl className="duel-scorecard-stats">{rows.map(([label, value, help]) => <div key={label}>
    <dt title={help}>{label}</dt><dd title={value.includes('--') ? 'Not measured' : undefined}>{value}</dd>
  </div>)}</dl>;
}

function skillMetrics(value: unknown): SkillMetric[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const label = text(row.label), value = text(row.value), detail = text(row.detail);
    return label && value ? [{label, value, detail: detail ?? '', score: number(row.score, 100) ? row.score : null}] : [];
  });
}

function roundTime(value: unknown) {
  const date = typeof value === 'string' && value.trim() ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : 'Time unavailable';
}

export function DuelScorecard({review, completedReview, history, setupKey, completedSetupKey}: {
  review?: DuelReview; completedReview?: DuelReview; history: DuelHistory[]; setupKey?: string; completedSetupKey?: string;
}) {
  const actions = useContext(CoachingActions);
  const rounds = Array.isArray(history) ? history.filter(round => round?.review && typeof round.review === 'object') : [];
  // Auto-advance resets the live coach before the next measured fight starts.
  const lastMeasured = rounds.find(round => hasActivity(round.review))?.review;
  const r = hasActivity(review) ? review : hasActivity(completedReview) ? completedReview
    : lastMeasured ?? completedReview ?? rounds[0]?.review ?? review;
  const profileKey = r === review ? setupKey : r === completedReview ? completedSetupKey : rounds.find(row => row.review === r)?.setupKey;
  const aim = useMemo(() => readAimMetrics(r?.aim), [r?.aim]);
  const previousAim = useMemo(() => !profileKey ? [] : history.filter(row => row.setupKey === profileKey && row.review?.aim !== r?.aim)
    .slice(0, 29).flatMap(row => {const value = readAimMetrics(row.review.aim); return value ? [value] : [];}), [history, profileKey, r?.aim]);
  const exportHistory = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'spraylab-duels.json'; link.click(); URL.revokeObjectURL(url);
  };
  if (!r) return <p className="duel-analysis-empty">Complete a duel to measure shot timing, aim, exposure and damage.</p>;
  const coaching = r.coaching, metrics = skillMetrics(coaching?.metrics);
  const summary = readCoachingSummary(coaching), plan = summary && practicePlan(summary);
  const completedSummary = readCoachingSummary(completedReview?.coaching);
  const canPractice = !!summary && !!completedSummary && sameCoachingMetrics(summary.metrics, completedSummary.metrics);
  const verdict = text(coaching?.focus) ?? text(r.message) ?? (hasActivity(r) ? 'Review this round' : 'Not enough shot data');
  const action = text(coaching?.action) ?? text(r.tip) ?? 'Take one aimed opening against a visible target to collect feedback.';
  const evidence = text(coaching?.evidence), confidence = text(coaching?.confidence);
  const debrief = readDuelDebrief(r.debrief);
  const goal = text(coaching?.goal), strength = text(coaching?.strength);
  const gunshots = number(r.shots) && r.shots > 0, hits = number(r.hits) && r.hits > 0;
  const totals: Stat[] = [
    ['Hits / shots', `${count(r.hits)} / ${count(r.shots)}`, 'One hit per gunshot. Knife swings are excluded.'],
    ['All-shot hit rate', gunshots ? measured(r.accuracy, 0, '%', 100) : '--', 'Includes blind fire and wallbangs. This is not the visible-target scoring denominator.'],
    ['Damage dealt / taken', `${measured(r.damage)} / ${measured(r.taken)}`, 'Health damage in this round, including melee.'],
    ...(!aim ? [['Time to first damage', measured(r.timeToDamage, 0, ' ms'), 'Visible contact to first hit. Includes aiming, firing and deliberate waiting; not reaction time alone.'] as Stat] : []),
  ];
  const advanced: Stat[] = [
    ['Kills', count(r.kills), 'All eliminations in this round, including melee.'],
    ['Head hits', `${count(r.heads)}${hits && number(r.headRate, 100) ? ` (${measured(r.headRate, 0, '%', 100)})` : ''}`, 'Head hits as a share of landed gunshots, not kills. Body hits can be valid.'],
    ['Settled gunshots', gunshots ? measured(r.settled, 0, '%', 100) : '--', 'Grounded with no added movement inaccuracy in the actual firing mode. Does not prove a counterstrafe or guarantee a hit.'],
    ['Moving shots', count(r.movingShots), 'Shots above the movement accuracy threshold.'],
    ['Airborne shots', count(r.airShots), 'Shots without ground contact.'],
    ['Speed at shot', gunshots ? measured(r.meanSpeed, 0, ' u/s') : '--', 'Average measured movement speed when firing, not weapon fire rate.'],
    ['Aim gap on reveal', measured(r.placement, 1, ' deg'), 'Angular gap to a visible aim point at first contact. Descriptive, not a fixed-degree score penalty.'],
    ['Multiple enemies visible', measured(r.multipleAnglesSeconds, 1, ' s'), 'Time with more than one enemy in your field of view and line of sight.'],
  ];
  return <section className="duel-analysis duel-scorecard" aria-label="Duel scorecard">
    <p className="duel-scorecard-round">{r === review ? 'Current round' : 'Last completed round'}</p>
    <header className="duel-scorecard-verdict"><h3>{verdict}</h3>
      <div title={coaching ? 'Local practice score from measured visible-target sequences, not a rank.' : 'Legacy local practice score, not a rank.'}>
        <span>Technique score</span><strong>{scoreLabel(scoreFor(r))}</strong>
      </div>
    </header>
    {debrief && <p className="duel-scorecard-confidence">{debrief.openings} measured opening{debrief.openings === 1 ? '' : 's'}
      {debrief.openings < 3 ? ' · Provisional: collect three or more before judging consistency.' : ' · Local technique score, not a skill rank.'}</p>}
    {evidence && <p className="duel-scorecard-evidence" aria-label="Measured round evidence">{evidence}</p>}
    <p className="duel-scorecard-action"><b>Next rep</b>{action}</p>
    {debrief && debrief.openings > 0 && <Stats rows={[
      ['Opening shots hit', `${debrief.openingHits} / ${debrief.openings}`, 'First gunshot in each observed engagement, not every burst.'],
      ['Contact to first shot', measured(debrief.firstShotMs, 0, ' ms'), 'Median visible contact to first shot. Deliberate holds count; this is not a reflex score.'],
    ]}/>}
    <Stats rows={totals}/>
    {aim && <DuelAimProfile current={aim} previous={previousAim}/>}
    {debrief && <>
      {debrief.findings.length > 1 && <div className="duel-scorecard-findings" aria-label="Other fight findings">
        {debrief.findings.slice(1).map(finding => <section key={finding.key}><h4>{finding.title}</h4>
          <p>{finding.evidence}</p><p className="duel-finding-action">{finding.action}</p></section>)}
      </div>}
      {Object.values(debrief.misses).some(value => value > 0) && <Stats rows={[
        ['Misses: aim / recoil line', count(debrief.misses.aim), 'Pre-spread ray missed the actual model. Includes aim, recoil and damage punch, not just mouse aim.'],
        ['Misses: random dispersion', count(debrief.misses.spread), 'Pre-spread ray hit the shape; the fired ray missed it. Not evidence of a bad flick.'],
        ['Misses: blocked / unknown', `${debrief.misses.cover} / ${debrief.misses.unclassified}`, 'Cover stopped an intersecting ray / insufficient evidence to assign a cause.'],
      ]}/>}
      {debrief.fights.length > 0 && <details className="duel-scorecard-details"><summary>Fight by fight</summary>
        <ol className="duel-scorecard-fights">{debrief.fights.map((fight, i) => <li key={i}>
          <strong>Bot {fight.enemy} · {Math.round(fight.range)} m · {fight.killed ? 'Killed' : `${Math.round(fight.damage)} damage`}</strong>
          <span>{fight.hits}/{fight.shots} hits · {fight.heads} head hits · opening {fight.openingHit ? 'hit' : 'miss'}</span>
          <span>Opening at {Math.round(fight.speed)} u/s · {fight.entered ? fight.oppositeInput ? 'opposite movement input recorded' : 'moving into the fight' : 'holding angle'}</span>
          <span>First shot {Math.round(Math.max(0, fight.firstShot - fight.started) * 1000)} ms after contact
            {fight.firstDamage !== undefined ? ` · first damage ${Math.round(Math.max(0, fight.firstDamage - fight.started) * 1000)} ms` : ' · no damage'}</span>
          {fight.killedAt !== undefined && <span>Time to kill {Math.round(Math.max(0, fight.killedAt - fight.started) * 1000)} ms</span>}
        </li>)}</ol>
      </details>}
    </>}
    {(metrics.length > 0 || evidence || confidence || goal || strength) && <details className="duel-scorecard-details">
      <summary>Skill breakdown</summary>
      {confidence && <p className="duel-scorecard-confidence">{confidence}</p>}
      <dl className="duel-scorecard-skills">{metrics.map((metric, i) => <div key={`${metric.label}-${i}`}>
        <dt>{skillName(metric.label)}</dt><dd><span>{metric.value}</span>
          {metric.detail && <p>{metric.detail}</p>}
          {metric.score !== null && <meter min="0" max="100" value={metric.score} aria-label={`${skillName(metric.label)} practice score`}/>}
        </dd>
      </div>)}</dl>
      {goal && <p className="duel-scorecard-goal"><b>Goal:</b> {goal}</p>}
      {strength && <p className="duel-scorecard-strength"><b>Keep:</b> {strength}</p>}
      {summary && actions.trends && <SkillTrends rows={actions.trends(summary)}/>}
      {summary && plan && <div className="coaching-actions">
        {actions.practice && canPractice && <button onClick={() => actions.practice?.(summary)}><Play size={15}/>Practice this</button>}
        {actions.lesson && <button onClick={() => actions.lesson?.(summary)}><GraduationCap size={15}/>Review lesson</button>}
      </div>}
    </details>}
    <details className="duel-scorecard-details"><summary>Combat totals and timing</summary><Stats rows={advanced}/></details>
    {rounds.length > 0 && <details className="duel-scorecard-details"><summary>Recent rounds</summary>
      <div className="duel-scorecard-history-heading"><span>Last {Math.min(rounds.length, 10)} recorded</span>
        <button className="icon-button" title="Export duel history" aria-label="Export duel history" onClick={exportHistory}><Download size={16}/></button>
      </div>
      <ol>{rounds.slice(0, 10).map((round, i) => <li key={i}>
        <span>{round.outcome === 'won' ? 'Won' : round.outcome === 'lost' ? 'Lost' : round.outcome === 'draw' ? 'Draw' : 'Round recorded'}
          <small>{roundTime(round.date)}</small></span><b>{scoreLabel(scoreFor(round.review))}</b>
      </li>)}</ol>
    </details>}
    <details className="duel-scorecard-details"><summary>About this feedback</summary>
      <p>Local practice feedback, not a FACEIT rank or a Leetify rating. Missing measurements are shown as --, not zero.</p>
      <p>{coaching ? 'Scores use measured visible-target sequences. New rounds score the pre-spread aim line separately from random dispersion; the displayed hit rate remains actual hits. Blind shots, unseen hits and unknown pre-aim points are omitted. Available scoring weights are renormalized.' : 'This saved round uses a legacy practice score. A visible-target skill breakdown was not recorded.'}</p>
      <p>Body hits, holding angles and information peeks can be valid. Time to first damage is descriptive, not a reaction-time grade.</p>
    </details>
  </section>;
}
