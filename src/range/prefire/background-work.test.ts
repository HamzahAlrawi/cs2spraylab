import {afterEach,expect,it,vi} from 'vitest';
import {backgroundBudget} from './background-work';
afterEach(()=>vi.unstubAllGlobals());
it('yields bounded cached-resource bursts even when individual items are quick',async()=>{
  const frame=vi.fn((run:FrameRequestCallback)=>{queueMicrotask(()=>run(0));return 1;});
  vi.stubGlobal('requestAnimationFrame',frame);
  const abort=new AbortController(),turn=backgroundBudget(abort.signal,10000,4);
  for(let i=0;i<12;i++)await turn();
  expect(frame).toHaveBeenCalledTimes(3);abort.abort();
  await expect(turn()).rejects.toMatchObject({name:'AbortError'});
});
