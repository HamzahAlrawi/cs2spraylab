import {useMemo} from 'react';
import {equipmentNames} from '../equipment';
import {mergeAimMetrics, timingValue, type AimMetrics} from './aim-metrics';
import {aimProfile} from './aim-profile';

const display = (value: number | null, unit: string) => value === null ? '--'
  : `${value.toFixed(unit === 'deg' ? 1 : 0)} ${unit}`;

export function DuelAimProfile({current, previous}: {current: AimMetrics; previous: readonly AimMetrics[]}) {
  const {data, profile, rounds} = useMemo(() => {
    const recent = [current, ...previous.slice(0, 9)];
    const data = mergeAimMetrics(recent);
    return {data, profile: aimProfile(data, previous.slice(9, 29)), rounds: recent.length};
  }, [current, previous]);
  const m = data.measurements, c = data.counts;
  const timings = [
    ['Reaction (input estimate)', timingValue(data, 'reaction'), m.reaction.length,
      'Visible contact to a new trigger press or mouse correction toward the target. Excludes continuous aim/prefire, unready weapons, responses under 80 ms and holds of 1 s or more. Sampled input proxy, not pure human reflex time.'],
    ['Contact to first shot', timingValue(data, 'firstShot'), m.firstShot.length,
      'Median contact-to-shot latency, including deliberate waits and weapon readiness. Not the same as reaction time.'],
    ['Time to damage', timingValue(data, 'damage'), m.damage.length,
      'Median visible contact to first gun damage, including long holds. Missed/no-damage encounters are not zero-time hits.'],
    ['Time to kill', timingValue(data, 'kill'), m.kill.length,
      'Median first visible contact to lethal gun damage in the same encounter. Kills only; weapon, health and armor affect this.'],
    ['First damage to kill', timingValue(data, 'damageToKill'), m.damageToKill.length,
      'Median first landed gunshot to lethal shot. A one-shot kill is 0 ms here, not 0 ms contact-to-kill.'],
  ] as const;
  return <section className="duel-aim-profile" aria-label="Aim skill profile">
    <header><h4>Aim skill <small>Practice targets</small></h4><strong>{profile.score === null ? '--' : `${profile.score}/100`}</strong></header>
    <p className="duel-scorecard-confidence">{rounds} {rounds === 1 ? 'round' : 'same-setup rounds'} · {c.encounters} contacts · {profile.covered}/6 scored components</p>
    <p className="duel-aim-scope">Local goals, not a Leetify rating or player percentile.</p>
    {profile.score === null && <p className="duel-scorecard-confidence">Provisional: need five contacts and three components with enough samples.</p>}
    <p className="duel-scorecard-confidence">{data.weapons.map(weapon => equipmentNames[weapon] ?? weapon).join(' · ') || 'No measured weapon'}</p>
    {profile.weaknesses.length > 0 && <div className="duel-aim-weaknesses" aria-label="Measured aim weaknesses"><h5>Work on next</h5>
      {profile.weaknesses.map(row => <section key={row.id}><b>{row.label}</b>
        <p>{display(row.value, row.unit)} · target {row.lower ? '≤' : '≥'} {row.target} {row.unit} · n={row.samples}</p>
        <p className="duel-finding-action">{row.action}</p></section>)}
    </div>}
    <details className="duel-scorecard-details" open><summary>Engagement timing</summary>
      <dl className="duel-scorecard-stats">{timings.map(([label, value, samples, detail]) => <div key={label}>
        <dt title={detail}>{label}</dt><dd>{display(value, 'ms')}<small>n={samples}</small></dd>
      </div>)}</dl>
      <p className="duel-scorecard-confidence">Damage: {c.damaged}/{c.encounters} contacts · kills: {c.killed}/{c.encounters}.
        {' '}{c.reactionExcluded} response samples excluded; {c.reactionUnmeasured} unmeasured.</p>
    </details>
    <details className="duel-scorecard-details"><summary>Six-part aim breakdown</summary>
      <dl className="duel-scorecard-skills">{profile.dimensions.map(row => <div key={row.id}>
        <dt>{row.label}</dt><dd><span>{display(row.value, row.unit)}</span>
          <p className="duel-aim-measurement">n={row.samples} · practice target {row.lower ? '≤' : '≥'} {row.target} {row.unit}
            {!row.applicable ? ' · not scored for body-focused weapons' : row.score === null ? ` · need ${row.required} samples` : ` · ${row.score}/100`}</p>
          {row.score !== null && <meter min="0" max="100" value={row.score} aria-label={`${row.label} target score`}/>}
        </dd></div>)}</dl>
      <p className="duel-scorecard-confidence">TTD comparison omits {m.damage.filter(ms => ms >= 1000).length} holds of 1 s or more; raw TTD above keeps them. Head accuracy excludes AWP; rifle stop accuracy excludes crouched shots.</p>
    </details>
    <details className="duel-scorecard-details"><summary>Personal form &amp; method</summary>
      <p><b>Personal form: {profile.form === null ? 'Collect more same-setup rounds' : `${profile.form}/100`}</b></p>
      <p>50 is your older same-setup average, not the average CS2 player. Last ten rounds are compared with up to twenty older rounds; at least five baseline rounds and three measured components are required.</p>
      <p>Aim skill equally averages available component scores against the displayed practice targets. Reaction and kill times are descriptive, not aim-rating penalties. The technique score separately diagnoses movement, aim lines and cover.</p>
      <p>Visibility is sampled at 32 Hz. These browser-practice measurements are not interchangeable with match-demo ratings.</p>
      <p><a href="https://leetify.com/blog/leetify-stats-glossary/" target="_blank" rel="noreferrer">Metric definitions</a>
        {' · '}<a href="https://leetify.com/blog/cs2-benchmarks/" target="_blank" rel="noreferrer">Leetify methodology</a></p>
    </details>
  </section>;
}
