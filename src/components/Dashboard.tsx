import { AttemptResult, WeaponId } from '../types';
import { buildDailyRoutine, calculateStreak } from '../lib/recommendations';
import { weapons } from '../data/weapons';
import { MiniProgressChart } from './MiniProgressChart';

type Props = {
  attempts: AttemptResult[];
  onStartRoutine: (weaponId: WeaponId) => void;
  onSkillTest: () => void;
  onCalibrate: () => void;
};

export function Dashboard({ attempts, onStartRoutine, onSkillTest, onCalibrate }: Props) {
  const routine = buildDailyRoutine(attempts);
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
    <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-950 to-amber-950/30 p-6 shadow-glow">
        <p className="text-sm uppercase tracking-[0.35em] text-amber-300">SprayLab CS2</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Learn → trace → spray → analyze → improve.
        </h1>
        <p className="mt-4 max-w-2xl text-slate-300">
          A frontend-only recoil trainer that diagnoses where your spray compensation breaks down and turns it into focused drills. AK/M4-family guns now use imported FBX/PBR weapon assets and the first map uses imported concrete textures.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button className="primary-button" onClick={() => onStartRoutine(routine[0].weaponId)}>Start 5-minute training</button>
          <button className="secondary-button" onClick={onSkillTest}>Take recoil skill test</button>
          <button className="secondary-button" onClick={onCalibrate}>Calibrate sensitivity</button>
          <a className="secondary-button" href="https://steamcommunity.com/tradeoffer/new/?partner=135963670&token=IS6KDROD" target="_blank" rel="noreferrer">Enjoying it? Donate a CS2 skin</a>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="stat-card"><span>Attempts</span><strong>{attempts.length}</strong></div>
          <div className="stat-card"><span>Best</span><strong>{best}</strong></div>
          <div className="stat-card"><span>Streak</span><strong>{streak}d</strong></div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-amber-300">Today</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">5-minute routine</h2>
          </div>
          <span className="rounded-full bg-amber-400/10 px-3 py-1 text-sm text-amber-200">Avg {average}</span>
        </div>
        <div className="mt-4 space-y-3">
          {routine.map((step, index) => (
            <button
              key={`${step.title}-${index}`}
              className="w-full rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-left transition hover:border-amber-400/50 hover:bg-slate-900"
              onClick={() => onStartRoutine(step.weaponId)}
            >
              <div className="flex justify-between gap-3">
                <p className="font-medium text-white">{index + 1}. {step.title}</p>
                <p className="text-amber-300">{step.minutes}m</p>
              </div>
              <p className="mt-1 text-sm text-slate-400">{step.detail}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 lg:col-span-2">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-amber-300">Progress</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">Recent scores</h2>
          </div>
          <p className="text-sm text-slate-400">Saved locally in your browser</p>
        </div>
        <MiniProgressChart attempts={attempts} />
        <div className="mt-5 grid gap-3 md:grid-cols-3 lg:grid-cols-7">
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
