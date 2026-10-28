import {describe,it,expect} from 'vitest';
import {fitsHull,sweepHull,verticalContact} from '../actor-collision';
import type {TerrainSolid} from '../terrain';
import type {Arena} from './geometry';
import {clearSegment,routeTo} from './navigation';
import {prepareNativeNavigation,nativeNavigationSize,exportNativeNavigation,installNativeNavigation} from './native-navigation';

function arena(boxes:TerrainSolid[],floor:number|null=0):Arena {
  return {minX:-5,maxX:5,minZ:-5,maxZ:5,solids:[],native:{
    ray:()=>undefined,sweep:(from,to,height)=>sweepHull(from,to,height,boxes),
    fits:(p,feet,height)=>fitsHull(p,feet,height,boxes),
    vertical:(p,from,to,height)=>verticalContact(p,from,to,height,boxes,floor),
  }};
}
describe('native-map navigation',()=>{
  it('routes around native cover absent from the procedural solids array',()=>{
    const map=arena([{center:{x:0,y:2,z:0},size:{x:1,y:4,z:5}}]);
    const a={x:-3,y:1.6256,z:0},b={x:3,y:0,z:0};
    prepareNativeNavigation(map,[a,b]);
    expect(nativeNavigationSize(map)).toBeGreaterThan(20);
    expect(clearSegment(a,b,map)).toBe(false);
    const route=routeTo(a,b,map);expect(route.length).toBeGreaterThan(1);
    let from=a;for(const next of route){expect(clearSegment(from,next,map)).toBe(true);from=next;}
    const simulationCopy={...map};expect(nativeNavigationSize(simulationCopy)).toBe(nativeNavigationSize(map));
    const baked=exportNativeNavigation(map),copy=arena([{center:{x:0,y:2,z:0},size:{x:1,y:4,z:5}}]);
    installNativeNavigation(copy,JSON.parse(JSON.stringify(baked)));
    expect(routeTo(a,b,copy)).toEqual(route);
    expect(()=>installNativeNavigation(copy,{version:1,nodes:[{point:{x:0,y:NaN,z:0},links:[]}]})).toThrow('Invalid native navigation');
    expect(()=>installNativeNavigation(copy,{version:1,nodes:[{point:{x:0,y:0,z:0},links:[2]}]})).toThrow('Invalid native navigation');
  });
  it('does not invent floor links across unsupported gaps',()=>{
    const map=arena([{center:{x:-3,y:-.1,z:0},size:{x:3,y:.2,z:8}},
      {center:{x:3,y:-.1,z:0},size:{x:3,y:.2,z:8}}],null);
    const a={x:-3,y:0,z:0},b={x:3,y:0,z:0};prepareNativeNavigation(map,[a,b]);
    expect(clearSegment(a,b,map)).toBe(false);expect(routeTo(a,b,map)).toEqual([]);
  });
});
