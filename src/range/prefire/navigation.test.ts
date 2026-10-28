import {describe, expect, it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Group} from 'three';
import {defaults} from '../config';
import {PrefireNavigator} from './navigation';
import {PrefireNavigation} from './PrefireNavigation';
import {PrefireSession} from './session';
import {sanitizePrefireConfig} from './config';
import {sourcePoint} from './routes';
import type {PrefireMap} from './map';
import type {NativeMapCollision} from './native-collision';
import type {PrefireCatalog, PrefireRoute} from './schema';

const p = (x: number, z: number, y = 0) => ({x,y,z});
describe('ordered Prefire route navigation', () => {
  it('points relative to view yaw and displays the next route checkpoint, not a bot', () => {
    const nav = new PrefireNavigator([p(10,0),p(10,-10)], 'Long to A');
    expect(nav.update(p(0,0),0)).toMatchObject({waypoint:1,total:2,distance:10,bearing:Math.PI/2,complete:false,destination:'Long to A'});
    expect(nav.update(p(0,0),-Math.PI/2).bearing).toBe(0);
    expect(nav.update(p(10,0),0)).toMatchObject({waypoint:2,distance:10});
    expect(nav.update(p(10,-10),0)).toMatchObject({complete:true,distance:0});
  });
  it('does not shortcut later segments, skip vertically separated floors or undo progress', () => {
    const nav = new PrefireNavigator([p(5,0,2),p(10,0,2)], 'Upper tunnel');
    expect(nav.update(p(5,0,0),0).waypoint).toBe(1);
    expect(nav.update(p(10,0,2),0).waypoint).toBe(1);
    expect(nav.update(p(5,0,2),0).waypoint).toBe(2);
    expect(nav.update(p(0,0,2),0).waypoint).toBe(2);
  });
  it('recognizes crossing a checkpoint between reports but not a teleport through one', () => {
    const nav = new PrefireNavigator([p(0,0)], 'Mid');
    nav.update(p(-.9,0),0);
    expect(nav.update(p(.9,0),0).complete).toBe(true);
    const teleported = new PrefireNavigator([p(0,0)], 'Mid');
    teleported.update(p(-10,0),0);
    expect(teleported.update(p(10,0),0).complete).toBe(false);
  });
  it('keeps the covered bend active until the player actually reaches it', () => {
    const nav = new PrefireNavigator([p(0,0),p(0,10)], 'Covered entry');
    expect(nav.update(p(-.7,0),0)).toMatchObject({waypoint:1,complete:false,distance:.7});
    expect(nav.update(p(-.34,0),0).waypoint).toBe(2);
  });
  it('does not clear checkpoints in reverse order using the same movement report', () => {
    const nav = new PrefireNavigator([p(.5,0),p(-.5,0)], 'Turn back');
    nav.update(p(-.9,0),0);
    expect(nav.update(p(.9,0),0)).toMatchObject({waypoint:2,complete:false});
    expect(nav.update(p(-.5,0),0).complete).toBe(true);
  });
  it('can clear several checkpoints crossed in forward order between reports', () => {
    const nav = new PrefireNavigator([p(-.5,0),p(.5,0)], 'Short segment');
    nav.update(p(-.9,0),0);
    expect(nav.update(p(.9,0),0).complete).toBe(true);
  });
  it('does not interpolate a vertical teleport through a checkpoint on another floor', () => {
    const nav = new PrefireNavigator([p(0,0)], 'Lower tunnel');
    nav.update(p(-.9,0,-3),0);
    expect(nav.update(p(.9,0,3),0)).toMatchObject({waypoint:1,complete:false});
    expect(nav.update(p(0,0),0).complete).toBe(true);
  });
  it('recognizes arrival after vertical movement with no horizontal delta', () => {
    const nav = new PrefireNavigator([p(0,0)], 'Landing');
    nav.update(p(0,0,1),0);
    expect(nav.update(p(0,0),0).complete).toBe(true);
  });
  it('does not invent a horizontal turn when the next waypoint is on another level', () => {
    const nav = new PrefireNavigator([p(0,0,3),p(5,0,3)], 'Upper tunnel');
    expect(nav.update(p(0,0),1)).toMatchObject({waypoint:1,complete:false,bearing:0,guidance:'wrong-level'});
    expect(nav.update(p(0,0,3),1)).toMatchObject({waypoint:2,complete:false,guidance:undefined});
  });
  it('retains ordinary guidance on a sloped active leg before reaching the waypoint level', () => {
    const nav = new PrefireNavigator([p(0,10,3)], 'Ramp to A');
    expect(nav.update(p(0,0),0)).toMatchObject({waypoint:1,guidance:undefined,bearing:Math.PI});
    expect(nav.update(p(0,5,1.5),0).guidance).toBeUndefined();
    expect(nav.update(p(0,10,3),0).complete).toBe(true);
  });
  it('suppresses direct-through-cover guidance off the active segment without skipping to a later leg', () => {
    const nav = new PrefireNavigator([p(10,0),p(10,10)], 'Ordered entry');
    nav.update(p(0,0),0);
    expect(nav.update(p(10,10),0)).toMatchObject({waypoint:1,complete:false,bearing:0,guidance:'off-route'});
    expect(nav.update(p(5,0),0)).toMatchObject({waypoint:1,complete:false,guidance:undefined});
    expect(nav.update(p(10,0),0).waypoint).toBe(2);
  });
  it('does not reintroduce completed segments after going off route or backwards', () => {
    const nav = new PrefireNavigator([p(5,0),p(10,0)], 'A site');
    nav.update(p(0,0),0);
    nav.update(p(5,0),0);
    expect(nav.update(p(0,0),0)).toMatchObject({waypoint:2,guidance:'off-route'});
    expect(nav.update(p(10,0),0).complete).toBe(true);
    expect(nav.update(p(0,10,4),0)).toMatchObject({complete:true,distance:0,bearing:0,guidance:undefined});
  });
  it('renders recovery status instead of a misleading directional arrow', () => {
    const nav = new PrefireNavigator([p(0,0,3)], 'Upper tunnel');
    const markup = renderToStaticMarkup(createElement(PrefireNavigation, {navigation:nav.update(p(0,0),0)}));
    expect(markup).toContain('Waypoint is on another level');
    expect(markup).not.toContain('rotate(');
    const offRoute = new PrefireNavigator([p(10,0)], 'A site');
    offRoute.update(p(0,0),0);
    const recovery = renderToStaticMarkup(createElement(PrefireNavigation, {navigation:offRoute.update(p(0,10),0)}));
    expect(recovery).toContain('Rejoin the current route segment');
    expect(recovery).not.toContain('rotate(');
  });
  it('does not round an unfinished nearby checkpoint down to zero meters', () => {
    const nav = new PrefireNavigator([p(0,0)], 'Covered entry');
    const navigation = nav.update(p(-.4,0),0);
    expect(navigation.complete).toBe(false);
    expect(renderToStaticMarkup(createElement(PrefireNavigation,{navigation}))).toContain('0.4 m to next waypoint');
  });
  it('keeps the full ordered approach when weighted occupancy omits the opening angle', () => {
    const route: PrefireRoute = {id:'fixture',name:'Empty opening',spawn:[0,0,0],look:[0,100,0],
      path:[[0,100,0],[0,200,0]],angles:[
        {id:'first',name:'Opening hold',position:[200,100,0]},
        {id:'later',name:'Later hold',position:[200,300,0]},
      ]};
    const catalog: PrefireCatalog = {id:'fixture',name:'Fixture',revision:'1',routes:[route],sources:[]};
    const map: PrefireMap = {scene:new Group(),dispose(){},settle:sourcePoint,
      collision:{fits:()=>true,ray:()=>undefined,
        sweep:(_from: unknown,to: unknown)=>({position:to,fraction:1,startSolid:false}),
        vertical:(_point: unknown,_from: number,to: number)=>({feet:Math.max(0,to),grounded:to<=0,ceiling:false}),
      } as unknown as NativeMapCollision};
    const config = sanitizePrefireConfig({routeId:route.id,routeGuide:false,botBehavior:'static',population:'all'},[route.id]);
    const fixedSession = new PrefireSession(map,config,catalog), fixed = fixedSession.create(defaults,7);
    const weightedSession = new PrefireSession(map,{...config,population:'random',botsPerRun:1},catalog);
    let weighted = weightedSession.create(defaults,1);
    for (let seed = 2; seed <= 16 && weighted.selectedAngles[0].id === 'first'; seed++) weighted = weightedSession.create(defaults,seed);
    expect(weighted.selectedAngles.map(angle=>angle.id)).toEqual(['later']);
    expect(weightedSession.report(weighted).navigation).toEqual(fixedSession.report(fixed).navigation);
    const opening = weightedSession.report(weighted).navigation;
    Object.assign(weighted.actors[1],{alive:false,position:p(100,100,5)});
    expect(weightedSession.report(weighted).navigation).toEqual(opening);
    for (const point of route.path) {
      const feet = sourcePoint(point);
      for (const sim of [fixed,weighted]) Object.assign(sim.actors[0],{feet:feet.y,position:{...feet,y:feet.y+sim.actors[0].eyeHeight}});
      expect(weightedSession.report(weighted).navigation).toEqual(fixedSession.report(fixed).navigation);
    }
    expect(weightedSession.report(weighted).navigation?.complete).toBe(true);
  });
  it('handles an empty route without NaN or invented movement instructions', () => {
    expect(new PrefireNavigator([], 'Retry angle').update(p(0,0),0)).toEqual({
      waypoint:0,total:0,distance:0,bearing:0,complete:true,destination:'Retry angle',
    });
  });
});
