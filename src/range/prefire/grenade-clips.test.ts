import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const base='public/revamp/maps/dust2/';
describe.skipIf(!existsSync(base+'grenade-clips.json'))('separate native grenade collision archive',()=>{
  it('pins exact clip bytes to the same map/PHYS without making them bullet/player blockers',()=>{
    const clip=JSON.parse(readFileSync(base+'grenade-clips.json','utf8')),
      world=JSON.parse(readFileSync(base+'collision.json','utf8')),bytes=readFileSync(base+'grenade-clips.bin');
    expect(clip.mapSha256).toBe(world.mapSha256);expect(clip.sourceSha256).toBe(world.sourceSha256);
    expect(clip.unit).toBe(.0254);expect(clip.transform).toBe(world.transform);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(clip.binarySha256);
    expect(clip.groups.length).toBeGreaterThan(0);
    for(const group of clip.groups) {
      expect(group.tags).toContain('csgo_grenadeclip');
      expect(world.groups.some((runtime:{id:number})=>runtime.id===group.id)).toBe(false);
      expect(group.indexCount%3).toBe(0);expect(group.offset+group.vertexCount*12+group.indexCount*4).toBeLessThanOrEqual(bytes.length);
      expect(group.primitives.reduce((sum:number,p:{triangleCount:number})=>sum+p.triangleCount,0)).toBe(group.indexCount/3);
    }
  });
});
