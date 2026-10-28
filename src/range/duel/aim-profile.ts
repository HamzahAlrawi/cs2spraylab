import {median} from './fight-feedback';
import type {AimMetrics} from './aim-metrics';

export type AimDimension = 'spotted' | 'head' | 'stop' | 'spray' | 'placement' | 'damage';
export type AimDimensionResult = {id: AimDimension; label: string; value: number | null; samples: number;
  target: number; unit: '%' | 'deg' | 'ms'; lower: boolean; required: number; applicable: boolean; score: number | null; action: string};
const ratio = (n: number, d: number) => d ? n / d * 100 : null;

// Authored training goals, NOT Leetify population means or FACEIT cutoffs.
// Equal weighting follows its public list of aim dimensions, not its rating.
export const practiceAimTargets = {spotted: 45, head: 35, stop: 95, spray: 40, placement: 5, damage: 500} as const;
export function aimDimensions(data: AimMetrics): AimDimensionResult[] {
  const c = data.counts, m = data.measurements;
  const ttd = m.damage.filter(value => value < 1000);
  const rows: Omit<AimDimensionResult, 'target' | 'score' | 'applicable'>[] = [
    {id: 'spotted', label: 'Spotted accuracy', value: ratio(c.hits, c.shots), samples: c.shots, unit: '%', lower: false, required: 10,
      action: 'Confirm the first bullet before committing. At range, compare shorter bursts rather than chasing a miss with a long spray.'},
    {id: 'head', label: 'Head accuracy', value: ratio(c.headHits, c.headEligibleHits), samples: c.headEligibleHits, unit: '%', lower: false, required: 5,
      action: 'Carry your crosshair at the exposed head height before contact. Correct for crouched enemies and elevation; later body hits can still be valid.'},
    {id: 'stop', label: 'Rifle stop accuracy', value: ratio(c.stoppedRifleShots, c.rifleShots), samples: c.rifleShots, unit: '%', lower: false, required: 10,
      action: 'Brake before the rifle shot. Do not restart your strafe during a committed burst; separate shooting and repositioning.'},
    {id: 'spray', label: 'Spray accuracy', value: ratio(c.sprayHits, c.sprayShots), samples: c.sprayShots, unit: '%', lower: false, required: 9,
      action: 'Keep compensating and tracking through the burst. If the aim line leaves the model at range, reset behind cover rather than extending the spray.'},
    {id: 'placement', label: 'Crosshair adjustment', value: median(m.correction), samples: m.correction.length, unit: 'deg', lower: true, required: 5,
      action: 'Pre-aim each likely position before exposing yourself. Use movement to help align, then make the final mouse correction for the off-angle.'},
    {id: 'damage', label: 'Time to damage (<1 s)', value: median(ttd), samples: ttd.length, unit: 'ms', lower: true, required: 5,
      action: median(m.reaction) !== null && median(m.reaction)! < 250
        ? 'Your response input starts quickly; work on connecting the opening shot and the small aim correction, not firing sooner.'
        : 'Prepare the next angle and make a deliberate correction before firing. Improve first-bullet connection rather than rushing unaligned shots.'},
  ];
  return rows.map(row => {
    const target = practiceAimTargets[row.id];
    // Preserve the public head-hit statistic, but do not coach head hunting
    // when the recorded window includes weapons normally aimed center mass.
    const applicable = row.id !== 'head' || !data.weapons.some(weapon =>
      ['g3sg1', 'scar20', 'nova', 'xm1014', 'mag7', 'sawedoff', 'zeus'].includes(weapon));
    const score = !applicable || row.value === null || row.samples < row.required ? null
      : Math.round(Math.min(100, row.lower ? row.value === 0 ? 100 : target / row.value * 100 : row.value / target * 100));
    return {...row, target, score, applicable};
  });
}

export function aimProfile(data: AimMetrics, baseline: readonly AimMetrics[] = []) {
  const dimensions = aimDimensions(data), scored = dimensions.filter(row => row.score !== null);
  const score = scored.length >= 3 && data.counts.encounters >= 5
    ? Math.round(scored.reduce((sum, row) => sum + row.score!, 0) / scored.length) : null;
  const weaknesses = scored.filter(row => row.score! < 85).sort((a, b) => a.score! - b.score!).slice(0, 3);
  const baselineDimensions = baseline.map(aimDimensions);
  const comparisons = dimensions.flatMap(row => {
    if (row.score === null || row.value === null) return [];
    const values = baselineDimensions.map(old => old.find(metric => metric.id === row.id)!)
      .flatMap(old => old.value === null || !old.samples ? [] : [old.value]);
    if (values.length < 5) return [];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    const resolution = row.unit === 'ms' ? 31.25 : row.unit === 'deg' ? .1 : 1;
    const sd = Math.max(resolution, Math.sqrt(variance));
    const z = (row.value - mean) / sd * (row.lower ? -1 : 1);
    return [{id: row.id, z, samples: values.length, mean}];
  });
  // A transparent bounded personal-form scale, not a population percentile or
  // Leetify's undisclosed final z-score mapping.
  const z = comparisons.length >= 3 ? comparisons.reduce((sum, row) => sum + row.z, 0) / comparisons.length : null;
  const form = z === null ? null : Math.round(50 + 50 * Math.tanh(z / 2));
  return {score, dimensions, weaknesses, form, comparisons, covered: scored.length};
}
