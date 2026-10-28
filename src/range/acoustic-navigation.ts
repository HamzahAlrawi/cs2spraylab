import type {Vec} from './actor-physics';

export type AcousticNode={point:Vec;links:readonly number[]};
const distance=(a:Vec,b:Vec)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

/** Navigation-derived diffraction approximation, not Source 2 acoustic portals. */
export class AcousticNavigation {
  constructor(private nodes:readonly AcousticNode[],private clear:(a:Vec,b:Vec)=>boolean) {}
  direct(a:Vec,b:Vec){return this.clear(a,b);}
  route(source:Vec,listener:Vec):{distance:number;corner:Vec}|undefined {
    const connect=(point:Vec)=>this.nodes.map((node,id)=>({id,cost:distance(point,node.point)}))
      .filter(row=>row.cost<3.5).sort((a,b)=>a.cost-b.cost).slice(0,10)
      .filter(row=>this.clear(point,this.nodes[row.id].point)).slice(0,4);
    const roots=connect(source),ends=new Map(connect(listener).map(row=>[row.id,row.cost]));
    if(!roots.length||!ends.size)return;
    const costs=new Float64Array(this.nodes.length).fill(Infinity),parents=new Int32Array(this.nodes.length).fill(-1);
    const queue=new Set<number>();
    for(const root of roots){costs[root.id]=root.cost;queue.add(root.id);}
    const budget=distance(source,listener)*1.8+3;
    let best=-1,bestCost=budget;
    for(let visited=0;queue.size&&visited<512;visited++) {
      let id=-1,minimum=Infinity;
      for(const candidate of queue)if(costs[candidate]<minimum){id=candidate;minimum=costs[candidate];}
      if(id<0||minimum>=bestCost)break;
      queue.delete(id);
      const end=ends.get(id);
      if(end!==undefined&&minimum+end<bestCost){best=id;bestCost=minimum+end;}
      for(const next of this.nodes[id].links) {
        if(next<0||next>=this.nodes.length)continue;
        const cost=minimum+distance(this.nodes[id].point,this.nodes[next].point);
        if(cost<costs[next]&&cost<bestCost){costs[next]=cost;parents[next]=id;queue.add(next);}
      }
    }
    if(best<0)return;
    // Pull the final segment back to the furthest directly audible point. Dense
    // walk grids otherwise put the apparent sound almost on the listener.
    let corner=this.nodes[best].point;
    for(let id=parents[best],count=0;id>=0&&count<512;id=parents[id],count++) {
      if(!this.clear(listener,this.nodes[id].point))break;
      corner=this.nodes[id].point;
    }
    return {distance:bestCost,corner:{...corner}};
  }
}
