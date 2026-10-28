import {actionsForCode, controlWheelCode, isInputTarget, type ControlAction, type Controls, type WheelControlCode} from './controls';

export function listenForControlWheel(target: EventTarget, onCapture: (code: WheelControlCode) => void): () => void {
  const wheel = (event: Event) => {
    if (event.defaultPrevented) return;
    const code = controlWheelCode(event as WheelEvent);
    if (!code) return;
    event.preventDefault(); event.stopPropagation(); onCapture(code);
  };
  const options = {capture: true, passive: false};
  target.addEventListener('wheel', wheel, options);
  return () => target.removeEventListener('wheel', wheel, options);
}

export function bindGameplayWheel(canvas: HTMLElement, getControls: () => Controls, isActive: () => boolean,
  onPress: (actions: ControlAction[]) => void): () => void {
  const document = canvas.ownerDocument;
  const wheel = (event: Event) => {
    if (!isActive() || event.defaultPrevented) return;
    const path = event.composedPath();
    if (isInputTarget(event.target) || path.some(isInputTarget)) return;
    if (document.pointerLockElement ? document.pointerLockElement !== canvas : !path.includes(canvas)) return;
    const wheelEvent = event as WheelEvent;
    // Crouch/walk modifiers must not disable wheel-jump during owned capture.
    // Outside capture, leave Ctrl+wheel browser zoom untouched.
    const code = controlWheelCode({deltaX: wheelEvent.deltaX, deltaY: wheelEvent.deltaY,
      altKey: wheelEvent.altKey, metaKey: wheelEvent.metaKey, shiftKey: false,
      ctrlKey: document.pointerLockElement === canvas ? false : wheelEvent.ctrlKey});
    if (!code) return;
    const actions = actionsForCode(getControls(), code);
    if (!actions.length) return;
    // Wheel input is a press edge, never a held key or a synthetic key event.
    event.preventDefault(); onPress(actions);
  };
  const options = {capture: false, passive: false};
  document.addEventListener('wheel', wheel, options);
  return () => document.removeEventListener('wheel', wheel, options);
}

export type MouseCaptureMode = 'idle' | 'raw' | 'standard' | 'drag';
let mouseCaptureMode: MouseCaptureMode = 'idle';
const subscribers = new Set<() => void>();
export const getMouseCaptureMode = () => mouseCaptureMode;
export const subscribeMouseCapture = (listener: () => void) => {subscribers.add(listener); return () => {subscribers.delete(listener);};};
function reportCapture(mode: Exclude<MouseCaptureMode, 'idle'>) {
  mouseCaptureMode = mode; subscribers.forEach(listener => listener()); return mode;
}
export function mouseCaptureFeedback(mode: MouseCaptureMode) {
  if (mode === 'raw') return {label: 'Raw mouse request accepted', warning: 'Unadjusted input requested successfully. Browser/OS count scaling is not measurable here; verify the physical cm/360 before assuming an exact match.'};
  if (mode === 'standard') return {label: 'Standard mouse / raw input unverified', warning: 'OS acceleration or browser/display scaling may change sensitivity. A fixed calibration cannot correct acceleration. C is the safer crouch key.'};
  if (mode === 'drag') return {label: 'Drag aim / no mouse capture', warning: 'Cursor-based movement is not raw input and cannot guarantee CS2 sensitivity matching.'};
  return {label: 'Mouse capture not tested', warning: 'Enter practice to test unadjusted pointer lock. DPI only calculates physical cm/360; it does not change mouse-count rotation.'};
}

function requestLock(element: HTMLElement, raw: boolean): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let promiseBased = false, finished = false, requesting = true;
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
    const changed = () => {if (!requesting && document.pointerLockElement === element) finish();};
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
      requesting = false;
      if (result && typeof result.then === 'function') result.then(changed, finish);
      changed();
    } catch (error) {finish(error);}
  });
}

export async function requestRawLock(element: HTMLElement): Promise<'raw' | 'standard' | 'drag'> {
  if (!element.requestPointerLock) return reportCapture('drag');
  try {return reportCapture(await requestLock(element, true) ? 'raw' : 'standard');}
  catch (error) {
    if ((error as DOMException).name === 'NotSupportedError') {
      try {await requestLock(element, false); return reportCapture('standard');} catch {return reportCapture('drag');}
    }
    return reportCapture('drag');
  }
}
