import {useContext} from 'react';
import {Download, GraduationCap, Play} from 'lucide-react';
import type {DuelHistory, DuelReview} from './coaching';
import {CoachingActions} from '../CoachingReview';
import {sameCoachingMetrics} from '../coaching-types';
import {skillName} from '../coaching-language';
import {SkillTrends} from '../PracticeBlock';
import {readAimMetrics} from './aim-metrics';
import {DuelAimProfile} from './DuelAimProfile';
import {count, duelScorecardModel, measured, safeText, scoreLabel, selectScorecardReview, validNumber,
  type ScorecardStat} from './duel-scorecard-model';
import './duel-scorecard.css';

function Stats({rows, headline = false}: {rows: ScorecardStat[]; headline?: boolean}) {
  return <dl className={`duel-scorecard-stats${headline ? ' duel-scorecard-headline' : ''}`} aria-label={headline ? 'Round headline stats' : undefined}>
    {rows.map(({label, value, help, sample}) => <div key={label}>
      <dt title={help}>{label}</dt><dd title={value.includes('--') ? 'Not measured' : help}>{value}
        {sample && <small>{sample}</small>}</dd>
    </div>)}
  </dl>;
}

function roundTime(value: unknown) {
  const date = typeof value === 'string' && value.trim() ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : 'Time unavailable';
}

