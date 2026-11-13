import {describe,expect,it} from 'vitest';
import plan from '../../../docs/common-angle-pockets.json';
import coverage from './data/common-pocket-coverage.json';
import dustSource from './data/community-retakes-dust2.json';
import mirageSource from './data/community-retakes-mirage.json';
import {dust2Catalog} from './routes';
import {mirageCatalog} from './mirage-routes';
import {choosePrefireAngles,prefireCandidates} from './occupancy';
import {randomStream} from '../duel/rng';
import type {PrefireCatalog} from './schema';

describe('named common-angle coverage (not population frequencies)',()=>{
  it('pins additional reusable coordinate sources without promoting legacy data to CS2 mechanics',()=>{
    expect(dustSource).toMatchObject({commit:'9123adca1371ff4cbe90a4630a1ff113124ae8df',license:'GPL-3.0'});
    expect(mirageSource).toMatchObject({commit:'9aae1570ff4c13b2b501a6f336562486c40d3c81',license:'GPL-3.0'});
    expect(dustSource.angles).toHaveLength(52);expect(mirageSource.angles).toHaveLength(38);
    for(const source of [dustSource,mirageSource]){
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);expect(source.licenseNotice).toContain('GNU GENERAL PUBLIC LICENSE');
      expect(source.context).toMatch(/not .*frequenc|not .*statistic/i);
    }
    expect(mirageSource.context).toContain('Legacy CS:GO retake coordinate candidates only');
  });
  it('maps each independent named pocket to actual admitted anchors and reports per-approach gaps',()=>{
    for(const catalog of [dust2Catalog,mirageCatalog]){
      const pockets=plan.maps[catalog.id as keyof typeof plan.maps];
      const groups=coverage.maps[catalog.id as keyof typeof coverage.maps];
      for(const pocket of pockets){
        expect(new Set(pocket.references.map(id=>new URL(plan.references[id as keyof typeof plan.references]).hostname)).size).toBeGreaterThanOrEqual(2);
        expect(Object.values(groups).some(list=>list.some(g=>g.id===pocket.id)),`${catalog.id}/${pocket.id}`).toBe(true);
        for(const routeId of pocket.routes){
          const route=catalog.routes.find(r=>r.id===routeId)!;
          const group=route.coverageGroups?.find(g=>g.id===pocket.id);
          if(!group){expect(coverage.gaps).toContainEqual({map:catalog.id,route:routeId,pocket:pocket.id,name:pocket.name});continue;}
          const [x0,y0,z0,x1,y1,z1]=pocket.bounds;
          for(const id of group.angleIds){
            const angle=prefireCandidates(route).find(a=>a.id===id)!;expect(angle).toBeDefined();
            const [x,y,z]=angle.position;
            expect(x>=x0&&x<=x1&&y>=y0&&y<=y1&&z>=z0&&z<=z1).toBe(true);
          }
        }
      }
    }
  });
  it('keeps every mapped common pocket reachable by weighted practice, within the actor budget',()=>{
    for(const catalog of [dust2Catalog,mirageCatalog] as PrefireCatalog[])for(const route of catalog.routes){
      const seen=new Set<string>();
      for(let seed=0;seed<64;seed++){
        const selected=choosePrefireAngles(route,'random',randomStream(seed,'named-common-pockets'),catalog.density,4);
        expect(selected).toHaveLength(4);
        for(const group of route.coverageGroups??[])if(selected.some(a=>group.angleIds.includes(a.id!)))seen.add(group.id);
      }
      for(const group of route.coverageGroups??[])expect(seen.has(group.id),`${catalog.id}/${route.id}/${group.id}`).toBe(true);
    }
  });
  it('clears beyond the old Ramp endpoint and starts Underpass before the exposed corridor',()=>{
    const ramp=mirageCatalog.routes.find(r=>r.id==='a-ramp')!;
    expect(ramp.path.length).toBeGreaterThan(5);
    expect(ramp.coverageGroups?.find(g=>g.id==='shadows')?.angleIds.length).toBeGreaterThan(0);
    expect(ramp.coverageGroups?.find(g=>g.id==='ninja')?.angleIds.length).toBeGreaterThan(0);
    const under=mirageCatalog.routes.find(r=>r.id==='underpass-connector')!;
    expect(under.startLabel).toBe('House / Underpass stairs');expect(under.spawn[2]).toBeGreaterThan(-100);
    expect(under.coverageGroups?.find(g=>g.id==='underpass')?.angleIds.length).toBeGreaterThan(0);
    const admitted=dust2Catalog.routes.flatMap(prefireCandidates);
    const variants=admitted.filter(a=>a.source?.dataset==='community-retakes-dust2'&&a.exclusionGroup);
    expect(variants.length).toBeGreaterThan(0);
    for(const variant of variants)expect(admitted.some(a=>a.id!==variant.id&&a.exclusionGroup===variant.exclusionGroup)).toBe(true);
    // Both records of this nearby pair are exposed at the protected starts;
    // finding a source coordinate must never force its admission.
    expect(admitted.some(a=>a.id==='de_dust2:community-retakes/23'||a.id==='de_dust2:community-retakes/39')).toBe(false);
  });
});
