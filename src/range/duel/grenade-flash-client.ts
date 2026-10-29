/** Scalar compositor helper, offline-replayed from client.dll build 2000938.
 * RVA 0x8d0780..0x8d08e6; provenance and cases live in the test-only fixture.
 * This is not a port of Source 2's screenshot capture or postprocessing pass. */
export const NATIVE_FLASH_CLIENT = Object.freeze({build: 2000938,
  sha256: '08a741030c1e569d8b854c5886a87fcafc21d0d0e2f05dfd380e8a351171501d',
  helperRva: '0x8d0780', buildupSeconds: Math.fround(.094444444), screenshotTailSeconds: 3});
const f = Math.fround;
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

export function nativeFlashClient(startTime: number, time: number, duration: number, maxAlpha = 255, buildUp = false) {
  if (![startTime, time, duration, maxAlpha].every(Number.isFinite) || duration <= 0 || maxAlpha <= 0)
    return {overlayAlpha: 0, screenshotAlpha: 0};
  const start = f(startTime), now = f(time), length = f(duration), alpha = f(maxAlpha);
  const remaining = f(f(start + length) - now);
  if (remaining < 0) return {overlayAlpha: 0, screenshotAlpha: 0};
  if (buildUp) {
    const value = f(clamp(f(f(f(now - start) / NATIVE_FLASH_CLIENT.buildupSeconds) * alpha), alpha) / 255);
    return {overlayAlpha: value, screenshotAlpha: value};
  }
  const fraction = remaining > 3 ? 1 : f(remaining / 3);
  return {overlayAlpha: f(clamp(f(f(fraction * fraction) * alpha), alpha) / 255),
    screenshotAlpha: f(clamp(f(f(remaining * alpha) / length), alpha) / 255)};
}
