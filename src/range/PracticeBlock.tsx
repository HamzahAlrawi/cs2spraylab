import {ArrowRight, BookmarkPlus, RotateCcw, X} from 'lucide-react';
import {practiceOutcome, type PracticeBlock as Block, type PracticePhase} from './adaptive-practice';
import type {skillTrends} from './skill-trends';
import './coaching.css';
import {skillName} from './coaching-language';

export function PracticeBlock({block, onEnd, onNext, onRetention, nextPhase}: {block: Block; onEnd: () => void;
  onNext?: (phase: PracticePhase) => void; onRetention?: () => void; nextPhase?: PracticePhase | null}) {
  const outcome = practiceOutcome(block);
  const next = nextPhase === undefined ? ({guided: 'unassisted', unassisted: 'varied', varied: 'pressure'} as Partial<Record<PracticePhase, PracticePhase>>)[block.phase] : nextPhase;
  return <section className="practice-block" aria-label="Practice block">
    <header><strong>{skillName(block.plan.skill)}</strong><button className="icon-button" aria-label="End practice block" title="End practice block" onClick={onEnd}><X size={16}/></button></header>
    <p>{block.phase} / {block.values.length} of {block.plan.reps} reps / Goal: {block.plan.target}/100 each rep</p>
    <progress max={block.plan.reps} value={block.values.length} aria-label="Practice reps completed"/>
    <p>Before {Math.round(block.plan.baseline)}/100 · After {outcome.average === null ? '--' : `${Math.round(outcome.average)}/100`} · {outcome.measured} measured · {outcome.passed} passed</p>
    {outcome.complete && <div className="coaching-actions">
      {onNext && <button onClick={() => onNext(outcome.passed === block.plan.reps && next ? next : block.phase)}>{outcome.passed === block.plan.reps && next ? <ArrowRight size={15}/> : <RotateCcw size={15}/ >}{outcome.passed === block.plan.reps && next ? `Try ${next}` : 'Repeat block'}</button>}
      {onRetention && <button onClick={onRetention}><BookmarkPlus size={15}/>Save retention check</button>}
    </div>}
  </section>;
}
export function SkillTrends({rows}: {rows: ReturnType<typeof skillTrends>}) {
  if (!rows.length) return null;
  return <details className="skill-trends"><summary>Same-setup skill trends</summary>{rows.map(row => <p key={row.label}>
    <b>{skillName(row.label)}</b> {row.recent === null ? '--' : Math.round(row.recent)} / 100 ({row.recentCount} reps)
    {row.previous !== null && ` vs ${Math.round(row.previous)} (${row.previousCount} earlier)`} · n={row.samples}
  </p>)}</details>;
}
