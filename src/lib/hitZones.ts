import { HitZone } from '../types';

// Simple training visualization, not a CS2 damage simulator.
export function classifyHit(dx: number, dy: number): HitZone {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX <= 6 && absY <= 8) return 'head';
  if (absX <= 16 && absY <= 24) return 'chest';
  if (absX <= 20 && absY <= 38) return 'stomach';
  if (absX <= 24 && absY <= 55) return 'legs';
  return 'miss';
}
