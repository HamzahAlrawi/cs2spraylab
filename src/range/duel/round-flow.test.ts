import {describe, expect, it} from 'vitest';
import {RoundFlow, deathView, deathFeet, deathVariant, PLAYER_COLLAPSE_SECONDS} from './round-flow';
import {sanitizeDuelConfig} from './config';
import {DuelSimulation} from './simulation';

describe('continuous duel sessions', () => {
  it('keeps movement, aim, shots and reloads playable after winning without changing scored stats or replay',()=>{
    const sim=new DuelSimulation(sanitizeDuelConfig({botCount:1,practiceSpread:false}),7);
    sim.start();sim.actors[1].alive=false;sim.actors[1].health=0;sim.step();
    expect(sim.postWinPlayable).toBe(false);sim.enablePostWinPlay();
    const result=sim.drainEvents(),completed=sim.completedAt,review=structuredClone(sim.coach.review()),replay=sim.replay.export();
    expect(result.filter(event=>event.kind==='round')).toHaveLength(1);
    expect(sim.postWinPlayable).toBe(true);const before={...sim.actors[0].position},ammo=sim.actors[0].weapon.ammo;
    sim.command(0,{side:1,yawDelta:.1,fireHeld:true,firePressed:true,jumpPressed:true});sim.advance(.25);
    expect(sim.actors[0].position.x).not.toBeCloseTo(before.x);expect(sim.actors[0].feet).toBeGreaterThan(0);
    expect(sim.actors[0].yaw).toBeCloseTo(.1);expect(sim.actors[0].weapon.ammo).toBeLessThan(ammo);
    expect(sim.drainEvents().some(event=>event.kind==='fire')).toBe(true);
    sim.command(0,{side:0,fireHeld:false,reloadPressed:true});
    for(let i=0;i<12;i++)sim.advance(.25);
    expect(sim.actors[0].weapon.ammo).toBe(ammo);expect(sim.outcome).toBe('won');expect(sim.completedAt).toBe(completed);
    expect(sim.coach.review()).toEqual(review);expect(sim.replay.export()).toEqual(replay);
    expect(sim.drainEvents().filter(event=>event.kind==='round')).toEqual([]);
    sim.pause();const time=sim.time;sim.advance(.25);expect(sim.time).toBe(time);
    sim.resume();sim.advance(.1);expect(sim.time).toBeGreaterThan(time);
  });
  it.each(['lost','draw'] as const)('does not resume combat after a %s round',outcome=>{
    const sim=new DuelSimulation();sim.start();sim.phase='result';sim.outcome=outcome;
    sim.enablePostWinPlay();
    sim.command(0,{side:1,fireHeld:true});const before=sim.snapshot();sim.advance(.25);
    expect(sim.playable).toBe(false);expect(sim.time).toBe(0);expect(sim.snapshot()).toEqual(before);
  });
  it('selects the fall from the shot direction in actor-local space', () => {
    const actor = {id: 1, yaw: Math.PI, deathDirection: {x: 0, y: 0, z: -1}};
    expect(deathVariant(actor)).toBe('a');
    expect(deathVariant({...actor, deathDirection: {x: 0, y: 0, z: 1}})).toBe('c');
    expect(deathVariant({...actor, deathDirection: {x: 1, y: 0, z: 0}})).toBe('b');
    expect(deathVariant({...actor, yaw: 0})).toBe('c');
    expect(deathVariant({id: 2, yaw: 0})).toBe('c');
  });
  it('restarts only after a finished round and respects a 1-3 second delay', () => {
    const flow = new RoundFlow();
    expect(flow.advance(.25, false, 1)).toBe(false);
    for (const delay of [1, 2, 3]) {
      flow.finish();
      for (let frame = 0; frame < delay * 4 - 1; frame++) expect(flow.advance(.25, false, delay)).toBe(false);
      expect(flow.remaining(delay)).toBeCloseTo(.25);
      expect(flow.advance(.25, false, delay)).toBe(true);
      flow.reset(); expect(flow.ending).toBe(false);
    }
  });
  it('freezes the countdown on pause and does not skip it after a suspended tab', () => {
    const flow = new RoundFlow(); flow.finish();
    flow.advance(.25, false, 2);
    expect(flow.advance(90, true, 2)).toBe(false);
    expect(flow.remaining(2)).toBe(1.75);
    expect(flow.advance(90, false, 2)).toBe(false);
    expect(flow.remaining(2)).toBe(1.5);
  });
  it('loads health independently for the player and bots with bounded legacy defaults', () => {
    expect(sanitizeDuelConfig({}).playerHealth).toBe(100);
    const sim = new DuelSimulation(sanitizeDuelConfig({playerHealth: 275, health: 60}));
    expect(sim.snapshot().map(actor => actor.health)).toEqual([275, 60]);
    expect(sanitizeDuelConfig({playerHealth: NaN, feedbackSeconds: 10}).playerHealth).toBe(100);
    expect(sanitizeDuelConfig({playerHealth: 600, feedbackSeconds: 10})).toMatchObject({playerHealth: 500, feedbackSeconds: 3});
  });
  it('drops the death camera with prompt accelerating weight and settles without a looping fall', () => {
    let height = 1.6256;
    for (let frame = 0; frame < 180; frame++) {
      const view = deathView(frame / 60, 1.6256);
      expect(view.height).toBeLessThanOrEqual(height + 1e-8);
      expect(view.height).toBeGreaterThanOrEqual(.28 - 1e-8);
      height = view.height;
    }
    expect(height).toBeCloseTo(.28);
    expect(deathView(2, 1.6256)).toEqual(deathView(3, 1.6256));
    expect(deathView(PLAYER_COLLAPSE_SECONDS, 1.6256).height).toBeCloseTo(.28);
    const early=1.6256-deathView(.1,1.6256).height;
    const later=deathView(.2,1.6256).height-deathView(.3,1.6256).height;
    expect(later).toBeGreaterThan(early*3);
    expect(deathView(.4,1.6256).height).toBeCloseTo(.28);
    expect(deathView(.12, 1.6256).weaponDrop).toBe(1);
  });
  it('reacts promptly to headshots and normalizes shot direction independently of world support', () => {
    const hit={direction:{x:1,y:0,z:0},yaw:0,headshot:true};
    const head=deathView(.04,1.6256,hit),body=deathView(.04,1.6256,{...hit,headshot:false});
    expect(head.height).toBeLessThan(body.height);expect(head.roll).toBeGreaterThan(body.roll);
    expect(deathView(.1,1.6256,{...hit,direction:{x:-1,y:0,z:0}}).roll).toBeCloseTo(-deathView(.1,1.6256,hit).roll);
    expect(deathView(.1,1.6256,{...hit,direction:{x:20,y:0,z:0}})).toEqual(deathView(.1,1.6256,hit));
    expect(deathView(.1,1.6256,{...hit,yaw:Math.PI/2,direction:{x:0,y:0,z:-1}}).roll).toBeCloseTo(deathView(.1,1.6256,hit).roll);
    expect(deathView(.04,1.6256,{...hit,direction:{x:0,y:0,z:1}}).pitch).toBeGreaterThan(
      deathView(.04,1.6256,{...hit,direction:{x:0,y:0,z:-1}}).pitch);
    expect(deathView(.5,1.6256,hit)).toEqual(deathView(4,1.6256,hit));
  });
  it('is finite, absolute-time and bounded for crouch, zero direction and invalid inputs', () => {
    const hit={direction:{x:0,y:0,z:0},yaw:0,headshot:true};
    for(const eye of [.28,.9,1.6256])for(const time of [0,.04,.2,.5,2]) {
      const view=deathView(time,eye,hit);
      expect(view.height).toBeGreaterThanOrEqual(.28-1e-8);expect(view.height).toBeLessThanOrEqual(eye);
      expect(Object.values(view).every(Number.isFinite)).toBe(true);
      expect(deathView(time,eye,hit)).toEqual(view);
    }
    expect(deathView(.2,.9).height).toBeLessThan(deathView(.2,1.6256).height);
    expect(deathView(NaN,NaN,{...hit,yaw:NaN})).toEqual(deathView(0,1.6256));
    expect(deathView(-1,1.6256)).toEqual(deathView(0,1.6256));
  });
  it('settles dead bodies and the player camera on cover instead of falling through it', () => {
    const cover = [{center: {x: 0, y: .5, z: 0}, size: {x: 2, y: 1, z: 2}}];
    const actor = {position: {x: 0, y: 2.6256, z: 0}, feet: 1};
    expect(deathFeet(actor, 3, cover)).toBe(1);
    expect(deathFeet({...actor, feet: 2}, .1, cover)).toBeGreaterThan(1);
    expect(deathFeet({...actor, feet: 2}, 3, cover)).toBe(1);
    expect(deathFeet({...actor, position: {x: 4, y: 3, z: 0}}, 3, cover)).toBe(0);
    expect(deathFeet({...actor, feet: 0}, 3, cover)).toBe(0);
  });
  it('retains the vertical momentum of a victim killed during a jump', () => {
    const actor = {position: {x: 0, y: 2.2256, z: 0}, feet: .6};
    expect(deathFeet(actor, .1, [], 4)).toBeCloseTo(.6 + .4 - .1016);
    expect(deathFeet(actor, 2, [], 4)).toBe(0);
    expect(deathFeet(actor, .1, [], -2)).toBeLessThan(deathFeet(actor, .1, []));
  });
});
