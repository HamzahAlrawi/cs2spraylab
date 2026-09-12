import { DigitizedAnchor } from './digitizedSprays';

function scalePoints(points: ReadonlyArray<[number, number]>, scale: number): DigitizedAnchor[] {
  return points.map(([x, y], index) => ({
    bullet: index + 1,
    x: Math.round(x * scale * 10) / 10,
    y: Math.round(y * scale * 10) / 10
  }));
}

// These three sprays are sampled from the user-supplied recoil-control Lua script.
// The original script expresses compensation as many timed micro-movements. We
// sample the cumulative path at each weapon fire time, then scale it into the
// trainer's wall-space coordinate range so the trainer keeps the same visual size
// while inheriting the better per-bullet spacing/timing from the script.
export const luaDerivedSprays = {
  ak47: scalePoints([
    [0, 0], [0, 31.2], [0, 96.3], [-3.2, 172.5], [0.5, 255], [23.7, 325], [54.8, 387.4], [49.9, 433.3],
    [-29, 427], [-100.2, 434.2], [-93.3, 458], [-102.7, 471.7], [-165.3, 452.3], [-184, 444], [-109.3, 472.4],
    [-55.7, 478], [-19.1, 487.2], [50.5, 488], [132.3, 468.5], [74.5, 468], [93.5, 468], [80.4, 471.6],
    [51.3, 507], [102.1, 499.4], [112.4, 502], [49, 502], [-57.5, 486], [-146, 449], [-168, 462], [-168, 462]
  ], 0.48),
  m4a4: scalePoints([
    [0, 0], [0, 21.3], [0, 74.5], [0, 127.6], [-2.9, 174.4], [-21.9, 207.2], [-17.8, 267.1], [23.5, 292.2],
    [60.3, 314.4], [87.1, 336.5], [62, 352], [-0.8, 352], [-70.7, 352], [-124, 346.7], [-144, 342], [-133.7, 358.6],
    [-148.1, 362], [-182, 358.8], [-186, 358], [-95.7, 358.3], [-70.6, 378], [4, 378], [10.8, 380.7], [38.5, 388],
    [20.4, 394.4], [34, 408], [39.1, 408], [50.9, 408], [58, 408], [58, 408]
  ], 0.48),
  m4a1s: scalePoints([
    [0, 0], [0, 21], [0, 42.8], [0, 67.1], [-2, 110], [-12.5, 157], [-10.7, 199.3], [14.8, 230.3], [51, 248],
    [60.6, 248], [36.1, 258.6], [-18.6, 262], [-70.6, 262], [-106, 262], [-110, 271.6], [-90.3, 276], [-111.3, 275.3],
    [-130, 268.5], [-130, 276], [-130, 276]
  ], 0.52)
} as const;
