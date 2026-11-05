import {expect,it,vi} from 'vitest';
import {Group} from 'three';
import {buildAwarenessArena} from './awareness-map';
import {exportNativeNavigation} from './duel/native-navigation';
import type {PrefireMap} from './prefire/map';
import type {PrefireCatalog,HoldingDensity} from './prefire/schema';
it('uses full native bounds and all routes instead of a selected Duel chunk',async()=>{
  const bounds={minX:-100,maxX:100,minZ:-100,maxZ:100};
  const map={scene:new Group(),collision:{bounds,ray:()=>undefined,fits:()=>true,vertical:()=>({feet:0,grounded:true,ceiling:false}),
    sweep:(_a:unknown,b:unknown)=>({position:b,fraction:1,startSolid:false})},
    settle:vi.fn(),dispose:vi.fn()} as unknown as PrefireMap;
  const route=(id:string,x:number)=>({id,name:id,spawn:[x,0,0] as const,look:[x+100,0,64] as const,path:[[x+200,0,0] as const],angles:[]});
  const catalog:PrefireCatalog={id:'fixture',revision:'1',name:'Fixture',sources:[],routes:[route('west',-2000),route('east',2000)]};
  const {arena,sources}=await buildAwarenessArena(map,catalog,new AbortController().signal);
  expect(arena).toMatchObject(bounds);expect(arena.native).toBe(map.collision);
  expect(sources.some(p=>p.feet.x< -40)).toBe(true);expect(sources.some(p=>p.feet.x>40)).toBe(true);
  expect(exportNativeNavigation(arena).nodes.some(n=>n.links.length>0)).toBe(true);
});
it('gives stronger regional hold evidence more density without multiplying duplicated courses',async()=>{
  const map={scene:new Group(),collision:{bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},ray:()=>undefined,fits:()=>true,
    vertical:()=>({feet:0,grounded:true,ceiling:false}),sweep:(_a:unknown,b:unknown)=>({position:b,fraction:1,startSolid:false})}} as unknown as PrefireMap;
  const common={id:'common',name:'Common',position:[-500,0,0] as const},rare={id:'rare',name:'Rare',position:[500,0,0] as const};
  const route={id:'route',name:'Route',enemySide:'ct' as const,phase:'preplant' as const,spawn:[0,0,0] as const,
    look:[100,0,64] as const,path:[],angles:[common,rare]};
  const density:HoldingDensity={schemaVersion:1,mapId:'fixture',source:{url:'fixture',revision:'1',license:'fixture',author:'fixture'},
    sample:{matches:1,rounds:2,povs:2},layers:[{side:'ct',context:'preplant',roundKeys:['m/1','m/2'],rounds:2}],
    cells:[{position:common.position,side:'ct',context:'preplant',episodeAnchors:2,seconds:4,rounds:2,matches:1,roundKeys:['m/1','m/2']}]};
  const catalog:PrefireCatalog={id:'fixture',name:'Fixture',revision:'1',sources:[],routes:[route],density};
  const first=await buildAwarenessArena(map,catalog,new AbortController().signal);
  const repeated=await buildAwarenessArena(map,{...catalog,routes:[route,{...route,id:'copy'}]},new AbortController().signal);
  const holds=first.sources.filter(p=>p.kind==='hold');expect(holds).toHaveLength(2);
  expect(holds.find(p=>p.feet.x<0)!.weight!).toBeGreaterThan(holds.find(p=>p.feet.x>0)!.weight!);
  expect(repeated.sources.filter(p=>p.kind==='hold')).toEqual(holds);
});
