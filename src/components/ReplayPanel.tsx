import { useEffect, useRef, useState } from 'react';
import { AttemptResult } from '../types';

const width = 680;
const height = 420;
const origin = { x: 340, y: 80 };

type Props = { attempt?: AttemptResult };

export function ReplayPanel({ attempt }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [bullet, setBullet] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(148,163,184,0.10)';
    for (let x = 0; x <= width; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    if (!attempt) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Replay appears after your first attempt.', width / 2, height / 2);
      return;
    }

    const visibleErrors = attempt.bulletErrors.slice(0, bullet + 1);
    const ideal = visibleErrors.map((item) => item.ideal);
    const user = visibleErrors.map((item) => item.user);

    const drawLine = (points: Array<{ x: number; y: number }>, color: string, lineWidth: number) => {
      if (points.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = origin.x + point.x;
        const y = origin.y + point.y;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    drawLine(attempt.idealPattern, 'rgba(245,158,11,0.22)', 7);
    drawLine(ideal, '#f59e0b', 3);
    drawLine(user, '#38bdf8', 3);

    visibleErrors.forEach((error) => {
      const ix = origin.x + error.ideal.x;
      const iy = origin.y + error.ideal.y;
      const ux = origin.x + error.user.x;
      const uy = origin.y + error.user.y;
      ctx.strokeStyle = 'rgba(248,113,113,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ux, uy); ctx.stroke();
      ctx.fillStyle = error.hitZone === 'miss' ? '#ef4444' : '#22c55e';
      ctx.beginPath(); ctx.arc(ux, uy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText(String(error.bullet), ux + 7, uy - 7);
    });
  }, [attempt, bullet]);

  useEffect(() => {
    setBullet(0);
  }, [attempt?.id]);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 shadow-2xl shadow-black/30">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.28em] text-amber-300">Replay</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Bullet-by-bullet path</h2>
        </div>
        {attempt && <span className="text-sm text-slate-400">Bullet {attempt.bulletErrors[bullet]?.bullet}</span>}
      </div>
      <canvas ref={canvasRef} width={width} height={height} className="w-full rounded-2xl border border-white/10" />
      {attempt && (
        <input
          aria-label="Replay bullet timeline"
          className="mt-4 w-full accent-amber-400"
          type="range"
          min={0}
          max={Math.max(0, attempt.bulletErrors.length - 1)}
          value={bullet}
          onChange={(event) => setBullet(Number(event.target.value))}
        />
      )}
      <div className="mt-2 flex gap-4 text-xs text-slate-400">
        <span className="text-amber-300">Orange: ideal</span>
        <span className="text-sky-300">Blue: your path</span>
        <span className="text-red-300">Red line: per-bullet error</span>
      </div>
    </section>
  );
}
