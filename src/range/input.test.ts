import {afterEach, describe, expect, it, vi} from 'vitest';
import {STEP} from './actor-physics';
import {defaults} from './config';
import {defaultControls} from './controls';
import {DuelSimulation} from './duel/simulation';
import {bindGameplayWheel, getMouseCaptureMode, listenForControlWheel, mouseCaptureFeedback, requestRawLock, subscribeMouseCapture} from './input';
import {Simulation} from './simulation';

class LockDocument extends EventTarget {pointerLockElement: unknown = null;}
function fixture() {
  const document = new LockDocument(); vi.stubGlobal('document', document);
  const element = {requestPointerLock: vi.fn<(...args: unknown[]) => void | Promise<void>>()};
  const capture = () => {document.pointerLockElement = element; document.dispatchEvent(new Event('pointerlockchange'));};
  return {document, element, capture, request: () => requestRawLock(element as unknown as HTMLElement)};
}
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
describe('confirmed mouse capture', () => {
  it('does not mistake a synchronous lock event for unconfirmed raw support', async () => {
    const {element, capture, request} = fixture();
    element.requestPointerLock.mockImplementation(() => {capture(); return Promise.resolve();});
    expect(await request()).toBe('raw');
  });
  it('reports the confirmed capture mode and can unsubscribe status consumers', async () => {
    const {element, capture, request} = fixture(); const notify = vi.fn(); const unsubscribe = subscribeMouseCapture(notify);
    element.requestPointerLock.mockImplementation(async () => {capture();});
    await request(); expect(getMouseCaptureMode()).toBe('raw'); expect(notify).toHaveBeenCalledOnce();
    unsubscribe(); await request(); expect(notify).toHaveBeenCalledOnce();
    expect(mouseCaptureFeedback('raw').warning).toContain('verify');
    expect(mouseCaptureFeedback('standard').warning).toContain('acceleration');
    expect(mouseCaptureFeedback('drag').warning).toContain('cannot guarantee');
  });
  it('requests raw input immediately and confirms the owning element', async () => {
    const {element, capture, request} = fixture();
    element.requestPointerLock.mockImplementation(async () => {await Promise.resolve(); capture();});
    const pending = request();
    expect(element.requestPointerLock).toHaveBeenCalledWith({unadjustedMovement: true});
    expect(await pending).toBe('raw');
  });
  it('waits for legacy event-based implementations instead of claiming a nonexistent lock', async () => {
    const {capture, request} = fixture();
    let settled = false;
    const pending = request().then(mode => {settled = true; return mode;});
    await Promise.resolve(); expect(settled).toBe(false);
    capture(); expect(await pending).toBe('standard');
  });
  it('waits for capture even if a modern browser promise resolves before the event', async () => {
    const {element, capture, request} = fixture();
    element.requestPointerLock.mockResolvedValue(undefined);
    let settled = false; const pending = request().then(mode => {settled = true; return mode;});
    await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
    capture(); expect(await pending).toBe('raw');
  });
  it('retries standard input on unsupported raw input, including its generic error event', async () => {
    const {document, element, capture, request} = fixture();
    element.requestPointerLock.mockImplementationOnce(async () => {
      document.dispatchEvent(new Event('pointerlockerror')); throw new DOMException('Raw unsupported', 'NotSupportedError');
    }).mockImplementationOnce(async () => {await Promise.resolve(); capture();});
    expect(await request()).toBe('standard');
    expect(element.requestPointerLock).toHaveBeenNthCalledWith(2);
  });
  it('does not fall back silently for denied requests', async () => {
    const {element, request} = fixture();
    element.requestPointerLock.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    expect(await request()).toBe('drag'); expect(element.requestPointerLock).toHaveBeenCalledOnce();
  });
  it('ignores a late raw error event while the modern standard retry is pending', async () => {
    vi.useFakeTimers(); const {document, element, capture, request} = fixture();
    element.requestPointerLock.mockRejectedValueOnce(new DOMException('Raw unsupported', 'NotSupportedError'))
      .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => {capture(); resolve();}, 20)));
    const pending = request(); await Promise.resolve(); await Promise.resolve();
    document.dispatchEvent(new Event('pointerlockerror'));
    await vi.advanceTimersByTimeAsync(20); expect(await pending).toBe('standard');
  });
  it('bounds a legacy failure that never dispatches any event', async () => {
    vi.useFakeTimers(); const {document, request} = fixture();
    const remove = vi.spyOn(document, 'removeEventListener'), pending = request();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe('drag'); expect(remove).toHaveBeenCalledTimes(2);
  });
  it('ignores another canvas lock and removes listeners after completing', async () => {
    const {document, capture, request} = fixture(); const remove = vi.spyOn(document, 'removeEventListener');
    let settled = false; const pending = request().then(mode => {settled = true; return mode;});
    document.pointerLockElement = {}; document.dispatchEvent(new Event('pointerlockchange'));
    await Promise.resolve(); expect(settled).toBe(false);
    capture(); expect(await pending).toBe('standard'); expect(remove).toHaveBeenCalledTimes(2);
  });
  it('supports a browser with no pointer-lock API', async () => {expect(await requestRawLock({} as HTMLElement)).toBe('drag');});
});

