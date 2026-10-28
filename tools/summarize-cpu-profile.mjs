import fs from 'node:fs';
const profile=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const nodes=new Map(profile.nodes.map(node=>[node.id,node])),parents=new Map();
for(const node of nodes.values())for(const child of node.children??[])parents.set(child,node.id);
const own=new Map(),inclusive=new Map();
for(let i=0;i<(profile.samples??[]).length;i++) {
  const id=profile.samples[i],ms=(profile.timeDeltas?.[i]??1000)/1000;
  own.set(id,(own.get(id)??0)+ms);
  for(let at=id;at!==undefined;at=parents.get(at))inclusive.set(at,(inclusive.get(at)??0)+ms);
}
const rows=[...nodes].map(([id,node])=>({fn:node.callFrame.functionName,url:node.callFrame.url,line:node.callFrame.lineNumber+1,
  ownMs:Math.round(own.get(id)??0),totalMs:Math.round(inclusive.get(id)??0)}));
console.log(JSON.stringify({self:rows.sort((a,b)=>b.ownMs-a.ownMs).slice(0,25),
  project:rows.filter(row=>row.url.includes('/src/')).sort((a,b)=>b.totalMs-a.totalMs).slice(0,45)},null,2));
