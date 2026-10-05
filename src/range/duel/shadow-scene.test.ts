import {describe,expect,it} from 'vitest';
import {actorShadow,actorShadows,ActorShadowRenderer} from './shadow-scene';
import {DuelSimulation} from './simulation';
import {testArena} from './geometry';

describe('shared visible actor shadow geometry',()=>{
  it('casts finite ground geometry but never casts a dead actor',()=>{
    const actor=new DuelSimulation().snapshot()[0],arena=testArena();
    const shadow=actorShadow(actor,arena)!;
    expect(shadow.polygon).toHaveLength(12);expect(shadow.samples).toHaveLength(13);
    expect(shadow.polygon.every(point=>Number.isFinite(point.x+point.y+point.z)&&point.y===.015)).toBe(true);
    expect(actorShadow({...actor,alive:false},arena)).toBeUndefined();
  });
  it('suppresses blocked illumination rather than revealing a hidden caster through cover',()=>{
    const actor=new DuelSimulation().snapshot()[0],arena=testArena();
    arena.solids.push({center:{x:actor.position.x,y:3,z:actor.position.z},size:{x:10,y:1,z:10}});
    expect(actorShadow(actor,arena)).toBeUndefined();
  });
  it('renders the same footprint and reuses geometry across repeated updates',()=>{
    const actors=new DuelSimulation().snapshot(),renderer=new ActorShadowRenderer();
    renderer.update(actorShadows(actors,testArena()));const geometry=(renderer.group.children[0] as any).geometry;
    renderer.update(actorShadows(actors,testArena()));expect((renderer.group.children[0] as any).geometry).toBe(geometry);
    renderer.update([]);expect(renderer.group.children).toHaveLength(0);renderer.dispose();
  });
});