export function DuelScorecard(props: {
  review?: DuelReview; completedReview?: DuelReview; history: DuelHistory[]; setupKey?: string; completedSetupKey?: string;
}) {
  const actions = useContext(CoachingActions);
  const {review: r, rounds, current, profileKey} = selectScorecardReview(props);
  if (!r) return <p className="duel-analysis-empty">Complete a duel to measure shot timing, aim, exposure and damage.</p>;
  const model = duelScorecardModel(r), {aim, debrief, metrics, summary} = model;
  const completedSummary = props.completedReview && duelScorecardModel(props.completedReview).summary;
  const canPractice = !!summary && !!completedSummary && sameCoachingMetrics(summary.metrics, completedSummary.metrics);
  const previousAim = !profileKey ? [] : rounds.filter(row => row.setupKey === profileKey && row.review.aim !== r.aim)
    .slice(0, 29).flatMap(row => {const value = readAimMetrics(row.review.aim); return value ? [value] : [];});
  const exportHistory = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(rounds, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'spraylab-duels.json'; link.click(); URL.revokeObjectURL(url);
  };
  const gunshots = validNumber(r.shots) && r.shots > 0;
  const advanced: ScorecardStat[] = [
    {label: 'Kills', value: count(r.kills), help: 'All eliminations in this round, including melee.'},
    {label: 'All-shot hit rate', value: gunshots ? measured(r.accuracy, 0, '%', 100) : '--', help: 'Includes blind fire and wallbangs.'},
    {label: 'Head hits', value: count(r.heads), help: 'Landed head gunshots, not headshot kills. Body hits can be valid.'},
    {label: 'Settled gunshots', value: gunshots ? measured(r.settled, 0, '%', 100) : '--', help: 'Grounded with no added movement inaccuracy. Does not prove a counterstrafe or guarantee a hit.'},
    {label: 'Moving shots', value: count(r.movingShots), help: 'Shots above the movement accuracy threshold.'},
    {label: 'Airborne shots', value: count(r.airShots), help: 'Shots without ground contact.'},
    {label: 'Speed at shot', value: gunshots ? measured(r.meanSpeed, 0, ' u/s') : '--', help: 'Average measured movement speed when firing.'},
    {label: 'Aim gap on reveal', value: measured(r.placement, 1, ' deg'), help: 'Angular gap to a visible aim point at first contact, not angular travel until damage.'},
    {label: 'Multiple enemies visible', value: measured(r.multipleAnglesSeconds, 1, ' s'), help: 'Time with more than one enemy in your field of view and line of sight.'},
    ...(debrief ? [{label: 'Contact to first shot', value: measured(debrief.firstShotMs, 0, ' ms'), help: 'Median visible contact to first shot, including deliberate waiting. Not reaction time.'}] : []),
  ];
  return <section className="duel-analysis duel-scorecard" aria-label="Duel scorecard">
    <header className="duel-scorecard-header">
      <div><p className="duel-scorecard-round">{current ? 'Current round' : 'Last completed round'}</p><h3>Duel overview</h3></div>
      <button className="icon-button" title="Export duel history" aria-label="Export duel history" onClick={exportHistory} disabled={!rounds.length}>
        <Download size={16} aria-hidden="true"/>
      </button>
    </header>
    <p className="duel-scorecard-confidence">{model.sample}{model.provisional ? ' · Provisional' : ''}</p>
    <dl className="duel-scorecard-summary" aria-label="Measured skills">
      {model.skills.map(skill => <div key={skill.label}><dt>{skill.label}</dt><dd>
        <strong>{skill.value}</strong><small>{skill.detail}</small>
      </dd></div>)}
    </dl>
    <section className="duel-scorecard-focus" aria-label="Next practice focus">
      <h4>{model.weaknesses.length ? 'Work on next' : 'Next rep'}</h4>
      {model.weaknesses.length ? model.weaknesses.map(weakness => <div className="duel-scorecard-weakness" key={weakness.key}>
        <h5>{weakness.title}</h5><p className="duel-scorecard-evidence">{weakness.evidence}</p>
        <p className="duel-scorecard-action"><b>Try:</b> {weakness.action}</p>
      </div>) : <>
        <p className="duel-scorecard-evidence">{model.provisional ? 'Not enough openings to judge consistency.' : 'No specific technique weakness established this round.'}</p>
        <p className="duel-scorecard-action">{model.nextRep}</p>
      </>}
    </section>
    {summary && (actions.practice && canPractice || actions.lesson) && <div className="coaching-actions duel-scorecard-actions">
      {actions.practice && canPractice && <button onClick={() => actions.practice?.(summary)}><Play size={15} aria-hidden="true"/>Practice this</button>}
      {actions.lesson && <button onClick={() => actions.lesson?.(summary)}><GraduationCap size={15} aria-hidden="true"/>Review lesson</button>}
    </div>}
    <Stats rows={model.headline} headline/>
    <p className="duel-scorecard-scope">Round measurements, not a rank. -- = not measured.</p>
    <details className="duel-scorecard-details"><summary>Advanced details</summary>
      <p><b>Local technique score: {scoreLabel(r)}</b>{model.provisional ? ' · Provisional' : ''}</p>
      {model.legacyFocus && <p>{model.legacyFocus}</p>}
      {safeText(r.coaching?.evidence) && <p>{safeText(r.coaching?.evidence)}</p>}
      {model.legacyAction && <p className="duel-finding-action">{model.legacyAction}</p>}
      {safeText(r.coaching?.confidence) && <p>{safeText(r.coaching?.confidence)}</p>}
      <dl className="duel-scorecard-skills">{metrics.map((metric, i) => <div key={`${metric.label}-${i}`}>
        <dt>{skillName(metric.label)}</dt><dd><span>{metric.value}</span>
          {metric.detail && <p>{metric.detail}</p>}
          {metric.score !== null && <meter min="0" max="100" value={metric.score} aria-label={`${skillName(metric.label)} practice score`}/>}
        </dd>
      </div>)}</dl>
      {safeText(r.coaching?.goal) && <p className="duel-finding-action"><b>Goal:</b> {safeText(r.coaching?.goal)}</p>}
      {safeText(r.coaching?.strength) && <p className="duel-finding-action"><b>Keep:</b> {safeText(r.coaching?.strength)}</p>}
      {summary && actions.trends && <SkillTrends rows={actions.trends(summary)}/>}
      {aim && <DuelAimProfile current={aim} previous={previousAim}/>}
      <h4>Combat totals and timing</h4><Stats rows={advanced}/>
      {debrief && <>
        <h4>Recorded findings</h4>
        {debrief.findings.map(finding => <div className="duel-scorecard-raw-finding" key={finding.key}>
          <b>{finding.title}</b><p>{finding.evidence}</p><p className="duel-finding-action">{finding.action}</p>
        </div>)}
        <Stats rows={[
          {label: 'Misses: aim / recoil line', value: count(debrief.misses.aim), help: 'Pre-spread ray missed the actual model. Includes aim, recoil and damage punch.'},
          {label: 'Misses: random dispersion', value: count(debrief.misses.spread), help: 'Pre-spread ray hit the shape; the fired ray missed it. Not proof of a bad flick.'},
          {label: 'Misses: blocked / unknown', value: `${count(debrief.misses.cover)} / ${count(debrief.misses.unclassified)}`, help: 'Cover blocked an intersecting ray / cause unavailable.'},
        ]}/>
        {debrief.fights.length > 0 && <><h4>Fight by fight</h4>
          <ol className="duel-scorecard-fights">{debrief.fights.map((fight, i) => <li key={i}>
            <strong>Bot {fight.enemy} · {Math.round(fight.range)} m · {fight.killed ? 'Killed' : `${Math.round(fight.damage)} damage`}</strong>
            <span>{fight.hits}/{fight.shots} hits · {fight.heads} head hits · opening {fight.openingHit ? 'hit' : 'miss'}</span>
            <span>Opening at {Math.round(fight.speed)} u/s · {fight.entered ? fight.oppositeInput ? 'opposite movement input recorded' : 'moving into the fight' : 'holding angle'}</span>
            <span>First shot {Math.round((fight.firstShot - fight.started) * 1000)} ms after contact
              {fight.firstDamage !== undefined ? ` · first damage ${Math.round((fight.firstDamage - fight.started) * 1000)} ms` : ' · no damage'}</span>
            {fight.killedAt !== undefined && <span>Time to kill {Math.round((fight.killedAt - fight.started) * 1000)} ms</span>}
          </li>)}</ol>
        </>}
      </>}
      <h4>About this feedback</h4>
      <p>Local practice feedback, not a FACEIT rank or a Leetify rating. Aim summarizes prepared openings when available; Movement shows contextual shot discipline; Positioning measures angle isolation only, not trading or team play.</p>
      <p>Fewer than three openings are provisional. Unknown preparation, blind shots and unseen hits are excluded from the relevant skill samples. A single observed error is not a consistency verdict.</p>
      <p>{r.coaching ? 'The technique score uses available visible-target metrics with renormalized weights; diagnosed aim lines are separate from random dispersion.' : 'This legacy round has no complete visible-target skill breakdown.'} Time to damage includes holds and is not reaction time. Body hits, holding angles and information peeks can be valid.</p>
    </details>
    <details className="duel-scorecard-details"><summary>Recent rounds ({rounds.length})</summary>
      {rounds.length ? <><p className="duel-scorecard-confidence">Last {Math.min(rounds.length, 10)} recorded · local technique scores</p>
        <ol>{rounds.slice(0, 10).map((round, i) => <li key={i}>
          <span>{round.outcome === 'won' ? 'Won' : round.outcome === 'lost' ? 'Lost' : round.outcome === 'draw' ? 'Draw' : 'Round recorded'}
            <small>{roundTime(round.date)}</small></span><b>{scoreLabel(round.review)}</b>
        </li>)}</ol></> : <p>No saved rounds yet.</p>}
    </details>
  </section>;
}
