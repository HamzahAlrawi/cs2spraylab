export async function requestRawLock(element: HTMLElement): Promise<'raw' | 'standard' | 'drag'> {
  if (!element.requestPointerLock) return 'drag';
  try {
    await (element.requestPointerLock as (o?: { unadjustedMovement: boolean }) => Promise<void> | void).call(element, { unadjustedMovement: true });
    return 'raw';
  } catch (error) {
    if ((error as DOMException).name === 'NotSupportedError') {
      try { await element.requestPointerLock(); return 'standard'; } catch { return 'drag'; }
    }
    return 'drag';
  }
}