function wheelEvent(patch: Partial<WheelEvent> = {}, path: EventTarget[] = []) {
  const event = new Event('wheel', {cancelable: true});
  Object.assign(event, {deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false}, patch);
  event.composedPath = () => path;
  return event;
}
function wheelFixture() {
  const document = new LockDocument();
  const canvas = {ownerDocument: document} as unknown as HTMLElement;
  const controls = {...defaultControls, jump: 'WheelUp'};
  let active = true;
  const press = vi.fn();
  const stop = bindGameplayWheel(canvas, () => controls, () => active, press);
  const dispatch = (patch: Partial<WheelEvent> = {}, path: EventTarget[] = [canvas]) => {
    const event = wheelEvent(patch, path); document.dispatchEvent(event); return event;
  };
  return {document, canvas, controls, press, stop, dispatch, pause: () => {active = false;}};
}

describe('native wheel binding capture', () => {
  it('consumes directions only while capture is installed, then restores scrolling', () => {
    const target = new EventTarget(), capture = vi.fn();
    const add = vi.spyOn(target, 'addEventListener'), remove = vi.spyOn(target, 'removeEventListener');
    const before = wheelEvent(); target.dispatchEvent(before); expect(before.defaultPrevented).toBe(false);
    const stop = listenForControlWheel(target, capture);
    expect(add).toHaveBeenCalledWith('wheel', expect.any(Function), {capture: true, passive: false});
    for (const deltaY of [-120, 120]) {
      const event = wheelEvent({deltaY}); const propagate = vi.spyOn(event, 'stopPropagation');
      target.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); expect(propagate).toHaveBeenCalledOnce();
    }
    expect(capture.mock.calls).toEqual([['WheelUp'], ['WheelDown']]);
    stop(); expect(remove).toHaveBeenCalledWith('wheel', expect.any(Function), {capture: true, passive: false});
    const after = wheelEvent(); target.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false); expect(capture).toHaveBeenCalledTimes(2);
  });
  it('leaves browser zoom, horizontal/zero deltas and already consumed events alone', () => {
    const target = new EventTarget(), capture = vi.fn(), stop = listenForControlWheel(target, capture);
    for (const patch of [{ctrlKey: true}, {metaKey: true}, {altKey: true}, {shiftKey: true}, {deltaY: 0}, {deltaX: 200}, {deltaY: NaN}]) {
      const event = wheelEvent(patch); target.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
    const consumed = wheelEvent(); consumed.preventDefault(); target.dispatchEvent(consumed);
    expect(capture).not.toHaveBeenCalled(); stop();
  });
});

describe('active gameplay wheel pulses', () => {
  it('resolves current bindings per event, dispatches once, and leaves unbound directions available', () => {
    const {controls, dispatch, press, stop} = wheelFixture();
    expect(dispatch().defaultPrevented).toBe(true);
    expect(press.mock.calls).toEqual([[['jump']]]);
    expect(dispatch({deltaY: 120}).defaultPrevented).toBe(false);
    controls.jump = 'WheelDown'; controls.reload = 'WheelUp';
    dispatch(); dispatch({deltaY: 120});
    expect(press.mock.calls).toEqual([[['jump']], [['reload']], [['jump']]]);
    controls.use = controls.pickup = 'WheelDown'; controls.jump = 'Space';
    dispatch({deltaY: 120}); expect(press).toHaveBeenLastCalledWith(['use', 'pickup']);
    stop();
  });
  it.each([0, 1, 2])('emits a single pulse for deltaMode %s regardless of delta magnitude', deltaMode => {
    const {dispatch, press, stop} = wheelFixture();
    for (const deltaY of [-.1, -3, -120, -5000]) dispatch({deltaMode, deltaY});
    expect(press).toHaveBeenCalledTimes(4); stop();
  });
  it('does not hijack page scroll when paused, outside the canvas, or locked to another canvas', () => {
    const {canvas, document, dispatch, press, pause, stop} = wheelFixture();
    expect(dispatch({}, []).defaultPrevented).toBe(false);
    document.pointerLockElement = {};
    expect(dispatch().defaultPrevented).toBe(false);
    document.pointerLockElement = canvas;
    expect(dispatch({}, []).defaultPrevented).toBe(true);
    pause(); expect(dispatch().defaultPrevented).toBe(false);
    expect(press).toHaveBeenCalledOnce(); stop();
  });
  it('preserves browser gestures and editable/dialog/HUD targets even with pointer lock', () => {
    const {canvas, document, dispatch, press, stop} = wheelFixture(); document.pointerLockElement = canvas;
    for (const patch of [{metaKey: true}, {altKey: true}, {deltaY: 0}, {deltaX: 200}])
      expect(dispatch(patch).defaultPrevented).toBe(false);
    for (const match of ['input', 'button', '[role="dialog"]', '[data-controls-capture]']) {
      const target = {closest: (selector: string) => selector.split(',').includes(match) ? {} : null} as unknown as EventTarget;
      expect(dispatch({}, [target, canvas]).defaultPrevented).toBe(false);
    }
    const consumed = wheelEvent({}, [canvas]); consumed.preventDefault(); document.dispatchEvent(consumed);
    expect(press).not.toHaveBeenCalled(); stop();
  });
  it('wheel-jumps with crouch/walk held only under owned capture, preserving browser zoom elsewhere', () => {
    const {canvas, document, dispatch, press, stop} = wheelFixture();
    expect(dispatch({ctrlKey:true}).defaultPrevented).toBe(false);
    document.pointerLockElement = canvas;
    for (const patch of [{ctrlKey:true}, {shiftKey:true}, {ctrlKey:true,shiftKey:true}]) {
      expect(dispatch(patch).defaultPrevented).toBe(true);
    }
    expect(press).toHaveBeenCalledTimes(3); stop();
  });
  it('removes the listener on disposal without changing wheel fallbacks', () => {
    const {document, dispatch, press, stop} = wheelFixture(); const remove = vi.spyOn(document, 'removeEventListener');
    stop(); expect(remove).toHaveBeenCalledWith('wheel', expect.any(Function), {capture: false, passive: false});
    expect(dispatch().defaultPrevented).toBe(false); expect(press).not.toHaveBeenCalled();
  });
});

