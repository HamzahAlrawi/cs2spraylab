import {UNIT, type Vec} from '../actor-physics';
import {moveOnTerrain} from '../actor-collision';
import type {Arena} from './geometry';

const HEIGHT = 72 * UNIT, CELL = .8;
const distance = (a: Vec, b: Vec) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
type Node = {point: Vec; links: number[]};
type Graph = {nodes: Node[]; segments: Map<string, boolean>};
export type NativeNavigationData = {version:1; nodes:{point:Vec;links:number[]}[]};
const graphs = new WeakMap<object, Graph>();
const worldKey=(arena:Arena)=>arena.native ?? arena;
const inside = (p: Vec, a: Arena) => p.x >= a.minX + 16*UNIT && p.x <= a.maxX - 16*UNIT &&
  p.z >= a.minZ + 16*UNIT && p.z <= a.maxZ - 16*UNIT;

// Callers historically pass either eyes or feet. Resolve support first instead
// of flattening a native map onto the generated arena's y=0 plane.
function ground(point: Vec, arena: Arena): Vec | undefined {
  const hit = arena.native!.vertical(point, point.y + 3*UNIT, point.y - 74*UNIT, HEIGHT);
  const feet = {...point, y: hit.feet};
  return hit.grounded && inside(feet, arena) && arena.native!.fits(feet, feet.y, HEIGHT) ? feet : undefined;
}

function walk(from: Vec, target: Vec, arena: Arena): Vec | undefined {
  let p = from;
  const steps = Math.max(1, Math.ceil(Math.hypot(target.x-from.x, target.z-from.z)/(.2)));
  for (let n=1; n<=steps; n++) {
    const desired = {x: from.x+(target.x-from.x)*n/steps, y:p.y, z:from.z+(target.z-from.z)*n/steps};
    if (!inside(desired, arena)) return;
    const moved = moveOnTerrain(p, desired, HEIGHT, {solids:[], native:arena.native, floor:null}, true);
    if (!moved.grounded || Math.hypot(moved.position.x-desired.x,moved.position.z-desired.z) > .035 ||
      !arena.native!.fits(moved.position,moved.position.y,HEIGHT)) return;
    p = moved.position;
  }
  return p;
}

export function nativeClearSegment(a: Vec, b: Vec, arena: Arena): boolean {
  const graph = graphs.get(worldKey(arena));
  const key = [a.x,a.y,a.z,b.x,b.y,b.z].map(n=>Math.round(n*1000)).join(':');
  const cached = graph?.segments.get(key);
  if (cached !== undefined) return cached;
  const start=ground(a,arena), end=ground(b,arena);
  const landed=start && end ? walk(start,end,arena) : undefined;
  const clear=!!landed && !!end && distance(landed,end)<.08;
  if (graph) {
    if (graph.segments.size>=1024) graph.segments.delete(graph.segments.keys().next().value!);
    graph.segments.set(key,clear);
  }
  return clear;
}

// A bounded multilevel graph, built once per loaded chunk, never per frame.
// Links are walked with the same hull, step solver and native collision as the
// actors. No diagonal corner cutting, imaginary flat floors or cliff links.
export function prepareNativeNavigation(arena: Arena, seeds: readonly Vec[], paths:readonly (readonly Vec[])[]=[]): void {
  if (!arena.native || graphs.has(worldKey(arena))) return;
  const graph: Graph={nodes:[],segments:new Map()}; graphs.set(worldKey(arena),graph);
  const ids=new Map<string,number>();
  const key=(p:Vec)=>`${Math.round((p.x-arena.minX)/CELL)}:${Math.round((p.z-arena.minZ)/CELL)}:${Math.round(p.y/.12)}`;
  const add=(p:Vec)=>{
    const k=key(p), old=ids.get(k); if(old!==undefined)return old;
    if(graph.nodes.length>=6500)return -1;
    const id=graph.nodes.length;ids.set(k,id);graph.nodes.push({point:p,links:[]});return id;
  };
  for(const seed of seeds) {
    const feet=ground(seed,arena);if(!feet)continue;
    const p={x:arena.minX+Math.round((feet.x-arena.minX)/CELL)*CELL,y:feet.y,
      z:arena.minZ+Math.round((feet.z-arena.minZ)/CELL)*CELL};
    const landing=walk(feet,p,arena);if(landing)add(landing);
  }
  for(let at=0;at<graph.nodes.length;at++) {
    const node=graph.nodes[at];
    for(const [x,z] of [[CELL,0],[-CELL,0],[0,CELL],[0,-CELL]]) {
      const p=walk(node.point,{x:node.point.x+x,y:node.point.y,z:node.point.z+z},arena);
      if(!p || !walk(p,node.point,arena))continue;
      const next=add(p);if(next<0 || next===at)continue;
      if(!nativeClearSegment(node.point,graph.nodes[next].point,arena) ||
        !nativeClearSegment(graph.nodes[next].point,node.point,arena))continue;
      if(!node.links.includes(next))node.links.push(next);
      if(!graph.nodes[next].links.includes(at))graph.nodes[next].links.push(at);
    }
  }
  // Native doorways can be narrower than a coarse grid cell. Retain the
  // authored, physically walked clearing spine as exact off-grid links.
  for(const path of paths) {
    let previous=-1;
    for(const source of path) {
      const p=ground(source,arena);if(!p)continue;
      const id=graph.nodes.length;graph.nodes.push({point:p,links:[]});
      if(previous>=0 && nativeClearSegment(graph.nodes[previous].point,p,arena) && nativeClearSegment(p,graph.nodes[previous].point,arena)) {
        graph.nodes[id].links.push(previous);graph.nodes[previous].links.push(id);
      }
      const nearby=graph.nodes.slice(0,id).map((node,i)=>({id:i,d:distance(node.point,p)}))
        .filter(row=>row.d<1.5).sort((a,b)=>a.d-b.d).slice(0,5);
      for(const row of nearby)if(nativeClearSegment(p,graph.nodes[row.id].point,arena) && nativeClearSegment(graph.nodes[row.id].point,p,arena)) {
        graph.nodes[id].links.push(row.id);graph.nodes[row.id].links.push(id);
      }
      previous=id;
    }
  }
}

