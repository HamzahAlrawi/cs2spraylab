import {describe, expect, it} from 'vitest';
import {DuelSimulation} from './simulation';
import {sanitizeDuelConfig} from './config';
import {testArena} from './geometry';
import {utilityInventory, canCarryUtility} from './utility-loadout';
import {buildSmokeVolume, smokeContains, MAX_SMOKE_CELLS} from './smoke-volume';
import {TeamUtilityCoordinator} from './team-utility';
import {solveUtilityThrow} from './utility-ballistics';
import {utilityLaunchVelocity, UTILITY_RULES,UTILITY_KERNEL_VERSION} from './utilities';
import {utilityNativeTiming} from './utility-presentation';
import {NATIVE_GRENADE_INPUT} from './grenade-native-input';
import opportunities from './utility-opportunities.json';

function fixture(loadout:string[]=['he','flash','smoke','molotov']) {
  const sim=new DuelSimulation(sanitizeDuelConfig({botCount:2,playerHealth:500,health:500,botUtilities:false,utilityLoadout:loadout}),41,testArena());
  sim.command(1,{});sim.command(2,{});return sim;
}
function advance(sim:DuelSimulation,seconds:number){const end=sim.time+seconds;while(sim.time<end-1e-6)sim.step();}
describe('complete utility carry loop',()=>{
  it('drops and retrieves the actual grenade without replacing a rifle or duplicating stock',()=>{
    const sim=fixture();sim.selectUtility('smoke');sim.start();sim.command(0,{dropPressed:true});advance(sim,.1);
    expect(sim.utilityDrops).toHaveLength(1);expect(sim.drops).toHaveLength(0);expect(sim.utilityInventory().smoke).toBe(0);
    expect(sim.pickupUtilityPlayer()).toBe(false);advance(sim,.4);
    expect(sim.pickupPlayer()).toBe(true);expect(sim.utilityInventory().smoke).toBe(1);
    expect(sim.pickupPlayer()).toBe(false);expect(sim.loadout.primary).toBe('ak47');
    expect(sim.drainEvents().some(event=>event.kind==='utility-pickup')).toBe(true);
  });
  it('enforces total, duplicate-flash, fire-grenade and wall pickup restrictions',()=>{
    expect(canCarryUtility(utilityInventory(['he','flash','smoke','molotov']),'decoy')).toBe(false);
    expect(canCarryUtility(utilityInventory(['flash','flash']),'flash')).toBe(false);
    expect(canCarryUtility(utilityInventory(['molotov']),'incendiary')).toBe(false);
    const sim=fixture([]);sim.start();const p=sim.actors[0].position;
    sim.utilityDrops.push({id:900,utility:'he',owner:1,picked:false,droppedAt:0,position:{x:p.x+.8,y:.06,z:p.z}});
    sim.arena.solids.push({center:{x:p.x+.4,y:1,z:p.z},size:{x:.1,y:2,z:2}});
    expect(sim.nearestUtilityPickup()).toBeUndefined();expect(sim.pickupUtilityPlayer()).toBe(false);
  });
  it('queues a full draw and native release delay without gating gameplay on animation completion',()=>{
    const sim=fixture();sim.start();sim.selectUtility('he');sim.queueUtilityThrow(0);
    const native=utilityNativeTiming('he'),ready=native.deployDuration+NATIVE_GRENADE_INPUT.releaseDelay;
    advance(sim,ready-.03);expect(sim.utilityInventory().he).toBe(1);expect(sim.utilities.projectiles).toHaveLength(0);
    advance(sim,.05);expect(sim.utilityInventory().he).toBe(0);
    expect(sim.drainEvents().filter(event=>event.kind==='utility'&&event.action==='throw')).toHaveLength(1);
    expect(sim.actors[0].weapon.ammo).toBe(30);expect(sim.actors[0].equipReadyAt).toBeGreaterThan(sim.time);
  });
  it('drops an unpinned grenade on death but releases one whose pin is already pulled',()=>{
    const unpinned=fixture();unpinned.start();unpinned.selectUtility('he');unpinned.queueUtilityThrow(0);
    const death=(sim:DuelSimulation)=>(sim as unknown as {dropDeathUtility(actor:typeof sim.actors[number]):void}).dropDeathUtility(sim.actors[0]);
    unpinned.actors[0].alive=false;death(unpinned);
    expect(unpinned.utilities.projectiles).toHaveLength(0);expect(unpinned.utilityDrops[0].utility).toBe('he');
    expect(unpinned.utilityInventory().he).toBe(0);
    const primed=fixture();primed.selectUtility('he');primed.start();primed.command(0,{fireHeld:true});advance(primed,.2);
    primed.actors[0].alive=false;death(primed);
    expect(primed.utilities.projectiles).toHaveLength(1);expect(primed.utilityDrops).toHaveLength(0);
    expect(primed.selectedUtility).toBeUndefined();expect(primed.utilityInventory().he).toBe(0);
  });
});
describe('environmental smoke volume',()=>{
  it('fills only the connected side of a sealed wall and never the floor beneath it',()=>{
    const arena=testArena();arena.solids.push({center:{x:1,y:4,z:0},size:{x:.2,y:8,z:30}});
    const p={x:0,y:.06,z:0},cells=buildSmokeVolume(p,4.2,arena);
    expect(cells.length).toBeGreaterThan(30);expect(cells.length).toBeLessThanOrEqual(MAX_SMOKE_CELLS);
    expect(cells.every(point=>point.x<1&&point.y>=0)).toBe(true);
    expect(smokeContains({x:2,y:1,z:0},{position:p,cells})).toBe(false);
  });
  it('can wrap through an opening instead of requiring a straight ray from its origin',()=>{
    const arena=testArena();arena.solids.push({center:{x:1,y:2,z:0},size:{x:.2,y:4,z:1.3}});
    const cells=buildSmokeVolume({x:0,y:.06,z:0},4.2,arena);
    expect(cells.some(point=>point.x>1.5&&Math.abs(point.z)<.1)).toBe(true);
  });
});
describe('coordinated utility execution',()=>{
  it('reserves one setup per area and releases partners only after the actual detonation',()=>{
    const sim=fixture(),actors=sim.snapshot(),team=new TeamUtilityCoordinator();
    const report={point:{x:0,y:1.6,z:8},observedAt:1,readyAt:1,source:'sight' as const};
    const arena={...testArena(),lanes:[{side:1 as const,anchor:actors[2].position,edge:{...actors[2].position,z:0},retreat:actors[2].position}]};
    expect(team.claim(1,actors[1],'flash',report,actors.slice(1),()=>10)).toBe(true);
    expect(team.claim(1,actors[2],'flash',report,actors.slice(1),()=>10)).toBe(false);
    expect(team.assignment(1.3,actors[2],arena)?.waitForPartner).toBe(true);
    team.thrown(1,88,1.5);expect(team.waiting(2,actors[2])).toBe(true);
    team.detonated(88,3);expect(team.assignment(3.01,actors[2],arena)).toMatchObject({waitForPartner:false,peekAt:3.12});
    expect(team.assignment(7,actors[2],arena)).toBeNull();
  });
  it('keeps novice grenade throws separate from advanced coordinated entries',()=>{
    const sim=fixture(),actors=sim.snapshot(),team=new TeamUtilityCoordinator();
    expect(team.claim(1,actors[1],'he',{point:{x:0,y:1,z:8},observedAt:1,readyAt:1,source:'sound'},actors.slice(1),()=>1)).toBe(true);
    expect(team.diagnostics(1)[0].partners).toEqual([]);
  });
});
describe('validated map utility setups',()=>{
  it('contains independently authored, geometry-versioned setups across every Dust 2 chunk',()=>{
    expect(opportunities.kernelVersion).toBe(UTILITY_KERNEL_VERSION);
    expect(opportunities.entries.length).toBeGreaterThan(80);expect(new Set(opportunities.entries.map(entry=>entry.chunk)).size).toBe(8);
    expect(new Set(opportunities.entries.map(entry=>entry.id)).size).toBe(opportunities.entries.length);
    for(const entry of opportunities.entries){expect(entry.collisionSha256).toMatch(/^[a-f0-9]{64}$/);expect(entry.flightSeconds).toBeGreaterThan(0);}
  });
  it('solves the actual clipped release origin rather than treating the camera as the grenade source',()=>{
    const eye={x:0,y:1.6,z:8},target={x:4,y:.1,z:-6},solution=solveUtilityThrow(eye,target,testArena())!;
    const velocity=utilityLaunchVelocity(solution.direction,1),time=(target.z-solution.origin.z)/velocity.z;
    expect(solution.origin.x+velocity.x*time).toBeCloseTo(target.x,5);
    expect(solution.origin.y+velocity.y*time-UTILITY_RULES.gravity*time*time/2).toBeCloseTo(target.y,3);
  });
});
