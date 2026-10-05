import {describe, expect, it, vi} from 'vitest';
import {BoostPlanner, TeamTacticsPlanner, type BoostPOI, type TacticalPeer, type TeamContact} from './coordination';
import type {CoverLane} from './geometry';

const peer = (id: number, x = id * 1.5): TacticalPeer => ({level: 8, actor: {
  id, generation: 1, side: 'enemy', position: {x, y: 1.62, z: -6}, feet: 0, grounded: true,
  velocity: {x: 0, z: 0}, yaw: Math.PI, pitch: 0, crouched: false, duckAmount: 0,
  health: 100, armor: 100, helmet: true, alive: true, equipment: 'ak47', ammo: 30, reloading: false,
}});
const lanes: CoverLane[] = [-1, 1].flatMap(side => ['entry', 'camp', 'offAngle'].map(role => ({
  side: side as -1 | 1, role: role as CoverLane['role'], axis: {x: side, z: 0},
  anchor: {x: side * 5, y: 0, z: -6}, edge: {x: side * 5.5, y: 0, z: -4},
  retreat: {x: side * 4, y: 0, z: -8},
})));
const contact = (observedAt = 0): TeamContact => ({reporterId: 1, point: {x: 6, y: 1.62, z: 6}, observedAt, source: 'sight'});
const poi: BoostPOI = {id: 'test-perch', base: {x: 0, y: 0, z: -6}, mount: {x: 1, y: 0, z: -6},
  perch: {x: 0, y: 1.2, z: -6}, dismount: {x: -2, y: 0, z: -6}, lookAt: {x: 4, y: 1.62, z: 5}};

describe('evidence-only allied tactics', () => {
  it('assigns a healthy entry, close trader, opposite crossfire, and sniper anchor deterministically', () => {
    const peers = [peer(1, 5), peer(2, 3.85), peer(3, -5), peer(4, -6)];
    peers[3].actor.equipment = 'awp';
    const assignments = new TeamTacticsPlanner().plan(0, peers, lanes, [contact()]);
    expect(assignments.find(a => a.actorId === 1)?.role).toBe('entry');
    expect(assignments.find(a => a.actorId === 2)?.role).toBe('trade');
    expect(assignments.find(a => a.actorId === 3)?.lane.side).toBe(-1);
    expect(assignments.find(a => a.actorId === 4)?.role).toBe('anchor');
    expect(assignments).toEqual(new TeamTacticsPlanner().plan(0, peers, lanes, [contact()]));
  });

  it('waits for a paired staging position and retains one release deadline across fresh reports', () => {
    const peers = [peer(1, 5), peer(2, 1)];
    const planner = new TeamTacticsPlanner();
    expect(planner.plan(0, peers, lanes, [contact()]).every(a => a.waitForPartner)).toBe(true);
    peers[1].actor.position.x = 3.85;
    const ready = planner.plan(.3, peers, lanes, [contact(.3)]);
    expect(ready.every(a => !a.waitForPartner)).toBe(true);
    const next = planner.plan(.6, peers, lanes, [contact(.6)]);
    expect(next.map(a => a.peekAt)).toEqual(ready.map(a => a.peekAt));
  });

  it('releases a close trade from an allied shot or known teammate death, not hidden enemy updates', () => {
    for (const down of [false, true]) {
      const peers = [peer(1, 5), peer(2, 3.85)], planner = new TeamTacticsPlanner();
      const first = planner.plan(0, peers, lanes, [contact()]);
      expect(first.find(a => a.role === 'trade')?.peekAt).toBeCloseTo(.32);
      if (down) {peers[0].actor.alive = false; peers[0].lastDownAt = .05;}
      else peers[0].lastShotAt = .05;
      const trade = planner.plan(.06, peers, lanes, [contact()]).find(a => a.role === 'trade');
      expect(trade?.peekAt).toBeCloseTo(.1);
      if (down) expect(planner.plan(.3, peers, lanes, [contact()])[0].role).toBe('trade');
    }
  });

  it('excludes novices, opponents, empty/reloading/busy allies and ignores future/expired reports', () => {
    const peers = [peer(1), peer(2), peer(3), peer(4), peer(5), peer(6), peer(7)];
    peers[1].level = 3; peers[2].actor.side = 'player'; peers[3].actor.ammo = 0;
    peers[4].actor.reloading = true; peers[5].busy = true;
    const planner = new TeamTacticsPlanner();
    expect(planner.plan(0, peers, lanes, [contact()]).map(a => a.actorId).sort()).toEqual([1, 7]);
    expect(planner.plan(.1, peers, lanes, [contact(1)])).toEqual([]);
    expect(planner.plan(3, peers, lanes, [contact()])).toEqual([]);
    expect(planner.plan(4, peers, [], [contact(4)])).toEqual([]);
  });

  it('removes invalid generations immediately and isolates caller-owned vectors', () => {
    const peers = [peer(1), peer(2)], report = contact(), planner = new TeamTacticsPlanner();
    const result = planner.plan(0, peers, lanes, [report]);
    report.point.x = 99; result[0].lane.anchor.x = 99;
    const next = planner.plan(.01, peers, lanes, [contact()]);
    expect(next[0].point.x).toBe(6); expect(next[0].lane.anchor.x).not.toBe(99);
    peers[1].actor.generation++;
    expect(planner.plan(.02, peers, lanes, [contact()]).some(a => a.actorId === 2)).toBe(false);
  });

  it('does not make an empty or fragile ally the entry when a healthy rifle is available', () => {
    const peers = [peer(1, 5), peer(2, 4), peer(3, 3)];
    peers[0].actor.health = 25; peers[0].actor.armor = 0; peers[2].actor.ammo = 0;
    const result = new TeamTacticsPlanner().plan(0, peers, lanes, [contact()]);
    expect(result.find(a => a.role === 'entry')?.actorId).toBe(2);
  });
});

