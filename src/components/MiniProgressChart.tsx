import { AttemptResult } from '../types';

type Props = { attempts: AttemptResult[] };

export function MiniProgressChart({ attempts }: Props) {
  const values = [...attempts].reverse().slice(-30).map((attempt) => attempt.scores.overall);
  const width = 920;
  const height = 180;
  const padding = 20;

  if (values.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/50 text-slate-400">
        No progress yet. Complete a spray to start your trend line.
      </div>
    );
  }

  const points = values.map((value, index) => {
    const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
    const y = height - padding - (value / 100) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full rounded-2xl border border-white/10 bg-slate-900/50">
      {[0, 25, 50, 75, 100].map((tick) => {
        const y = height - padding - (tick / 100) * (height - padding * 2);
        return (
          <g key={tick}>
            <line x1={padding} x2={width - padding} y1={y} y2={y} stroke="rgba(148,163,184,0.12)" />
            <text x={padding} y={y - 4} fill="rgba(226,232,240,0.55)" fontSize="11">{tick}</text>
          </g>
        );
      })}
      <polyline fill="none" stroke="rgba(245,158,11,0.95)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={points} />
      {values.map((value, index) => {
        const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
        const y = height - padding - (value / 100) * (height - padding * 2);
        return <circle key={`${value}-${index}`} cx={x} cy={y} r="4" fill="rgb(56,189,248)" />;
      })}
    </svg>
  );
}
