import type {CoachingSummary} from './coaching-types';
import {createContext, useContext} from 'react';
import {GraduationCap, Play} from 'lucide-react';
import {practicePlan} from './adaptive-practice';
import {SkillTrends} from './PracticeBlock';
import type {skillTrends} from './skill-trends';
import {coachingTerms, skillName} from './coaching-language';
import './coaching.css';

export const CoachingActions = createContext<{practice?: (summary: CoachingSummary) => void; lesson?: (summary: CoachingSummary) => void;
  record?: (id: string, setupKey: string, summary: CoachingSummary) => void;
  trends?: (summary: CoachingSummary) => ReturnType<typeof skillTrends>}>({});
export function CoachingReview({summary, compact = false}: {summary: CoachingSummary; compact?: boolean}) {
  const actions = useContext(CoachingActions), plan = practicePlan(summary);
  const terms = coachingTerms(summary.metrics.map(metric => metric.label));
  return <section className={`coaching-review${compact ? ' compact' : ''}`} aria-label="Skill review">
    <header><h3>{summary.focus}</h3><span title="Local practice score, not a rank">{summary.score === null ? 'Unscored' : `${Math.round(summary.score)}/100`}</span></header>
    <p><b>Next rep</b> {summary.action}</p>
    <p className="coaching-evidence">{summary.evidence}</p>
    <p className="coaching-goal"><b>Goal</b> {summary.goal}</p>
    {summary.strength && <p className="coaching-strength"><b>Keep</b> {summary.strength}</p>}
    {!compact && <dl className="coaching-metrics">{summary.metrics.map(metric => <div key={metric.label}>
      <dt title={metric.detail}>{skillName(metric.label)}</dt><dd>{metric.value}</dd>
      <p>{metric.detail}</p>
      {metric.score !== null && <meter min="0" max="100" value={metric.score} aria-label={`${skillName(metric.label)} practice score`}/>}
    </div>)}</dl>}
    <small className="coaching-confidence">{summary.confidence}</small>
    {!compact && terms.length > 0 && <details className="coaching-terms"><summary>CS2 terms</summary><dl>{terms.map(term => <div key={term.name}>
      <dt>{term.name}</dt><dd>{term.meaning}</dd>
    </div>)}</dl></details>}
    {actions.trends && <SkillTrends rows={actions.trends(summary)}/>}
    {plan && (actions.practice || actions.lesson) && <div className="coaching-actions">
      {actions.practice && <button onClick={() => actions.practice?.(summary)}><Play size={15}/>Practice this · {plan.reps} reps</button>}
      {actions.lesson && <button onClick={() => actions.lesson?.(summary)}><GraduationCap size={15}/>Review lesson</button>}
    </div>}
  </section>;
}
