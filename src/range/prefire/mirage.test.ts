import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {describe,expect,it} from 'vitest';
import {mirageMap} from './maps/mirage';
import {mirageCatalog} from './mirage-routes';
import data from './data/openprefire-mirage.json';
import retakes from './data/retakes-mirage.json';
import {prefireCandidates} from './occupancy';
import {validateMapCatalogScope} from './map-onboarding';
import {realMapApproaches} from '../duel/real-map-rounds';

describe('Mirage package/catalog isolation',()=>{
  it('has eight distinct native-authored approaches and six bounded Duel chunks',()=>{
    expect(mirageCatalog.routes.map(r=>r.id)).toEqual(['a-ramp','a-palace','b-apartments','mid-short','underpass-connector','market-b','short-b','jungle-a']);
    expect(mirageMap.index.routes.map(r=>r.id)).toEqual(mirageCatalog.routes.map(r=>r.id));
    expect(mirageMap.chunks).toHaveLength(6);expect(validateMapCatalogScope(mirageMap,mirageCatalog)).toEqual([]);
    for(const chunk of mirageMap.chunks){
      expect(chunk.mapId).toBe('de_mirage');expect(realMapApproaches(chunk,mirageCatalog).some(r=>r.id===chunk.routeId)).toBe(true);
    }
  });
  it('retains exact upstream enemy coordinates, stance and rotation with scoped source IDs',()=>{
    let count=0;for(const route of mirageCatalog.routes)for(const angle of prefireCandidates(route)){
      const s=angle.source!,sample=s.dataset==='retakes-mirage'?retakes.angles[s.index-1]:data.profiles[s.profile as keyof typeof data.profiles].angles[s.index-1];
      expect(angle.position).toEqual(sample.position);expect(angle.rotation).toEqual(sample.rotation);expect(angle.crouched).toBe(sample.crouched);
      expect(['openprefire-mirage','retakes-mirage']).toContain(s.dataset);expect(angle.id).toMatch(/^de_mirage:/);count++;
    }
    expect(count).toBe(341);expect(mirageCatalog.density).toBeUndefined();expect(mirageCatalog.encounters).toBeUndefined();
  });
  it('includes focused common-angle sets without moving source anchors or overlapping holders',()=>{
    for(const route of mirageCatalog.routes.filter(r=>r.lineups?.length))for(const lineup of route.lineups!){
      expect(lineup.angles).toHaveLength(5);
      for(const angle of lineup.angles)expect(prefireCandidates(route).find(a=>a.id===angle.id)).toEqual(angle);
      expect(new Set(lineup.angles.map(a=>a.exclusionGroup??a.id)).size).toBe(5);
    }
    expect(mirageCatalog.routes.filter(r=>r.lineups?.length)).toHaveLength(4);
    expect(mirageCatalog.sources.some(s=>s.id==='retakes-mirage'&&s.license==='GPL-3.0')).toBe(true);
  });
  it('keeps independent full-acceptance coverage pending, rather than treating beta as verified parity',()=>{
    const plan=JSON.parse(fs.readFileSync('docs/mirage/coverage-plan.json','utf8'));
    expect(plan.scopeReview.approved).toBe(false);expect(plan.areas).toHaveLength(3);
    expect(plan.areas.flatMap((a:any)=>a.pockets).every((p:any)=>p.status==='pending')).toBe(true);
    expect(mirageMap.onboarding?.state).not.toBe('approved');
  });
});

const root='public/revamp/maps/mirage';
describe.skipIf(!fs.existsSync(root+'/visual.json'))('local Mirage native delivery (not engine parity)',()=>{
  it('bakes the new clears into Duel with usable covered starts and native hold lanes',()=>{
    const delivered=(asset:{url:string;encoding:string;sha256:string})=>{
      const bytes=fs.readFileSync(`public/revamp${asset.url}`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      return JSON.parse((asset.encoding==='gzip'?gunzipSync(bytes):bytes).toString('utf8'));
    };
    for(const [chunk,id] of [['mirage-b','short-b'],['mirage-a','jungle-a']]){
      const manifest=JSON.parse(fs.readFileSync(`${root}/duel/${chunk}/chunk.json`,'utf8'));
      const delivery=delivered(manifest.delivery),round=delivered(delivery.files['round-data.json']);
      const course=round.courses.find((c:any)=>c.id===id);
      expect(course).toBeDefined();expect(course.holds.length).toBeGreaterThanOrEqual(5);
      expect(course.starts.length).toBeGreaterThan(0);
      expect(course.starts.every((s:any)=>s.holds.length>=5)).toBe(true);
      expect(course.holds.some((h:any)=>Math.hypot(h.lane.edge.x-h.lane.anchor.x,h.lane.edge.z-h.lane.anchor.z)>.1)).toBe(true);
    }
  });
  it('has valid textures, alpha materials, source metadata and separate grenade-only collision',()=>{
    const collision=JSON.parse(fs.readFileSync(root+'/collision.json','utf8')),visual=JSON.parse(fs.readFileSync(root+'/visual.json','utf8'));
    const bytes=fs.readFileSync(root+'/collision.bin');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(collision.collisionSha256);
    expect(collision.source).toBe('maps/de_mirage/world_physics.vmdl_c');
    expect(collision.unit).toBe(.0254);expect(collision.groups.some((g:any)=>g.tags.includes('csgo_grenadeclip')&&!g.movement&&!g.shots)).toBe(true);
    for(const file of visual.files){
      const gltf=JSON.parse(fs.readFileSync(`${root}/${file}`,'utf8'));
      for(const resource of [...gltf.images??[],...gltf.buffers??[]]){
        if(!resource.uri)continue;expect(resource.uri).not.toMatch(/data:|dust2/);expect(fs.existsSync(`${root}/${resource.uri}`)).toBe(true);
      }
    }
  });
});
