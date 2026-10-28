import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// Offline, byte-level geometry/mask audit. This does not claim that Rapier's
// contact solver or a future grenade simulation is Valve's Rubikon solver.
const base='public/revamp/maps/dust2',work='research/dust2',unit=.0254;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const physics=JSON.parse(fs.readFileSync(`${work}/physics.json`,'utf8'));
const manifest=JSON.parse(fs.readFileSync(`${base}/collision.json`,'utf8')),bytes=fs.readFileSync(`${base}/collision.bin`);
const game=process.env.CS2_PATH??'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
assert.equal(hash(fs.readFileSync(`${game}/game/csgo/maps/de_dust2.vpk`)),manifest.mapSha256,'Installed map changed');
assert.equal(hash(fs.readFileSync(`${work}/world_physics.vmdl_c`)),manifest.sourceSha256,'PHYS extraction changed');
assert.equal(hash(bytes),manifest.collisionSha256,'Published collision changed');
const floats=blob=>{const b=Buffer.from(blob,'base64');return Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4));};
const groups=new Map();let nextPrimitive=0;
const groupFor=id=>{if(!groups.has(id))groups.set(id,{id,vertices:[],indices:[],primitives:[]});return groups.get(id);};
function append(group,positions,indices,surfaceId,kind,triangleSurfaces) {
  const baseVertex=group.vertices.length/3,firstTriangle=group.indices.length/3;
  for(let i=0;i<positions.length;i+=3)group.vertices.push(Math.fround(positions[i]*unit),Math.fround(positions[i+2]*unit),Math.fround(-positions[i+1]*unit));
  for(const index of indices)group.indices.push(baseVertex+index);
  group.primitives.push({id:nextPrimitive++,firstTriangle,triangleCount:indices.length/3,surfaceId,kind,
    ...(triangleSurfaces?.length?{triangleSurfaces}: {})});
}
for(const part of physics.m_parts) {
  for(const entry of part.m_rnShape.m_hulls) {
    const hull=entry.m_Hull,edges=Buffer.from(hull.m_Edges,'base64'),faces=Buffer.from(hull.m_Faces,'base64'),triangles=[];
    for(const first of faces) {
      const ring=[];let current=first;
      do {assert.ok(ring.length<=edges.length/4);ring.push(edges[current*4+2]);current=edges[current*4];}while(current!==first);
      for(let i=1;i+1<ring.length;i++)triangles.push(ring[0],ring[i],ring[i+1]);
    }
    append(groupFor(entry.m_nCollisionAttributeIndex),floats(hull.m_VertexPositions??hull.m_Vertices),triangles,entry.m_nSurfacePropertyIndex,'convex-hull');
  }
  for(const entry of part.m_rnShape.m_meshes) {
    const data=Buffer.from(entry.m_Mesh.m_Triangles,'base64');
    const triangles=Array.from({length:data.length/4},(_,i)=>data.readUInt32LE(i*4));
    append(groupFor(entry.m_nCollisionAttributeIndex),floats(entry.m_Mesh.m_Vertices),triangles,entry.m_nSurfacePropertyIndex,'mesh',entry.m_Mesh.m_Materials);
  }
}
const report={mapSha256:manifest.mapSha256,sourceSha256:manifest.sourceSha256,collisionSha256:manifest.collisionSha256,groups:[]};
const clipBuffers=[],clipGroups=[];let offset=0;
for(const [id,source] of groups) {
  const attr=physics.m_collisionAttributes[id],tags=attr.m_InteractAsStrings.map(s=>s.toLowerCase()),excludes=attr.m_InteractExcludeStrings.map(s=>s.toLowerCase());
  const grenadeOnly=tags.includes('csgo_grenadeclip'),sky=tags.includes('sky'),published=manifest.groups.find(g=>g.id===id);
  if(!grenadeOnly&&!sky) {
    assert.ok(published,`Missing gameplay collision group ${id}`);
    assert.deepEqual(published.tags,tags);assert.deepEqual(published.excludes,excludes);
    assert.equal(published.movement,!excludes.includes('player'));
    assert.equal(published.shots,!tags.some(tag=>['playerclip','npcclip','passbullets'].includes(tag)));
    const positions=new Float32Array(bytes.buffer,bytes.byteOffset+published.offset,published.vertexCount*3),
      indices=new Uint32Array(bytes.buffer,bytes.byteOffset+published.offset+published.vertexCount*12,published.indexCount);
    assert.deepEqual(positions,new Float32Array(source.vertices),`Source vertices changed in ${id}`);
    assert.deepEqual(indices,new Uint32Array(source.indices),`Source faces changed in ${id}`);
    assert.deepEqual(published.primitives,source.primitives,`Source primitive/material ownership changed in ${id}`);
  }
  if(grenadeOnly) {
    const positions=new Float32Array(source.vertices),indices=new Uint32Array(source.indices);
    clipBuffers.push(Buffer.from(positions.buffer),Buffer.from(indices.buffer));
    clipGroups.push({id,offset,vertexCount:positions.length/3,indexCount:indices.length,tags,excludes,primitives:source.primitives});
    offset+=positions.byteLength+indices.byteLength;
  }
  report.groups.push({id,tags,excludes,primitives:source.primitives.length,triangles:source.indices.length/3,
    exactPublished:!!published,purpose:grenadeOnly?'grenade-only clip; separate archive':sky?'sky boundary; not player/shot geometry':'runtime gameplay collision'});
}
assert.equal(manifest.groups.length,report.groups.filter(g=>g.exactPublished).length);
if(process.argv.includes('--export-grenade-clips')) {
  const clips=Buffer.concat(clipBuffers);
  fs.writeFileSync(`${base}/grenade-clips.bin`,clips);
  fs.writeFileSync(`${base}/grenade-clips.json`,JSON.stringify({version:1,unit,transform:manifest.transform,
    source:manifest.source,sourceSha256:manifest.sourceSha256,mapSha256:manifest.mapSha256,binarySha256:hash(clips),groups:clipGroups,
    policy:'Native grenade-only collision retained independently. Not active player/shot geometry; grenade radius, collision masks and bounce response require separate validation.'}));
}
fs.writeFileSync(`${work}/collision-source-audit.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
