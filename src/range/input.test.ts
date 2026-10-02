import {afterEach, describe, expect, it, vi} from 'vitest';
import {requestRawLock} from './input';

class LockDocument extends EventTarget {pointerLockElement: unknown = null;}
function fixture() {
  const document = new LockDocument(); vi.stubGlobal('document', document);
  const element = {requestPointerLock: vi.fn<(...args: unknown[]) => void | Promise<void>>()};
  const capture = () => {document.pointerLockElement = element; document.dispatchEvent(new Event('pointerlockchange'));};
  return {document, element, capture, request: () => requestRawLock(element as unknown as HTMLElement)};
}
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
describe('confirmed mouse capture', () => {
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
