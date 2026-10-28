import {memo, useContext, useEffect, useId, useMemo, useRef, useState} from 'react';
import {ArrowRight, CheckCircle2, Circle, GraduationCap, Play, RotateCcw} from 'lucide-react';
import {prefirePreset, prefirePresets, type PrefireConfig} from './config';
import type {PrefireStats} from '../duel/scenario';
import './prefire.css';
import './prefire-setup.css';
import {dust2Catalog, prefireLineup} from './routes';
import type {PrefireCatalog, PrefireRoute} from './schema';
import {holdingEvidence, prefireCandidates, HOLD_RADIUS_UNITS, HOLD_HEIGHT_UNITS, PREFIRE_WEIGHT_POLICY} from './occupancy';
import {CoachingReview} from '../CoachingReview';
import {describeShotState, shotConeDegrees, type ShotState} from '../shot-state';
import {equipmentNames, type Equipment} from '../equipment';
import {TipsDisplay} from '../DrillPanel';
import {PrefireWorkflow} from './workflow-context';
import {PracticeBlock, SkillTrends} from '../PracticeBlock';
import {skillTrends} from '../skill-trends';
import {DuelAimProfile} from '../duel/DuelAimProfile';
import {readAimMetrics, type AimMetrics} from '../duel/aim-metrics';

const noPreviousAim: readonly AimMetrics[] = [];

export type PrefireSetupProps = {
  config: PrefireConfig;
  update: (patch: Partial<PrefireConfig>) => void;
  routes: readonly PrefireRoute[];
  catalog?: PrefireCatalog;
  routeId: string;
  stats?: PrefireStats;
  lastShot?: {weapon: Equipment; state: ShotState};
  showTips?: boolean;
  onNext: () => void;
  onRepeat: () => void;
};

