// Valve Source input math; installed CS2 user convars independently confirm both factors.
export const CS2_YAW = .022;
export const CS2_PITCH = .022;
const DEG = Math.PI / 180;
export type MouseSettings = {sensitivity: number; dpi: number; invertY: boolean; zoomSensitivity: number; mouseCalibration: number};
export const cmPer360 = (sensitivity: number, dpi: number) => 360 * 2.54 / (CS2_YAW * sensitivity * dpi);
// DPI describes the physical mouse only. It must not multiply browser deltas again.
export function mouseCountScale(settings: Pick<MouseSettings, 'zoomSensitivity' | 'mouseCalibration'>, zoomed: boolean) {
  return settings.mouseCalibration * (zoomed ? settings.zoomSensitivity : 1);
}
export function mouseLookDelta(dx: number, dy: number, settings: MouseSettings, horizontalFov = 90) {
  const scale = settings.sensitivity * DEG * horizontalFov / 90 * mouseCountScale(settings, horizontalFov !== 90);
  return {yawDelta: -dx * CS2_YAW * scale, pitchDelta: -dy * CS2_PITCH * scale * (settings.invertY ? -1 : 1)};
}
export function calibratedCountScale(current: number, observedDegrees: number, expectedDegrees = 360): number | null {
  if (![current, observedDegrees, expectedDegrees].every(n => Number.isFinite(n) && n > 0)) return null;
  const next = current * expectedDegrees / observedDegrees;
  return next >= .1 && next <= 10 ? next : null;
}