export function nativeRouteTo(start: Vec, goal: Vec, arena: Arena): Vec[] {
  if(nativeClearSegment(start,goal,arena))return [goal];
  const graph=graphs.get(worldKey(arena));if(!graph?.nodes.length)return [];
  const connections=(p:Vec)=>graph.nodes.map((node,id)=>({id,d:distance(node.point,p)}))
    .filter(row=>row.d<3).sort((a,b)=>a.d-b.d).slice(0,12)
    .filter(row=>nativeClearSegment(p,graph.nodes[row.id].point,arena) && nativeClearSegment(graph.nodes[row.id].point,p,arena)).slice(0,4).map(row=>row.id);
  const roots=connections(start), ends=new Set(connections(goal));if(!roots.length || !ends.size)return [];
  const queue=[...roots], parent=new Int32Array(graph.nodes.length).fill(-2);roots.forEach(id=>parent[id]=-1);
  let last=-1;
  for(let n=0;n<queue.length;n++) {
    const id=queue[n];if(ends.has(id)){last=id;break;}
    for(const next of graph.nodes[id].links)if(parent[next]===-2){parent[next]=id;queue.push(next);}
  }
  if(last<0)return [];
  const path:Vec[]=[];for(let id=last;id>=0;id=parent[id])path.push(graph.nodes[id].point);
  path.reverse();path.push(goal);
  const result:Vec[]=[];let from=start;
  for(let n=0;n<path.length;) {
    let next=Math.min(path.length-1,n+12);
    while(next>n && !nativeClearSegment(from,path[next],arena))next--;
    if(!nativeClearSegment(from,path[next],arena))return [];
    result.push(path[next]);from=path[next];n=next+1;
  }
  return result;
}

export function nativeNavigationSize(arena: Arena) {return graphs.get(worldKey(arena))?.nodes.length ?? 0;}
export type ReachableMapPoint={point:Vec;travel:number;initialDirection:{x:number;z:number}};
// Static map knowledge around an observed position, never an enemy query. A
// bounded graph expansion is cheaper than planning a separate path per exit.
export function nativeReachableAround(origin:Vec,arena:Arena,maxTravel:number):ReachableMapPoint[] {
  const graph=graphs.get(worldKey(arena));
  if(!arena.native || !graph?.nodes.length || !Number.isFinite(maxTravel) || maxTravel<=0)return [];
  const start=ground(origin,arena);if(!start)return [];
  const roots=graph.nodes.map((node,id)=>({id,travel:distance(start,node.point)}))
    .filter(row=>row.travel<1.8).sort((a,b)=>a.travel-b.travel).slice(0,3)
    .filter(row=>nativeClearSegment(start,graph.nodes[row.id].point,arena));
  const costs=new Float64Array(graph.nodes.length).fill(Infinity);
  const queue:{id:number;travel:number;initialDirection:{x:number;z:number}}[]=[],result:ReachableMapPoint[]=[];
  for(const root of roots) {
    const p=graph.nodes[root.id].point,length=Math.hypot(p.x-start.x,p.z-start.z);
    costs[root.id]=root.travel;queue.push({...root,initialDirection:{x:length>.01?(p.x-start.x)/length:0,z:length>.01?(p.z-start.z)/length:0}});
  }
  const budget=Math.min(24,maxTravel);
  while(queue.length && result.length<384) {
    queue.sort((a,b)=>b.travel-a.travel || b.id-a.id);
    const row=queue.pop()!;if(row.travel!==costs[row.id] || row.travel>budget)continue;
    const point=graph.nodes[row.id].point;
    result.push({point:{...point},travel:row.travel,initialDirection:{...row.initialDirection}});
    for(const next of graph.nodes[row.id].links) {
      const p=graph.nodes[next].point,travel=row.travel+distance(point,p);
      if(travel>budget || travel>=costs[next])continue;
      const length=Math.hypot(p.x-start.x,p.z-start.z);
      const initialDirection=row.travel>.2?row.initialDirection:{x:length>.01?(p.x-start.x)/length:0,z:length>.01?(p.z-start.z)/length:0};
      costs[next]=travel;queue.push({id:next,travel,initialDirection});
    }
  }
  return result;
}
export function exportNativeNavigation(arena:Arena):NativeNavigationData {
  return {version:1,nodes:graphs.get(worldKey(arena))?.nodes.map(node=>({point:{...node.point},links:[...node.links]})) ?? []};
}
export function installNativeNavigation(arena:Arena,data:NativeNavigationData) {
  if(data?.version!==1 || !Array.isArray(data.nodes) || !data.nodes.length || data.nodes.length>15000 ||
    data.nodes.some(node=>!node || !node.point || ![node.point.x,node.point.y,node.point.z].every(Number.isFinite) ||
      !inside(node.point,arena) || !Array.isArray(node.links) || node.links.length>64 ||
      node.links.some(id=>!Number.isSafeInteger(id) || id<0 || id>=data.nodes.length)))throw new Error('Invalid native navigation graph');
  graphs.set(worldKey(arena),{nodes:data.nodes,segments:new Map()});
}
