import {describe,expect,it,vi} from 'vitest';
import {buildSolidTree,buildSolidTreeAsync,querySolidTree} from './native-solids';

const fixture = (count: number) => Array.from({length:count},(_,id) => {
  // Deliberate centroid/extent ties exercise stable sorting at every depth.
  const x = (id * 71 % 97) % 9, y = id % 7, z = id % 5;
  return {id,min:{x,y,z},max:{x:x+1,y:y+1,z:z+1}};
});

describe('cooperative solid tree',()=>{
  it.each([0,1,8,9,17,257,4097])('matches the synchronous tree and input ordering exactly for %i solids',async count=>{
    const original=fixture(count),cooperative=original.slice(),synchronous=original.slice();
    const checkpoint=vi.fn(async()=>{});
    const actual=await buildSolidTreeAsync(cooperative,checkpoint),expected=buildSolidTree(synchronous);
    expect(actual).toEqual(expected);expect(cooperative).toEqual(synchronous);
    for(const direction of [{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1},{x:1,y:.5,z:.25}]) {
      expect(querySolidTree(actual,{x:-2,y:2,z:2},direction,20)).toEqual(querySolidTree(expected,{x:-2,y:2,z:2},direction,20));
    }
    if(count>=257)expect(checkpoint.mock.calls.length).toBeGreaterThan(2);
  });
  it('checkpoints inside the root sort, not just between completed nodes',async()=>{
    const items=fixture(4097),synchronous=items.slice();buildSolidTree(synchronous);
    let checkpoints=0;
    await expect(buildSolidTreeAsync(items,async()=>{
      if(++checkpoints===20)throw new Error('cancelled inside root sort');
    })).rejects.toThrow('cancelled inside root sort');
    // 16 checkpoints scan the root bounds; the next four are within sorting.
    expect(checkpoints).toBe(20);expect(items).not.toEqual(synchronous);
  });
});
