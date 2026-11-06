import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {mirageMap} from './maps/mirage';
import {mirageCatalog} from './mirage-routes';
import data from './data/openprefire-mirage.json';
import {prefireCandidates} from './occupancy';
import {validateMapCatalogScope} from './map-onboarding';
import {realMapApproaches} from '../duel/real-map-rounds';

describe('Mirage package/catalog isolation',()=>{
  it('has six distinct native-authored approaches and three bounded Duel chunks',()=>{
    expect(mirageCatalog.routes.map(r=>r.id)).toEqual(['a-ramp','a-palace','b-apartments','mid-short','underpass-connector','market-b']);
    expect(mirageMap.index.routes.map(r=>r.id)).toEqual(mirageCatalog.routes.map(r=>r.id));
    expect(mirageMap.chunks).toHaveLength(3);expect(validateMapCatalogScope(mirageMap,mirageCatalog)).toEqual([]);
    for(const chunk of mirageMap.chunks){
      expect(chunk.mapId).toBe('de_mirage');expect(realMapApproaches(chunk,mirageCatalog).some(r=>r.id===chunk.routeId)).toBe(true);
    }
  });
  it('retains exact upstream enemy coordinates, stance and rotation with scoped source IDs',()=>{
    let count=0;for(const route of mirageCatalog.routes)for(const angle of prefireCandidates(route)){
      const s=angle.source!,sample=data.profiles[s.profile as keyof typeof data.profiles].angles[s.index-1];
      expect(angle.position).toEqual(sample.position);expect(angle.rotation).toEqual(sample.rotation);expect(angle.crouched).toBe(sample.crouched);
      expect(s.dataset).toBe('openprefire-mirage');expect(angle.id).toMatch(/^de_mirage:/);count++;
    }
    expect(count).toBe(200);expect(mirageCatalog.density).toBeUndefined();expect(mirageCatalog.encounters).toBeUndefined();
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
