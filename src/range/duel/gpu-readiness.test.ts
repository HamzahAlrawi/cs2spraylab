import {afterEach,describe,expect,it,vi} from 'vitest';
import type {WebGLRenderer} from 'three';
import {waitForGpu,textureUploadBytes} from './gpu-readiness';

afterEach(()=>vi.unstubAllGlobals());
const fixture=()=>{
  const gl={SYNC_GPU_COMMANDS_COMPLETE:1,TIMEOUT_EXPIRED:2,ALREADY_SIGNALED:3,CONDITION_SATISFIED:4,WAIT_FAILED:5,
    isContextLost:vi.fn(()=>false),fenceSync:vi.fn(()=>({})),flush:vi.fn(),deleteSync:vi.fn(),clientWaitSync:vi.fn(()=>4)};
  vi.stubGlobal('requestAnimationFrame',(run:FrameRequestCallback)=>{queueMicrotask(()=>run(0));return 1;});
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  const renderer={getContext:()=>gl} as unknown as WebGLRenderer;
  return {gl,renderer};
};
describe('completed GPU readiness, not just submitted work',()=>{
  it('polls without a blocking wait and deletes its fence',async()=>{
    const {gl,renderer}=fixture();gl.clientWaitSync.mockReturnValueOnce(2).mockReturnValueOnce(2);
    await waitForGpu(renderer,new AbortController().signal);
    expect(gl.clientWaitSync).toHaveBeenCalledTimes(3);
    for(const call of gl.clientWaitSync.mock.calls)expect(call.slice(1)).toEqual([0,0]);
    expect(gl.flush).toHaveBeenCalledOnce();expect(gl.deleteSync).toHaveBeenCalledOnce();
  });
  it('releases a pending fence on cancellation',async()=>{
    const {gl,renderer}=fixture(),abort=new AbortController();
    gl.clientWaitSync.mockImplementation(()=>{abort.abort();return 2;});
    await expect(waitForGpu(renderer,abort.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(gl.deleteSync).toHaveBeenCalledOnce();
  });
  it('does not mark a failed/lost context as ready',async()=>{
    const {gl,renderer}=fixture();gl.clientWaitSync.mockReturnValue(5);
    await expect(waitForGpu(renderer,new AbortController().signal)).rejects.toThrow('did not complete');
    expect(gl.deleteSync).toHaveBeenCalledOnce();gl.isContextLost.mockReturnValue(true);
    await expect(waitForGpu(renderer,new AbortController().signal)).rejects.toThrow('context lost');
  });
  it('accounts for decoded RGBA and mipmaps rather than compressed WebP bytes',()=>{
    expect(textureUploadBytes({image:{width:1024,height:1024}})).toBeCloseTo(4*1024*1024*4/3);
    expect(textureUploadBytes({})).toBeGreaterThan(0);
  });
});
