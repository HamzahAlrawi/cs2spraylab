/** Yield between preparation stages without starving a round on busy devices. */
export function backgroundTurn(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle: number | undefined;
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason); else resolve();
    };
    const abort = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (idle !== undefined) globalThis.cancelIdleCallback?.(idle);
      signal?.removeEventListener('abort', abort); reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, {once: true});
    if (typeof globalThis.requestIdleCallback === 'function') idle = requestIdleCallback(finish, {timeout: 250});
    else timer = setTimeout(finish, 16);
  });
}

/** GPU uploads need frame pacing: idle callbacks alone can sleep 50 ms per batch. */
export function backgroundFrame(signal:AbortSignal):Promise<void> {
  signal.throwIfAborted();
  if(typeof requestAnimationFrame!=='function')return backgroundTurn(signal);
  return new Promise((resolve,reject)=>{
    const frame=requestAnimationFrame(()=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(signal.reason);else resolve();});
    const abort=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',abort);reject(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
  });
}
