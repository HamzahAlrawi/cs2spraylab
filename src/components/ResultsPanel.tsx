import { TooltipInfo } from './TooltipInfo';
import { AttemptResult } from '../types';

type Props = {
  attempt?: AttemptResult;
  onSelectWeakDrill: () => void;
};

const metricDescriptions: Record<string, string> = {
  Path: 'Overall average closeness of your timed crosshair positions to the ideal compensation path. Higher is better.',
  Vertical: 'How well your up/down pull matched the expected recoil compensation. Higher is better.',
  Timing: 'How well you matched the weapon cadence, reaching each bullet position at the correct time. Higher is better.',
  Horizontal: 'How accurately you switched left/right at the correct moments in the spray. Higher is better.',
  Smooth: 'How steady and controlled your movement was, with less jitter or wobble. Higher is better.',
  'First 5': 'Score for the first five bullets only, useful for opening burst control. Higher is better.',
  'First 10': 'Score for the first ten bullets only, useful for practical spray control. Higher is better.',
  Overpull: 'Penalty-based score for pulling too far past the correct compensation point. Higher is better, meaning less over-pull.',
  Underpull: 'Penalty-based score for not pulling far enough toward the correct compensation point. Higher is better, meaning less under-pull.',
  Error: 'Pixel distance between the expected point and your compensated point for that bullet. Lower is better.',
  Bullet: 'Bullet number within the current spray attempt.',
  Hit: 'Simplified target-zone estimate for where the shot would have landed on the silhouette.',
  Read: 'Plain-English diagnosis for that bullet, describing what likely went wrong or right.',
  Weakest: 'The bullet interval with the highest average error in this attempt. Lower average error is better.'
};


function ScorePill({ label, value }: { label: keyof typeof metricDescriptions; value: number }) {
  const description = metricDescriptions[label];
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3" title={description}>
      <p className="text-xs text-slate-400">
        {label}
        <TooltipInfo text={description} className="ml-1" />
      </p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function Th({ label }: { label: keyof typeof metricDescriptions }) {
  return (
    <th className="p-3" title={metricDescriptions[label]}>
      {label}
      <TooltipInfo text={metricDescriptions[label]} className="ml-1" />
    </th>
  );
}

export function ResultsPanel({ attempt, onSelectWeakDrill }: Props) {
  if (!attempt) {
    return (
      <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 text-slate-300">
        <p className="text-sm uppercase tracking-[0.28em] text-amber-300">Attempt results</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">No attempt yet</h2>
        <p className="mt-2 text-sm text-slate-400">Complete a spray to get bullet-by-bullet feedback and a replay.</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 shadow-2xl shadow-black/30">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.28em] text-amber-300">Attempt results</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">{attempt.scores.overall}/100</h2>
          <p className="mt-1 text-sm text-slate-400">
            {attempt.weaponName} · {attempt.mode} · bullets {attempt.idealPattern[0]?.bullet}-{attempt.idealPattern[attempt.idealPattern.length - 1]?.bullet}
          </p>
        </div>
        <button className="primary-button" onClick={onSelectWeakDrill} title="Start a focused drill around your weakest bullet segment.">
          Drill weak section
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <ScorePill label="Path" value={attempt.scores.pathAccuracy} />
        <ScorePill label="Vertical" value={attempt.scores.verticalControl} />
        <ScorePill label="Timing" value={attempt.scores.temporalAccuracy} />
        <ScorePill label="Horizontal" value={attempt.scores.horizontalTiming} />
        <ScorePill label="Smooth" value={attempt.scores.smoothness} />
        <ScorePill label="First 5" value={attempt.scores.first5} />
        <ScorePill label="First 10" value={attempt.scores.first10} />
        <ScorePill label="Overpull" value={attempt.scores.overcorrection} />
        <ScorePill label="Underpull" value={attempt.scores.undercorrection} />
      </div>

      <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/10 p-4" title={metricDescriptions.Weakest}>
        <p className="text-sm font-medium text-red-100">
          Weakest segment <TooltipInfo text={metricDescriptions.Weakest} className="ml-1" />: bullets {attempt.weakSegment.from}-{attempt.weakSegment.to}
        </p>
        <p className="mt-1 text-sm text-red-100/80">Average error: {attempt.weakSegment.averageError}px</p>
      </div>

      <div className="mt-5 space-y-2">
        {attempt.feedback.map((item) => (
          <p key={item} className="rounded-2xl border border-white/10 bg-slate-900/60 p-3 text-sm text-slate-200">
            {item}
          </p>
        ))}
      </div>

      <div className="mt-5 max-h-72 overflow-auto rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-950 text-slate-400">
            <tr>
              <Th label="Bullet" />
              <Th label="Error" />
              <th className="p-3" title="Vertical component of the bullet error. Positive/negative values show high/low miss direction.">Vertical <TooltipInfo text="Vertical component of the bullet error. Positive/negative values show high/low miss direction." className="ml-1" /></th>
              <th className="p-3" title="Horizontal component of the bullet error. Positive/negative values show left/right miss direction.">Horizontal <TooltipInfo text="Horizontal component of the bullet error. Positive/negative values show left/right miss direction." className="ml-1" /></th>
              <th className="p-3" title="Timing difference between your nearest aim sample and the expected shot time.">Timing <TooltipInfo text="Timing difference between your nearest aim sample and the expected shot time." className="ml-1" /></th>
              <Th label="Hit" />
              <Th label="Read" />
            </tr>
          </thead>
          <tbody>
            {attempt.bulletErrors.map((error) => (
              <tr key={error.bullet} className="border-t border-white/5 text-slate-300">
                <td className="p-3 text-white">{error.bullet}</td>
                <td className="p-3">{Math.round(error.distance)}px</td>
                <td className="p-3">{Math.round(error.dy)}px</td>
                <td className="p-3">{Math.round(error.dx)}px</td>
                <td className="p-3">{Math.round(error.timingMs)}ms</td>
                <td className="p-3 capitalize">{error.hitZone}</td>
                <td className="p-3">{error.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
