import fs from 'node:fs';
import {createHash} from 'node:crypto';
const source=fs.readFileSync('research/dust2/physics.json'),physics=JSON.parse(source);
const manifest=JSON.parse(fs.readFileSync('public/revamp/maps/dust2/collision.json'));
const sourceSha256=createHash('sha256').update(fs.readFileSync('research/dust2/world_physics.vmdl_c')).digest('hex');
if(sourceSha256!==manifest.sourceSha256)throw new Error('Grenade clip source differs from the pinned map collision export');
const vertices=[],indices=[];
for(const part of physics.m_parts)for(const entry of part.m_rnShape.m_meshes) {
  const attribute=physics.m_collisionAttributes[entry.m_nCollisionAttributeIndex];
  if(!attribute.m_InteractAsStrings.map(s=>s.toLowerCase()).includes('csgo_grenadeclip'))continue;
  const mesh=entry.m_Mesh,data=Buffer.from(mesh.m_Vertices,'base64'),base=vertices.length/3;
  for(let i=0;i<data.length;i+=12)vertices.push(data.readFloatLE(i)*.0254,data.readFloatLE(i+8)*.0254,-data.readFloatLE(i+4)*.0254);
  const triangles=Buffer.from(mesh.m_Triangles,'base64');
  for(let i=0;i<triangles.length;i+=4)indices.push(base+triangles.readUInt32LE(i));
}
if(!vertices.length||indices.some(i=>i>=vertices.length/3))throw new Error('Invalid native grenade clip geometry');
fs.writeFileSync('src/range/prefire/native-grenade-clips.json',JSON.stringify({version:1,map:'dust2',build:manifest.build,
  collisionSha256:manifest.collisionSha256,source:'maps/de_dust2/world_physics.vmdl_c',
  sourceSha256,
  physicsSha256:createHash('sha256').update(source).digest('hex'),vertices,indices})+'\n');
console.log(`Native grenade-only clip: ${vertices.length/3} vertices, ${indices.length/3} triangles; embedded, no new map downloads.`);
