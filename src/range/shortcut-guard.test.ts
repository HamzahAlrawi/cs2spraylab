import {afterEach,expect,it,vi} from 'vitest';
import {ShortcutGuard} from './shortcut-guard';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const document = {fullscreenElement:null as unknown,exitFullscreen:vi.fn(async () => {document.fullscreenElement=null;})};
  const stage = {requestFullscreen:vi.fn(async () => {document.fullscreenElement=stage;})};
  const keyboard = {lock:vi.fn(async (_keys:string[]) => {}),unlock:vi.fn()};
  vi.stubGlobal('document',document);vi.stubGlobal('navigator',{keyboard});
  return {document,stage,keyboard,guard:new ShortcutGuard(stage as unknown as HTMLElement)};
}
it('reserves only W in fullscreen and releases its own fullscreen on pause',async()=>{
  const {guard,keyboard,stage,document}=fixture();
  await guard.enter(true);
  expect(stage.requestFullscreen).toHaveBeenCalledOnce();expect(keyboard.lock).toHaveBeenCalledWith(['KeyW']);
  expect(guard.protected).toBe(true);guard.release();
  expect(keyboard.unlock).toHaveBeenCalledOnce();expect(document.exitFullscreen).toHaveBeenCalledOnce();expect(guard.protected).toBe(false);
});
it('does not commandeer fullscreen on unsupported or disabled browsers',async()=>{
  const {guard,stage}=fixture();await guard.enter(false);
  vi.stubGlobal('navigator',{});await guard.enter(true);
  expect(stage.requestFullscreen).not.toHaveBeenCalled();expect(guard.protected).toBe(false);
});
it('does not exit fullscreen that the user opened independently',async()=>{
  const {guard,document,stage}=fixture();document.fullscreenElement=stage;
  await guard.enter(true);guard.release();expect(document.exitFullscreen).not.toHaveBeenCalled();
});
it('does not claim protection when permission is denied',async()=>{
  const {guard,keyboard}=fixture();keyboard.lock.mockRejectedValueOnce(new Error('Denied'));
  await guard.enter(true);expect(guard.protected).toBe(false);guard.release();
});
it('cleans up a fullscreen request that finishes after pause',async()=>{
  const {guard,stage,document,keyboard}=fixture();
  let resolve!:()=>void;
  stage.requestFullscreen.mockImplementationOnce(()=>new Promise<void>(done=>{resolve=()=>{document.fullscreenElement=stage;done();};}));
  const pending=guard.enter(true);guard.release();resolve();await pending;
  expect(keyboard.lock).not.toHaveBeenCalled();expect(document.exitFullscreen).toHaveBeenCalledOnce();expect(guard.protected).toBe(false);
});
it('releases a keyboard request that finishes after pause',async()=>{
  const {guard,keyboard}=fixture();let resolve!:()=>void;
  keyboard.lock.mockImplementationOnce(()=>new Promise<void>(done=>{resolve=done;}));
  const pending=guard.enter(true);await Promise.resolve();guard.release();resolve();await pending;
  expect(keyboard.unlock).toHaveBeenCalledOnce();expect(guard.protected).toBe(false);
});
