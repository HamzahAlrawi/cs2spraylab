export function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function finitePoint<T extends { x: number; y: number }>(point: T | undefined | null, fallback: { x: number; y: number } = { x: 0, y: 0 }): T | ({ x: number; y: number }) {
  if (!point) return fallback;
  return {
    ...point,
    x: finiteNumber(point.x, fallback.x),
    y: finiteNumber(point.y, fallback.y)
  };
}

export function isFinitePoint(point: { x: number; y: number } | undefined | null): point is { x: number; y: number } {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

export function clampFinite(value: unknown, min: number, max: number, fallback = min): number {
  const numeric = finiteNumber(value, fallback);
  return Math.max(min, Math.min(max, numeric));
}
