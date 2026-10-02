import soundEvents from './sound-events-data.json';
import type {Equipment} from './equipment';

export function sampleIndex(count: number, previous: number | undefined, random: number) {
  if (count <= 1) return 0;
  const index = Math.min(count - 2, Math.floor(random * (count - 1)));
  return previous === undefined ? Math.min(count - 1, Math.floor(random * count)) : index >= previous ? index + 1 : index;
}

// Linear interpolation of extracted knots, not Source 2's full Hermite mixer.
export function curveGain(units: number, points: number[][]) {
  if (!points.length) return 1;
  if (units <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (units <= points[i][0]) {
    const [x, y] = points[i], [px, py] = points[i - 1];
    return py + (y - py) * (units - px) / (x - px);
  }
  return points[points.length - 1][1];
}
export const FOOTSTEP_RANGE = 1100 * .0254;
export const footstepGain = (meters: number) => curveGain(meters / .0254,
  [[49.591427, .45], [116.563492, 1], [402.285736, .488971], [1095, .03], [1100, 0]]);

export function gunshotRange(equipment: Equipment) {
  const points = soundEvents.weapons[equipment].distanceCurve;
  return points[points.length - 1][0] * .0254;
}
export function gunshotGain(equipment: Equipment, meters: number) {
  const event = soundEvents.weapons[equipment];
  return meters > gunshotRange(equipment) ? 0 : event.volume * curveGain(meters / .0254, event.distanceCurve);
}
