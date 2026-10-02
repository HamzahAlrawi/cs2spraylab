function requestLock(element: HTMLElement, raw: boolean): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let promiseBased = false, finished = false;
    let errorTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timeout); clearTimeout(errorTimer);
      document.removeEventListener('pointerlockchange', changed);
      document.removeEventListener('pointerlockerror', failed);
    };
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true; cleanup();
      if (error) reject(error); else resolve(promiseBased);
    };
    const changed = () => {if (document.pointerLockElement === element) finish();};
    // Promise rejection carries NotSupportedError; allow it to win over the
    // generic error event so browsers without raw mouse support can retry.
    const failed = () => {errorTimer = setTimeout(() => {
      // A raw-input failure can dispatch its event after the standard retry has
      // begun. Modern requests own their rejection; that stale event must not
      // cancel the new request. Legacy requests still need event-based failure.
      if (!promiseBased) finish(new DOMException('Mouse capture denied', 'NotAllowedError'));
    }, 0);};
    const timeout = setTimeout(() => finish(new DOMException('Mouse capture timed out', 'TimeoutError')), 2000);
    document.addEventListener('pointerlockchange', changed);
    document.addEventListener('pointerlockerror', failed);
    try {
      const result = raw ? (element.requestPointerLock as (o: {unadjustedMovement: boolean}) => Promise<void> | void).call(element, {unadjustedMovement: true})
        : element.requestPointerLock();
      promiseBased = !!result && typeof result.then === 'function';
      if (result && typeof result.then === 'function') result.then(changed, finish);
      changed();
    } catch (error) {finish(error);}
  });
}

export async function requestRawLock(element: HTMLElement): Promise<'raw' | 'standard' | 'drag'> {
  if (!element.requestPointerLock) return 'drag';
  try {return await requestLock(element, true) ? 'raw' : 'standard';}
  catch (error) {
    if ((error as DOMException).name === 'NotSupportedError') {
      try {await requestLock(element, false); return 'standard';} catch {return 'drag';}
    }
    return 'drag';
  }
}
