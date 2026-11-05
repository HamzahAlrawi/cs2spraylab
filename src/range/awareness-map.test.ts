import {expect,it,vi} from 'vitest';
import {Group} from 'three';
import {buildAwarenessArena} from './awareness-map';
import {exportNativeNavigation} from './duel/native-navigation';
import type {PrefireMap} from './prefire/map';
import type {PrefireCatalog} from './prefire/schema';
it('uses full native bounds and all routes instead of a selected Duel chunk',async()=>{
  const bounds={minX:-100,maxX:100,minZ:-100,maxZ:100};
  const map={scene:new Group(),collision:{bounds,ray:()=>undefined,fits:()=>true,vertical:()=>({feet:0,grounded:true,ceiling:false})},
    settle:vi.fn(),dispose:vi.fn()} as unknown as PrefireMap;
  const route=(id:string,x:number)=>({id,name:id,spawn:[x,0,0] as const,look:[x+100,0,64] as const,path:[[x+200,0,0] as const],angles:[]});
  const catalog:PrefireCatalog={id:'fixture',revision:'1',name:'Fixture',sources:[],routes:[route('west',-2000),route('east',2000)]};
  const {arena,sources}=await buildAwarenessArena(map,catalog,new AbortController().signal);
  expect(arena).toMatchObject(bounds);expect(arena.native).toBe(map.collision);
  expect(sources.some(p=>p.feet.x< -40)).toBe(true);expect(sources.some(p=>p.feet.x>40)).toBe(true);
  expect(exportNativeNavigation(arena).nodes.some(n=>n.links.length>0)).toBe(true);
});