describe('two-player boost input planning', () => {
  const pair = () => {const peers = [peer(1, 0), peer(2, 1)]; peers[0].actor.duckAmount = 1; return peers;};

  it('reserves disjoint participants, mounts with one jump edge, holds and releases', () => {
    const peers = pair(), planner = new BoostPlanner();
    const mount = planner.plan(0, peers, [poi], () => true)!;
    expect(mount.phase).toBe('mount');
    expect(mount.assignments.map(a => a.role)).toEqual(['base', 'climber']);
    expect(mount.commands.find(c => c.actorId === 2)?.command.jump).toBe(true);
    expect(planner.plan(.01, peers, [poi], () => true)?.commands.find(c => c.actorId === 2)?.command.jump).toBe(false);
    peers[1].actor.position.x = 0; peers[1].actor.feet = 1.2;
    expect(planner.plan(.5, peers, [poi], () => true)?.phase).toBe('hold');
    const release = planner.plan(3.1, peers, [poi], () => true)!;
    expect(release.phase).toBe('release');
    expect(release.assignments[1].goal).toEqual(poi.dismount);
    peers[1].actor.position.x = -2; peers[1].actor.feet = 0;
    expect(planner.plan(3.2, peers, [poi], () => true)).toBeNull();
    expect(planner.plan(3.3, peers, [poi], () => true)).toBeNull();
  });

  it('waits for real partner support, then issues exactly one second jump toward a raised perch', () => {
    const peers = pair(), planner = new BoostPlanner(), high = {...poi, perch: {...poi.perch, x: 1.5, y: 2}};
    const initial = planner.plan(0, peers, [high], () => true)!;
    expect(initial.mountStage).toBe('partner');
    expect(initial.assignments[1].goal.y).toBeCloseTo(54 * .0254);
    peers[1].actor.position.x = 0; peers[1].actor.feet = 54 * .0254;
    peers[1].actor.supportingActor = peers[0].actor.id;
    expect(planner.plan(.4, peers, [high], () => true)?.mountStage).toBe('partner');
    const second = planner.plan(.5, peers, [high], () => true)!;
    expect(second.mountStage).toBe('perch');
    expect(second.assignments[1].goal).toEqual(high.perch);
    expect(second.commands[1].command).toMatchObject({jump: false, walk: false});
    expect(planner.plan(.6, peers, [high], () => true)?.commands[1].command.jump).toBe(false);
    expect(planner.plan(.625, peers, [high], () => true)?.commands[1].command.jump).toBe(true);
    expect(planner.plan(.65, peers, [high], () => true)?.commands[1].command.jump).toBe(false);
    peers[1].actor.feet = 2; peers[1].actor.position.x = 1.5; peers[1].actor.supportingActor = undefined;
    expect(planner.plan(.9, peers, [high], () => true)?.phase).toBe('hold');
  });

  it.each(['contact', 'damage', 'death', 'reload', 'generation', 'support', 'poi'] as const)
  ('cancels immediately on %s and never mutates positions or velocity', reason => {
    const peers = pair(), planner = new BoostPlanner();
    expect(planner.plan(0, peers, [poi], () => true)).not.toBeNull();
    if (reason === 'contact') peers[0].contactAt = .1;
    if (reason === 'damage') peers[0].lastHurtAt = .1;
    if (reason === 'death') peers[0].actor.alive = false;
    if (reason === 'reload') peers[1].actor.reloading = true;
    if (reason === 'generation') peers[1].actor.generation++;
    if (reason === 'support') peers[0].actor.grounded = false;
    const before = JSON.stringify(peers);
    expect(planner.plan(.1, peers, reason === 'poi' ? [] : [poi], () => true)).toBeNull();
    expect(JSON.stringify(peers)).toBe(before);
  });

  it('fails closed for novices, ungrounded actors, impossible POIs, and rejected reachability', () => {
    const peers = pair(); peers[0].level = 3;
    expect(new BoostPlanner().plan(0, peers, [poi], () => true)).toBeNull();
    peers[0].level = 8; peers[0].actor.grounded = false;
    expect(new BoostPlanner().plan(0, peers, [poi], () => true)).toBeNull();
    peers[0].actor.grounded = true;
    expect(new BoostPlanner().plan(0, peers, [{...poi, perch: {...poi.perch, y: 99}}], () => true)).toBeNull();
    expect(new BoostPlanner().plan(0, peers, [poi], () => false)).toBeNull();
  });

  it('does not jump onto an elevated partner until the climber reaches the authored mount feet height', () => {
    const peers = pair(), planner = new BoostPlanner();
    const raised = {...poi, base: {...poi.base, y: .95}, mount: {...poi.mount, y: .95}, perch: {...poi.perch, y: 2.4}};
    peers[0].actor.feet = .95;
    const assembling = planner.plan(0, peers, [raised], () => true)!;
    expect(assembling.phase).toBe('assemble'); expect(assembling.commands[1].command.jump).toBe(false);
    peers[1].actor.feet = .95;
    expect(planner.plan(.1, peers, [raised], () => true)?.phase).toBe('mount');
  });

  it('permits a parent-validated loft above solo jump height using the shared jump model', () => {
    const result = new BoostPlanner().plan(0, pair(), [{...poi, perch: {...poi.perch, y: 2.4}}], () => true);
    expect(result?.phase).toBe('mount'); expect(result?.mountStage).toBe('partner');
  });

  it('times out failed mounts and throttles idle feasibility searches', () => {
    const planner = new BoostPlanner(), peers = pair(), feasible = vi.fn(() => false);
    for (let tick = 0; tick < 64; tick++) planner.plan(tick / 128, peers, [poi], feasible);
    expect(feasible).toHaveBeenCalledTimes(2);
    const mounted = new BoostPlanner();
    mounted.plan(0, peers, [poi], () => true);
    expect(mounted.plan(1.9, peers, [poi], () => true)).toBeNull();
  });

  it('copies POI inputs and exports only bounded keyboard-like motor commands', () => {
    const peers = pair(), planner = new BoostPlanner(), input = {...poi, lookAt: {...poi.lookAt}};
    const result = planner.plan(0, peers, [input], () => true)!;
    input.lookAt.x = 999; result.lookAt.x = 999;
    expect(planner.plan(.1, peers, [poi], () => true)?.lookAt.x).toBe(4);
    for (const {command} of result.commands) {
      expect(Math.hypot(command.forward ?? 0, command.side ?? 0)).toBeLessThanOrEqual(1.00001);
      expect(command.fireHeld).toBeUndefined(); expect(command.yawDelta).toBeUndefined();
    }
  });
});
