import { AttemptResult, WeaponId } from '../types';
import { weapons } from '../data/weapons';
import { findWeakSegmentForWeapon } from './scoring';

export type RoutineStep = {
  title: string;
  detail: string;
  weaponId: WeaponId;
  minutes: number;
};

export function buildDailyRoutine(attempts: AttemptResult[]): RoutineStep[] {
  const byWeapon = weapons.map((weapon) => {
    const recent = attempts.filter((attempt) => attempt.weaponId === weapon.id).slice(0, 10);
    const averageScore = recent.length
      ? recent.reduce((sum, attempt) => sum + attempt.scores.overall, 0) / recent.length
      : 45;
    return { weapon, averageScore, attempts: recent };
  });

  const weakest = [...byWeapon].sort((a, b) => a.averageScore - b.averageScore)[0]?.weapon ?? weapons[0];
  const second = [...byWeapon].filter((item) => item.weapon.id !== weakest.id).sort((a, b) => a.averageScore - b.averageScore)[0]?.weapon ?? weapons[1];
  const segment = findWeakSegmentForWeapon(attempts, weakest.id) ?? { from: 8, to: 13, averageError: 0 };

  return [
    {
      title: `${weakest.name} first 10 bullets`,
      detail: 'Trace mode: slow, accurate reps before speed.',
      weaponId: weakest.id,
      minutes: 2
    },
    {
      title: `${weakest.name} bullets ${segment.from}-${segment.to}`,
      detail: 'Weak-section drill generated from recent errors.',
      weaponId: weakest.id,
      minutes: 2
    },
    {
      title: `${second.name} no-guide check`,
      detail: 'One-minute test to keep another rifle warm.',
      weaponId: second.id,
      minutes: 1
    }
  ];
}

export function calculateStreak(attempts: AttemptResult[]): number {
  const days = new Set(attempts.map((attempt) => attempt.createdAt.slice(0, 10)));
  let streak = 0;
  const date = new Date();
  for (;;) {
    const key = date.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak += 1;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}
