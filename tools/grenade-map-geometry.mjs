import {Euler,Matrix4,Vector3} from 'three';
import {parseKv3} from './kv3.mjs';

export function grenadeBlocks(group) {
  const tags=(group.tags??[]).map(s=>s.toLowerCase()),excluded=(group.excludes??[]).map(s=>s.toLowerCase());
  return !tags.some(s=>['playerclip','npcclip','sky'].includes(s))&&
    !excluded.some(s=>['grenade','csgo_grenade','csgo_thrown_grenade'].includes(s));
}
export function brushEntities(text) {
  return text.split(/^====\d+====\s*$/m).filter(Boolean).map(block=>{
    const entity={};
    for(const line of block.split(/\r?\n/)) {
      const match=/^(classname|model|origin|angles|scales|startdisabled|solidity|worldgroupid|hammeruniqueid)\s+(.+)$/.exec(line);
      if(match)entity[match[1]]=parseKv3(match[2]);
    }
    return entity;
  }).filter(e=>['func_brush','func_clip_vphysics'].includes(e.classname)&&![true,1,'1','true'].includes(e.startdisabled)&&
    Number(e.solidity??0)!==1&&!e.worldgroupid?.startsWith('skybox')&&typeof e.model==='string');
}
export function entityTransform(entity) {
  const origin=entity.origin??[0,0,0],angles=entity.angles??[0,0,0],scales=entity.scales??[1,1,1];
  if(![origin,angles,scales].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||scales.some(s=>s<=0))
    throw Error('Invalid native brush transform');
  const r=Math.PI/180,matrix=new Matrix4().makeRotationFromEuler(new Euler(angles[2]*r,angles[0]*r,angles[1]*r,'ZYX'));
  matrix.scale(new Vector3(...scales));matrix.setPosition(...origin);return matrix;
}
export function entityPhysicsTriangles(physics,entity) {
  const vertices=[],indices=[],point=new Vector3(),matrix=entityTransform(entity);
  const add=blob=>{
    const bytes=Buffer.from(blob,'base64'),base=vertices.length/3;
    if(bytes.length%12)throw Error('Invalid native brush positions');
    for(let i=0;i<bytes.length;i+=12){
      point.set(bytes.readFloatLE(i),bytes.readFloatLE(i+4),bytes.readFloatLE(i+8)).applyMatrix4(matrix);
      if(![point.x,point.y,point.z].every(Number.isFinite))throw Error('Nonfinite native brush');
      vertices.push(point.x*.0254,point.z*.0254,-point.y*.0254);
    }
    return base;
  };
  for(const part of physics.m_parts) {
    for(const hull of part.m_rnShape.m_hulls) {
      const attr=physics.m_collisionAttributes[hull.m_nCollisionAttributeIndex];
      if(!grenadeBlocks({tags:attr.m_InteractAsStrings,excludes:attr.m_InteractExcludeStrings}))continue;
      const data=hull.m_Hull,base=add(data.m_VertexPositions||data.m_Vertices),edges=Buffer.from(data.m_Edges,'base64');
      for(const start of Buffer.from(data.m_Faces,'base64')){
        const face=[];let edge=start;
        do {if(edge>=edges.length/4||face.length>=edges.length/4)throw Error('Invalid native brush face');
          face.push(edges[edge*4+2]);edge=edges[edge*4];}while(edge!==start);
        for(let i=1;i+1<face.length;i++)indices.push(base+face[0],base+face[i],base+face[i+1]);
      }
    }
    for(const entry of part.m_rnShape.m_meshes){
      const attr=physics.m_collisionAttributes[entry.m_nCollisionAttributeIndex];
      if(!grenadeBlocks({tags:attr.m_InteractAsStrings,excludes:attr.m_InteractExcludeStrings}))continue;
      const base=add(entry.m_Mesh.m_Vertices),bytes=Buffer.from(entry.m_Mesh.m_Triangles,'base64');
      for(let i=0;i<bytes.length;i+=4)indices.push(base+bytes.readUInt32LE(i));
    }
  }
  if(indices.some(i=>i>=vertices.length/3)||indices.length%3)throw Error('Invalid native brush triangles');
  return {vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
}
