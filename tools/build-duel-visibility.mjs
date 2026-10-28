import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {NativeVisibility} from '../src/range/prefire/native-visibility.mjs';
const root='public/revamp/maps/dust2';
const metadata=JSON.parse(await fs.readFile(`${root}/visibility.json`,'utf8')),bytes=await fs.readFile(`${root}/visibility.bin`);
const source=new NativeVisibility(metadata,bytes),sourceView=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
const catalog=JSON.parse(await fs.readFile('src/range/duel/real-map-catalog.json','utf8'));
for(const chunk of catalog.chunks) {
  const nodes=[],regions=[],masks=[],maskIds=new Map(),clusters=new Set();
  const writeNode=(id,index,min,max)=>{
    if(min.some((v,i)=>v>chunk.sourceMax[i]||max[i]<chunk.sourceMin[i])){nodes[index]=[1,0];return;}
    const node=source.node(id);if(!node){nodes[index]=[1,0];return;}
    if(node.leaf) {
      const offset=regions.length;
      for(let i=0;i<node.count;i++) {
        const regionOffset=metadata.m_RegionBlock.m_nOffset+(node.offset+i)*8;
        const first=sourceView.getUint32(regionOffset,true),second=sourceView.getUint32(regionOffset+4,true),mask=second>>>8;
        let target=maskIds.get(mask);
        if(target===undefined){target=masks.length;maskIds.set(mask,target);const at=metadata.m_MasksBlock.m_nOffset+mask*8;
          masks.push([sourceView.getUint32(at,true),sourceView.getUint32(at+4,true)]);}
        clusters.add(first&0x7fff);regions.push([first,(target<<8)|(second&255)]);
      }
      nodes[index]=[(offset<<1)|1,node.count];return;
    }
    const first=nodes.length;nodes.push(...Array.from({length:8},()=>[1,0]));nodes[index]=[first<<1,0];
    const mid=min.map((v,i)=>(v+max[i])/2);
    for(let octant=0;octant<8;octant++)writeNode(node.offset+octant,first+octant,
      min.map((v,i)=>octant&(1<<i)?mid[i]:v),max.map((v,i)=>octant&(1<<i)?v:mid[i]));
  };
  nodes.push([1,0]);writeNode(0,0,metadata.m_vMinBounds,metadata.m_vMaxBounds);
  const rows=Buffer.alloc(metadata.m_nVisBlocks.m_nElementCount);
  for(const cluster of clusters) {
    const offset=cluster*metadata.m_nPVSBytesPerCluster;
    bytes.copy(rows,offset,metadata.m_nVisBlocks.m_nOffset+offset,metadata.m_nVisBlocks.m_nOffset+offset+metadata.m_nPVSBytesPerCluster);
  }
  const pack=values=>{const b=Buffer.alloc(values.length*8);values.forEach(([a,c],i)=>{b.writeUInt32LE(a>>>0,i*8);b.writeUInt32LE(c>>>0,i*8+4);});return b;};
  const blocks=[pack(nodes),pack(regions),pack(masks),rows],out=Buffer.concat(blocks);
  const result={...metadata,m_NodeBlock:{m_nOffset:0,m_nElementCount:nodes.length},
    m_RegionBlock:{m_nOffset:blocks[0].length,m_nElementCount:regions.length},
    m_MasksBlock:{m_nOffset:blocks[0].length+blocks[1].length,m_nElementCount:masks.length},
    m_nVisBlocks:{m_nOffset:blocks[0].length+blocks[1].length+blocks[2].length,m_nElementCount:rows.length},
    sourceSha256:createHash('sha256').update(bytes).digest('hex')};
  const sliced=new NativeVisibility(result,out);let checks=0;
  for(let x=0;x<7;x++)for(let y=0;y<7;y++)for(let z=0;z<5;z++) {
    const p=[x,y,z].map((n,i)=>chunk.sourceMin[i]+(chunk.sourceMax[i]-chunk.sourceMin[i])*(n+.5)/[7,7,5][i]);
    assert.deepEqual(sliced.pointRow(p),source.pointRow(p));checks++;
  }
  await fs.writeFile(`${root}/duel/${chunk.id}/visibility.json`,JSON.stringify(result));
  await fs.writeFile(`${root}/duel/${chunk.id}/visibility.bin`,out);
  console.log(JSON.stringify({chunk:chunk.id,nodes:nodes.length,regions:regions.length,originClusters:clusters.size,checks,bytes:out.length}));
}