export const PrefireSetup = memo(function PrefireSetup({config, update, routes, catalog = dust2Catalog, routeId, stats, lastShot, showTips = true, onNext, onRepeat}: PrefireSetupProps) {
  const populationId = useId();
  const workflow = useContext(PrefireWorkflow);
  const diagnoses = workflow.diagnoses.filter(row => row.routeId === routeId);
  const latest = diagnoses.filter((row, index, all) => all.findIndex(other => other.angleId === row.angleId) === index);
  const progressionId = useId();
  const route = routes.find(item => item.id === routeId);
  const density = catalog.density?.mapId === catalog.id && catalog.density.schemaVersion === 1 ? catalog.density : undefined;
  const candidates = useMemo(() => route ? config.population !== 'all' ? prefireCandidates(route) : prefireLineup(route, config.lineupId).angles : [], [route, config.population, config.lineupId]);
  const angleEvidence = useMemo(() => route ? candidates.map(angle => holdingEvidence(angle, route, density)) : [], [route, candidates, density]);
  const selectedRoute = route;
  const percent = (value: number | null | undefined) => value == null ? '--' : `${Math.round(value)}%`;
  const preset = prefirePreset(config);
  const shotDescription = lastShot && describeShotState(lastShot.state);
  const aim = useMemo(() => readAimMetrics(stats?.aim), [stats?.aim]);
  const regions = [...new Set(routes.map(route => route.region ?? 'Other'))];
  const populationLabel = config.population === 'all' ? 'Fixed lineup' : config.population === 'random' ? 'Weighted' : 'Setups';
  const completedResult = stats?.progress.last;
  const completedId = completedResult ? JSON.stringify([completedResult.key, completedResult.date]) : undefined;
  const seenCompletion = useRef(completedId);
  const [reviewOpen, setReviewOpen] = useState(!!completedId);
  useEffect(() => {
    if (completedId && completedId !== seenCompletion.current) {
      seenCompletion.current = completedId;
      setReviewOpen(true);
    }
  }, [completedId]);
  return <aside className="prefire-controls prefire-setup" aria-label={`${catalog.name} Prefire setup`}>
    <div className="prefire-controls-head">
      <div><small>DRILL SETUP</small><h2>{catalog.name} Prefire</h2></div>
      <div className="prefire-actions">
        <button type="button" className="icon-button" title="Repeat route" aria-label="Repeat route" disabled={!route} onClick={onRepeat}>
          <RotateCcw size={17} aria-hidden="true"/>
        </button>
        <button type="button" className="icon-button" title="Next route" aria-label="Next route" disabled={!route || routes.length < 2} onClick={onNext}>
          <ArrowRight size={17} aria-hidden="true"/>
        </button>
      </div>
    </div>
    <div className="prefire-controls-body">
      <section className="prefire-essentials" aria-label="Route and training essentials">
        <h3>Route &amp; course</h3>
        <p className="prefire-course-context">{catalog.name}{route?.region && <> / {route.region}</>}</p>
        <label className="prefire-field"><span>Prefire route</span>
          <select aria-label="Prefire route" value={selectedRoute?.id ?? ''} disabled={!routes.length} onChange={event => update({routeId: event.target.value, lineupId: undefined})}>
            {!selectedRoute && <option value="" disabled>{routes.length ? 'Select a route' : 'No routes available'}</option>}
            {regions.map(region => <optgroup key={region} label={region}>{routes.filter(route => (route.region ?? 'Other') === region)
              .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}
          </select>
        </label>
        {route?.startLabel && <p className="prefire-start-label">Start: {route.startLabel}</p>}
        <label className="prefire-check"><span>Floor route arrows</span><input type="checkbox" checked={config.routeGuide} onChange={event => update({routeGuide: event.target.checked})}/></label>
        <label className="prefire-field"><span>Training preset</span>
          <select aria-label="Training preset" value={preset} onChange={event => {
            const next = event.target.value as keyof typeof prefirePresets;
            if (next in prefirePresets) update(prefirePresets[next]);
          }}>
            <option value="custom" disabled>Custom practice</option>
            <option value="learn">1. Learn the angles</option>
            <option value="entry">2. Clean entries</option>
            <option value="pressure">3. Under pressure</option>
          </select>
        </label>
        <fieldset className="prefire-population prefire-lineup-mode">
          <legend>Enemy positions</legend>
          <div>
            {(['all', 'random', 'contextual'] as const).map(population => <label key={population}>
              <input type="radio" name={populationId} value={population} checked={config.population === population}
                onChange={() => update({population})}/>
              <span>{population === 'all' ? 'Fixed lineup' : population === 'random' ? 'Weighted' : 'Setups'}</span>
            </label>)}
          </div>
        </fieldset>
        {config.population === 'all' && route && (route.lineups?.length ?? 0) > 1 && <label className="prefire-field"><span>Practice lineup <small>Course</small></span>
          <select aria-label="Practice lineup" value={route.lineups?.some(lineup => lineup.id === config.lineupId) ? config.lineupId : route.id}
            onChange={event => update({routeId: route.id, lineupId: event.target.value === route.id ? undefined : event.target.value})}>
            <optgroup label={route.name}>
              {route.lineups!.map(lineup => <option key={lineup.id} value={lineup.id}>{lineup.name}</option>)}
            </optgroup>
          </select>
        </label>}
      </section>
      {workflow.block && workflow.end && <PracticeBlock block={workflow.block} onEnd={workflow.end} onNext={workflow.next} onRetention={workflow.saveRetention}/>}
      {!workflow.block && workflow.retention && <button className="secondary" onClick={workflow.retention.start}><RotateCcw size={15}/>Retention check · {new Date(workflow.retention.due).toLocaleDateString()}</button>}
      {workflow.message && <p role="status">{workflow.message}</p>}
      <details className="prefire-disclosure">
        <summary>Encounter options <span className="prefire-disclosure-state">{populationLabel}{config.population === 'random' && ` / ${config.botsPerRun} bots`}</span></summary>
        <div className="prefire-option-fields">
          {config.population === 'random' && <label className="prefire-field"><span>Bots per run <output>{config.botsPerRun}</output></span>
            <input type="range" aria-label="Prefire bots per run" min="1" max="5" step="1" value={config.botsPerRun}
              onChange={event => update({botsPerRun: +event.target.value})}/>
          </label>}
          <label className="prefire-field"><span>Bot behavior</span>
            <select aria-label="Bot behavior" value={config.botBehavior} onChange={event => update({
              botBehavior: event.target.value === 'static' ? 'static' : 'angle-specific', movingBots: event.target.value !== 'static',
            })}>
              <option value="angle-specific">Angle-specific</option>
              <option value="static">Static targets</option>
            </select>
          </label>
          {config.population === 'contextual' && <div className="prefire-encounter-evidence" aria-label="Encounter evidence">
            <strong>{stats?.encounter?.mode === 'contextual-evidence' ? 'Observed defender setups' : 'Authored defender setups'}</strong>
            <p>{stats?.encounter?.mode === 'contextual-evidence' ? `${stats.encounter.evidence.trainMatches} training matches / ${stats.encounter.evidence.heldoutMatches} validation matches`
              : 'Complete angle lineups vary together. Verified match-level setup data is not available for this route yet.'}</p>
            {!!stats?.encounter?.conditionedOn.length && <p>Matched: {stats.encounter.conditionedOn.map(field => `${field}: ${stats.encounter!.context[field]}`).join(', ')}</p>}
            {stats?.encounter?.evidence.provenance.map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.id} / {source.revision}</a>)}
          </div>}
        </div>
      </details>
      <details className="prefire-disclosure">
        <summary>Combat <span className="prefire-disclosure-state">{config.returnFire ? `Return fire / ${config.reactionMs} ms` : 'Return fire off'}</span></summary>
        <section className="prefire-toggles prefire-option-fields" aria-label="Bot combat">
          <label className="prefire-check"><span>Return fire (bots fight back)</span>
            <input type="checkbox" aria-label="Return fire" checked={config.returnFire} onChange={event => update({returnFire: event.target.checked})}/>
          </label>
          <label className="prefire-check" title={!config.returnFire ? 'Requires return fire' : undefined}>
            <span>{config.returnFire ? 'Bots trade teammates' : 'Bots trade teammates (requires return fire)'}</span>
            <input type="checkbox" aria-label="Bot trading" checked={config.tradeEnabled} disabled={!config.returnFire}
              onChange={event => update({tradeEnabled: event.target.checked})}/>
          </label>
          {config.returnFire && <label className="prefire-field prefire-reaction"><span>Reaction time <output>{config.reactionMs} ms</output></span>
            <input type="range" aria-label="Bot reaction time" aria-valuetext={`${config.reactionMs} milliseconds`} min="300" max="2500" step="50" value={config.reactionMs}
              onChange={event => update({reactionMs: +event.target.value})}/>
          </label>}
        </section>
      </details>
      <details className="prefire-disclosure">
        <summary>Guidance &amp; run options <span className="prefire-disclosure-state">{config.autoAdvance ? 'Next route' : 'Repeat route'} / {config.reviewSeconds}s review</span></summary>
        <div className="prefire-option-fields">
          <div className="prefire-toggles">
            <label className="prefire-check"><span>Route directions</span><input type="checkbox" checked={config.navigationHints} onChange={event => update({navigationHints: event.target.checked})}/></label>
          </div>
          <fieldset className="prefire-population">
            <legend>After clearing a route</legend>
            <div>
              {[true, false].map(autoAdvance => <label key={String(autoAdvance)}>
                <input type="radio" name={progressionId} value={autoAdvance ? 'next' : 'repeat'} checked={config.autoAdvance === autoAdvance}
                  onChange={() => update({autoAdvance})}/>
                <span>{autoAdvance ? 'Next route' : 'Repeat route'}</span>
              </label>)}
            </div>
          </fieldset>
          <label className="prefire-field"><span>Review between runs <output>{config.reviewSeconds}s</output></span>
            <input type="range" aria-label="Prefire review time" min="2" max="10" step="1" value={config.reviewSeconds} onChange={event => update({reviewSeconds: +event.target.value})}/>
          </label>
        </div>
      </details>
      <details className="prefire-disclosure" open={reviewOpen} onToggle={event => setReviewOpen(event.currentTarget.open)}>
        <summary>Run review <span className="prefire-disclosure-state">{completedResult && stats ? `${stats.kills} / ${stats.total} cleared` : 'No engagements yet'}</span></summary>
        <div className="prefire-review-content">
          {showTips && <div className="prefire-goal"><strong>Clean route goal <span>{Math.min(2, stats?.progress.streak ?? 0)} / 2</span></strong>
            <p>90% stopped first bullets. 70% crosshair placement and clean entries. 80% angle isolation. At least 35% hits.</p>
            {(stats?.progress.streak ?? 0) >= 2 && <p className="prefire-goal-ready">Two clean runs. Try the next preset.</p>}
          </div>}
          <section className="prefire-performance" aria-label="Route performance">
            {lastShot && shotDescription && <div className="prefire-shot-state" aria-label="Last shot accuracy">
              <small>LAST SHOT / {equipmentNames[lastShot.weapon]}</small>
              <strong>{shotDescription.label}</strong>
              <dl><div><dt>Speed</dt><dd>{Math.round(lastShot.state.speedUnits)} u/s</dd></div>
                <div><dt>Recoil offset</dt><dd>{Math.hypot(lastShot.state.recoil.yaw, lastShot.state.recoil.pitch).toFixed(2)} deg</dd></div></dl>
              {showTips && <p>{shotDescription.tip}</p>}
              <details><summary>Accuracy details</summary>
                <p>Maximum random cone radius: {shotConeDegrees(lastShot.state).toFixed(2)} deg. At 20 m: {(20 * (lastShot.state.inaccuracy + lastShot.state.spread) * 100).toFixed(0)} cm. This is a maximum, not where every bullet lands.</p>
              </details>
            </div>}
            <div className="prefire-route-identity">
              <strong>{route?.name ?? 'Route unavailable'}</strong>
              <span>Cleared <b>{stats?.kills ?? 0} / {stats?.total ?? candidates.length}</b></span>
            </div>
            <dl className="prefire-stats">
              <div><dt>Quality score</dt><dd>{stats?.score == null ? '--' : Math.round(stats.score)}</dd></div>
              <div><dt>First-bullet timing</dt><dd>{percent(stats?.openingStopped)}</dd></div>
              <div><dt>Crosshair placement</dt><dd>{percent(stats?.readyAim)}</dd></div>
              <div><dt>Opening hits</dt><dd>{percent(stats?.openingHits)}</dd></div>
              <div><dt>Clean entries</dt><dd>{percent(stats?.cleanEntries)}</dd></div>
              <div><dt>Angle isolation</dt><dd>{percent(stats?.isolation)}</dd></div>
            </dl>
            {stats?.coaching ? <TipsDisplay showTips={showTips}><CoachingReview summary={stats.coaching} compact/></TipsDisplay> : showTips && stats && (stats.message || stats.tip) && <div className="prefire-feedback" role="status" aria-live="polite" aria-atomic="true">
              {stats.message && <p>{stats.message}</p>}
              {stats.tip && <p className="prefire-tip">{stats.tip}</p>}
            </div>}
            {!!stats?.progress.attempts && <div className="prefire-progress" aria-label="Same-setup progress"><span>Last run <b>{stats.progress.last?.score ?? '--'}</b></span><span>Best <b>{stats.progress.best ?? '--'}</b></span><span>{stats.progress.attempts} runs</span>{!showTips && <span>Clean streak <b>{stats.progress.streak}</b></span>}</div>}
          </section>
          {aim && <details className="prefire-angle-review"><summary>Aim &amp; engagement metrics</summary>
            <TipsDisplay showTips={showTips}><div className="duel-scorecard"><DuelAimProfile current={aim} previous={noPreviousAim}/></div></TipsDisplay>
          </details>}
          <details className="prefire-angle-review"><summary>Shot totals</summary><dl className="prefire-stats">
            <div><dt>Accuracy</dt><dd>{percent(stats?.accuracy)}</dd></div>
            <div><dt>Headshots</dt><dd>{percent(stats?.headshotPercent)}</dd></div>
            <div><dt>Shots</dt><dd>{stats?.shots ?? '--'}</dd></div>
            <div><dt>Time</dt><dd>{stats ? `${stats.seconds.toFixed(1)}s` : '--'}</dd></div>
            <div><dt>Contact to hit</dt><dd>{stats?.timeToDamage == null ? '--' : `${Math.round(stats.timeToDamage)}ms`}</dd></div>
            <div><dt>Settled shots</dt><dd>{percent(stats?.stoppedPercent)}</dd></div>
          </dl></details>
          <details className="prefire-angle-review"><summary>Angle review</summary>
            {stats?.angles.some(angle => angle.openingStopped !== null) ? <ol>{stats.angles.filter(angle => angle.openingStopped !== null).map(angle => <li key={angle.id}>
              <div>{angle.cleared ? <CheckCircle2 size={13}/> : <Circle size={13}/>}<strong>{angle.name}</strong></div>
              <span>{angle.openingStopped ? 'Stopped shot' : 'Moving / airborne'}{angle.readyAim === null ? '' : angle.readyAim ? ' · Pre-aimed' : ' · Aim adjustment'}{angle.openingHit ? ' · Opening hit' : ''}</span>
              {showTips && <><b>{angle.message}</b><p>{angle.tip}</p></>}
            </li>)}</ol> : <p>No engagements yet</p>}
          </details>
          <details className="prefire-angle-review"><summary>{showTips ? 'Training cues & scoring' : 'Scoring'}</summary>
            {stats?.coaching && <TipsDisplay showTips={showTips}><CoachingReview summary={stats.coaching}/></TipsDisplay>}
            {showTips && <p>With rifles, pre-aim at head level before peeking. Counter-strafe, then fire; correct off-angles with your mouse and adjust for elevation or crouched holds.</p>}
            <p>Settled openings measure movement inaccuracy and ground contact, not which keys you used. Prepared aim checks the first visible head position, or body position for weapons graded on body shots; hidden targets are not graded.</p>
            <p>Speed does not raise your score. Clean entries combine recent movement, stopped shooting, pre-aim where measurable and at most one visible enemy. Static shots are valid but are not entry reps; a wide swing into one enemy is not an overpeek.</p>
          </details>
          {!!latest.length && <details className="prefire-angle-review"><summary>Saved angle diagnoses ({latest.length})</summary><ol>{latest.map(row => <li key={row.angleId}>
            <strong>{row.summary.focus}</strong><span>{new Date(row.date).toLocaleDateString()} · {row.scope === 'angle' ? 'Isolated retry' : 'Route opening'}</span>
            <p>{row.summary.evidence}</p><div className="coaching-actions"><button onClick={() => workflow.retry(row)}><Play size={14}/>Practice this · 3 reps</button>
              {workflow.lesson && <button onClick={() => workflow.lesson?.(row.summary)}><GraduationCap size={14}/>Review lesson</button>}</div>
            <SkillTrends rows={skillTrends(diagnoses.filter(other => other.angleId === row.angleId).map(other => ({...other, metrics: other.summary.metrics})), row.key)}/>
          </li>)}</ol></details>}
        </div>
      </details>
      <details className="prefire-disclosure">
        <summary>{config.population === 'random' ? 'Possible holds' : 'Route angles'} <span className="prefire-disclosure-state">{candidates.length} holds / sources</span></summary>
        <section className="prefire-angles" aria-label="Route angles">
          {config.population === 'random' && <p className="prefire-evidence-key">Observed rounds / sampled rounds</p>}
          {candidates.length ? <ol>{candidates.map((angle, index) => {
            const evidence = angleEvidence[index];
            return <li key={`${index}-${angle.name}`} title={evidence.sampleRounds
              ? `Observed nearby in ${evidence.rounds} of ${evidence.sampleRounds} sampled ${route!.enemySide?.toUpperCase() ?? 'CT'} ${route!.phase ?? 'preplant'} rounds, across ${evidence.matches} supporting matches out of ${evidence.sampleMatches}. ${PREFIRE_WEIGHT_POLICY.label}.${angle.exclusionGroup ? ' Corner variants share their family weight; only one can appear.' : ''} Not probability of an enemy in this route.`
              : 'No eligible round-frequency sample; retained with uniform physical-family coverage.'}>{angle.name}
              {config.population === 'random' && <small>{evidence.sampleRounds ? `${evidence.rounds}/${evidence.sampleRounds}` : 'No sample'}</small>}
            </li>;
          })}</ol>
            : <p>No angles available</p>}
          {density && <details><summary>Position evidence</summary>
            <p>{density.sample.matches} matches / {density.sample.rounds} sampled rounds. Alive, low-speed, firearm-equipped pauses, separated by side and round phase.</p>
            <p>Counts show distinct sampled rounds with a hold within {HOLD_RADIUS_UNITS} units horizontally and {HOLD_HEIGHT_UNITS} units vertically. Repeated pauses count once. Side and pre/post-plant phase are matched.</p>
            <p>{PREFIRE_WEIGHT_POLICY.label}. Each sampled match contributes equally to regional support. These are relative training weights, not match spawn probabilities. Bots per run is a separate choice.</p>
            <p>Standing/crouched variants of the same pocket share a family weight and cannot appear together.</p>
            <p>This exploratory pro-match sample is not conditioned on your arrival time or the holder's view. Nearby bins can cross thin walls; sparse or absent support means unknown usage, not an unused angle.</p>
            <a href={density.source.url} target="_blank" rel="noreferrer">{density.source.author} / {density.source.license}</a>
          </details>}
          <details>
            <summary>Angle sources</summary>
            {catalog.sources.map(source => <div key={source.id}>
              <a href={`${source.repository}/tree/${source.commit}`} target="_blank" rel="noreferrer">{source.id} / {source.license}</a>
              <p>{source.context}</p>
              <pre>{source.notice}</pre>
            </div>)}
          </details>
        </section>
      </details>
    </div>
  </aside>;
});
