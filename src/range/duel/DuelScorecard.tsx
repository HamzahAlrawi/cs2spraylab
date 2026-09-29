import {Download, Target} from 'lucide-react';
import type {DuelHistory, DuelReview} from './coaching';

export function DuelScorecard({review, history}: {review?: DuelReview; history: DuelHistory[]}) {
  const r = review?.shots ? review : history[0]?.review;
  const exportHistory = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'spraylab-duels.json'; link.click(); URL.revokeObjectURL(url);
  };
  if (!r) return <p className="duel-analysis-empty">Complete a duel to measure shot timing, aim, exposure and damage.</p>;
  const values = [
    ['Training score', r.score === null ? '--' : `${r.score}/100`, 'Training score, not a FACEIT rating. Shot discipline 40%, hit rate 35%, pre-aim 15%, exposure 10%.'],
    ['Hits / shots', `${r.hits} / ${r.shots}`, 'Gun hits divided by gunshots. Knife swings are excluded.'],
    ['Hit rate', `${r.accuracy.toFixed(0)}%`, 'Any hit, including body hits.'],
    ['Head hits', `${r.heads} (${r.headRate.toFixed(0)}%)`, 'Head hits as a share of landed gunshots, not kills.'],
    ['Shots after stopping', `${r.settled.toFixed(0)}%`, 'Grounded and at or below 34% of weapon running speed. Not a guarantee of a hit.'],
    ['Moving shots', String(r.movingShots), 'Shots above the movement accuracy threshold.'],
    ['Airborne shots', String(r.airShots), 'Shots without ground contact.'],
    ['Average firing speed', `${r.meanSpeed.toFixed(0)} u/s`, 'Measured movement speed when firing.'],
    ['Aim gap on reveal', r.placement === null ? '--' : `${r.placement.toFixed(1)} deg`, 'Angular gap from crosshair to visible enemy when first spotted. Lower is better.'],
    ['Time to first damage', r.timeToDamage === null ? '--' : `${r.timeToDamage.toFixed(0)} ms`, 'Visible contact to first hit. Includes aiming and firing; not reaction time alone.'],
    ['Damage dealt / taken', `${r.damage.toFixed(0)} / ${r.taken.toFixed(0)}`, 'Health damage in this round.'],
    ['Multiple enemies visible', `${r.multipleAnglesSeconds.toFixed(1)} s`, 'Time with more than one enemy in your field of view and line of sight.'],
  ];
  return <section className="duel-analysis" aria-label="Duel scorecard">
    <div className="duel-coach"><Target size={18}/><strong>{r.message}</strong><p>{r.tip}</p></div>
    <dl>{values.map(([label, value, help]) => <div key={label}><dt title={help}>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="duel-history-title"><strong>Recent rounds</strong><button className="icon-button" title="Export duel history" aria-label="Export duel history" onClick={exportHistory}><Download size={16}/></button></div>
    <ol>{history.slice(0, 10).map((round, i) => <li key={`${round.date}-${i}`}><span>{round.outcome}<small>{new Date(round.date).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</small></span><b>{round.review.score ?? '--'}<small>/100</small></b></li>)}</ol>
    <details className="duel-sources"><summary>About this feedback</summary><p>This is a training score, not a FACEIT rank or a Leetify rating. The aim-gap and time-to-damage calculations here differ from match-demo statistics.</p><a href="https://dignitas.gg/articles/how-to-practice-recoil-control-with-dignitasvie-player-f0rest" target="_blank" rel="noreferrer">f0rest: recoil practice</a><a href="https://leetify.com/blog/leetify-stats-glossary/" target="_blank" rel="noreferrer">Leetify: metric definitions</a></details>
  </section>;
}