describe('wheel jump simulation adapters', () => {
  it.each(['WheelUp', 'WheelDown'])('Range consumes %s once, never holds jump, and accepts a fresh pulse after landing', code => {
    const document = new LockDocument(), canvas = {ownerDocument: document} as unknown as HTMLElement;
    const sim = new Simulation({...defaults, controls: {...defaultControls, jump: code}}); sim.active = true;
    const stop = bindGameplayWheel(canvas, () => sim.settings.controls, () => sim.active, actions => {
      if (actions.includes('jump')) sim.input.jumpPressed = true;
    });
    const press = () => document.dispatchEvent(wheelEvent({deltaY: code === 'WheelUp' ? -120 : 120}, [canvas]));
    press(); expect(sim.input.jumpPressed).toBe(true); expect(sim.input.jump).toBe(false);
    sim.advance(STEP / 2); expect(sim.input.jumpPressed).toBe(true);
    sim.advance(STEP / 2); expect(sim.input.jumpPressed).toBe(false); expect(sim.verticalVelocity).toBeGreaterThan(0);
    for (let i = 0; i < 180; i++) sim.advance(STEP);
    expect(sim.feet).toBe(0); expect(sim.verticalVelocity).toBe(0); expect(sim.jumpHeld).toBe(false);
    press(); sim.advance(STEP); expect(sim.verticalVelocity).toBeGreaterThan(0);
    sim.cancel(); press(); expect(sim.input.jumpPressed).toBeFalsy(); stop();
  });
  it.each(['WheelUp', 'WheelDown'])('the shared Duel/Prefire command path consumes %s without latching jump', code => {
    const document = new LockDocument(), canvas = {ownerDocument: document} as unknown as HTMLElement;
    const controls = {...defaultControls, jump: code}, sim = new DuelSimulation(); sim.start(); sim.command(1, {});
    let active = true;
    const stop = bindGameplayWheel(canvas, () => controls, () => sim.phase === 'fighting' && active, actions => {
      if (actions.includes('jump')) sim.command(0, {jumpPressed: true});
    });
    const press = () => document.dispatchEvent(wheelEvent({deltaY: code === 'WheelUp' ? -120 : 120}, [canvas]));
    press(); expect(sim.actors[0].command.jumpPressed).toBe(true); expect(sim.actors[0].command.jump).toBe(false);
    sim.advance(STEP / 2); expect(sim.actors[0].command.jumpPressed).toBe(true);
    sim.advance(STEP / 2); expect(sim.actors[0].command.jumpPressed).toBe(false); expect(sim.actors[0].verticalVelocity).toBeGreaterThan(0);
    for (let i = 0; i < 180; i++) sim.advance(STEP);
    expect(sim.actors[0].feet).toBe(0); expect(sim.actors[0].verticalVelocity).toBe(0); expect(sim.actors[0].jumpHeld).toBe(false);
    press(); sim.advance(STEP); expect(sim.actors[0].verticalVelocity).toBeGreaterThan(0);
    sim.pause(); active = false; press(); expect(sim.actors[0].command.jumpPressed).toBeFalsy(); stop();
  });
});
