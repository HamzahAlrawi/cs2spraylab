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
  it.each([-3.2,3.2])('projects native-map shadows onto the actual floor at %s meters',floor=>{
    const actor=new DuelSimulation().snapshot()[0],arena=testArena();
    actor.feet=floor; actor.position.y=floor+64*.0254;
    arena.native={fits:()=>true,sweep:(from,to)=>({position:to,fraction:1,startSolid:false}),
      vertical:()=>({feet:floor,grounded:true,ceiling:false}),
      ray:(origin,direction)=> direction.x===0&&direction.z===0&&direction.y===-1
        ? {distance:origin.y-floor,normal:{x:0,y:1,z:0},surfaceId:0}:undefined};
    const shadow=actorShadow(actor,arena)!;
    expect(shadow.polygon.every(point=>Math.abs(point.y-(floor+.015))<1e-8)).toBe(true);
  });
});
