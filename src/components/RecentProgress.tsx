import { AttemptResult } from '../types';
import { weapons } from '../data/weapons';
import { MiniProgressChart } from './MiniProgressChart';
import { calculateStreak } from '../lib/recommendations';

type Props = {
  attempts: AttemptResult[];
  onSelectAttempt: (attempt: AttemptResult) => void;
};

export function RecentProgress({ attempts, onSelectAttempt }: Props) {
  const best = attempts.length ? Math.max(...attempts.map((attempt) => attempt.scores.overall)) : 0;
  const average = attempts.length
    ? Math.round(attempts.reduce((sum, attempt) => sum + attempt.scores.overall, 0) / attempts.length)
    : 0;
  const streak = calculateStreak(attempts);

  const weaponStats = weapons.map((weapon) => {
    const weaponAttempts = attempts.filter((attempt) => attempt.weaponId === weapon.id);
    const recent = weaponAttempts.slice(0, 10);
    const avg = recent.length ? Math.round(recent.reduce((sum, attempt) => sum + attempt.scores.overall, 0) / recent.length) : 0;
    const bestWeapon = weaponAttempts.length ? Math.max(...weaponAttempts.map((attempt) => attempt.scores.overall)) : 0;
    return { weapon, avg, bestWeapon, count: weaponAttempts.length };
  });

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 shadow-2xl shadow-black/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.28em] text-amber-300">Recent attempts</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Progress and history</h2>
          <p className="mt-1 text-sm text-slate-400">Saved locally in your browser. Click an attempt to replay its scoring panel.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3"><p className="text-xs text-slate-500">Avg</p><strong>{average || '—'}</strong></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3"><p className="text-xs text-slate-500">Best</p><strong>{best || '—'}</strong></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3"><p className="text-xs text-slate-500">Streak</p><strong>{streak}d</strong></div>
        </div>
      </div>

      <div className="mt-5">
        <MiniProgressChart attempts={attempts} />
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
          <p className="mb-3 text-sm font-semibold text-slate-200">Latest sprays</p>
          <div className="max-h-72 space-y-2 overflow-auto pr-1">
            {attempts.slice(0, 12).map((attempt) => (
              <button
                key={attempt.id}
                onClick={() => onSelectAttempt(attempt)}
                className="w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-left transition hover:border-amber-400/40 hover:bg-slate-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-white">{attempt.weaponName}</span>
                  <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-200">{attempt.scores.overall}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{attempt.mode} · weakest {attempt.weakSegment.from}-{attempt.weakSegment.to}</p>
              </button>
            ))}
            {!attempts.length && <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-400">No attempts yet. Start with the trainer above.</p>}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {weaponStats.map((item) => (
            <div key={item.weapon.id} className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
              <p className="font-medium text-white">{item.weapon.name}</p>
              <p className="mt-1 text-sm text-slate-400">Avg {item.avg || '—'} · Best {item.bestWeapon || '—'}</p>
              <p className="mt-1 text-xs text-slate-500">{item.count} attempts</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
