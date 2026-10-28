import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {NativeMapCollision} from './native-collision';
import {settleNativePosition} from './map';
import {prefireRoutes, sourcePoint} from './routes';
import {BoxGeometry} from 'three';
import type {NativeCollisionManifest} from './native-collision';
import {advanceActor, idleInput, STEP, UNIT, type ActorKinematics} from '../actor-physics';
import {moveOnTerrain, verticalContact} from '../actor-collision';
import {DuelWeaponState} from '../duel/weapon-state';
import {idleCommand} from '../duel/types';

describe('native scene queries without installed game assets', () => {
  const build = (geometryOverride?: BoxGeometry[]) => {
    const geometries = geometryOverride ?? [new BoxGeometry(20, .2, 20).translate(0, -.1, 0),
      new BoxGeometry(.2, 4, 10).translate(3, 2, 0), new BoxGeometry(.2, 4, 10).translate(-3, 2, 0)];
    const groups: NativeCollisionManifest['groups'] = [];
    const buffers: Buffer[] = []; let offset = 0;
    geometries.forEach((geometry, id) => {
      const vertices = new Float32Array(geometry.getAttribute('position').array), indices = new Uint32Array(geometry.getIndex()!.array);
      groups.push({id, offset, vertexCount: vertices.length / 3, indexCount: indices.length, movement: id !== 2, shots: id !== 1});
      buffers.push(Buffer.from(vertices.buffer), Buffer.from(indices.buffer)); offset += vertices.byteLength + indices.byteLength;
      geometry.dispose();
    });
    const bytes = Buffer.concat(buffers), binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const manifest: NativeCollisionManifest = {version: 1, unit: .0254, build: 'fixture', collisionSha256: '', groups};
    return {manifest, binary};
  };
  it('preserves shot/passbullet/player-clip masks and native-size actor clearance', async () => {
    const {manifest, binary} = build(), collision = await NativeMapCollision.create(manifest, binary);
    try {
      const support = collision.vertical({x: 0, y: 0, z: 0}, 1, -1, 72 * .0254);
      expect(support.grounded).toBe(true); expect(Math.abs(support.feet)).toBeLessThan(.002);
      const p = {x: 0, y: support.feet, z: 0};
      expect(collision.fits(p, p.y, 72 * .0254)).toBe(true);
      expect(collision.sweep(p, {...p, x: 5}, 72 * .0254).position.x).toBeCloseTo(2.9 - 16 * .0254, 2);
      expect(collision.sweep(p, {...p, x: -5}, 72 * .0254).fraction).toBe(1);
      expect(collision.ray({...p, y: 1}, {x: 1, y: 0, z: 0}, 5)).toBeUndefined();
      expect(collision.ray({...p, y: 1}, {x: -1, y: 0, z: 0}, 5)?.distance).toBeCloseTo(2.9, 3);
    } finally {collision.dispose();}
  });
  it('rejects corrupt and nonfinite geometry before allocating a physics world', async () => {
    const {manifest, binary} = build();
    await expect(NativeMapCollision.create({...manifest, unit: 1}, binary)).rejects.toThrow('Unsupported map units');
    await expect(NativeMapCollision.create({...manifest, groups: [{...manifest.groups[0], indexCount: -3}]}, binary)).rejects.toThrow('Invalid map collision buffer');
    new Float32Array(binary)[0] = NaN;
    await expect(NativeMapCollision.create(manifest, binary)).rejects.toThrow('Invalid map collision geometry');
  });
  it('separates native grenade masks from player clips and keeps them after snapshot restoration',async()=>{
    const {manifest,binary}=build();manifest.groups[1].tags=['playerclip'];
    const original=await NativeMapCollision.create(manifest,binary),prepared=original.exportPrepared();
    const restored=await NativeMapCollision.create(manifest,binary,{metadata:prepared.metadata,snapshot:prepared.snapshot.slice().buffer as ArrayBuffer});
    try{for(const collision of [original,restored]){
      const from={x:0,y:1,z:0};
      expect(collision.sweepSphere(from,{...from,x:5},.0508).fraction).toBeLessThan(1);
      expect(collision.sweepGrenade(from,{...from,x:5},.0508).fraction).toBe(1);
      expect(collision.sweepGrenade(from,{...from,x:-5},.0508).fraction).toBeLessThan(1);
      expect(collision.ray(from,{x:-1,y:0,z:0},5)?.distance).toBeCloseTo(2.9,3);
    }}finally{original.dispose();restored.dispose();}
  });
  it('copies only nearby movement triangles for corpse contact without changing live collision', async () => {
    const {manifest, binary} = build(), collision = await NativeMapCollision.create(manifest, binary);
    try {
      const copy = collision.corpseGeometry({x: 0, y: 0, z: 0}, 4);
      expect(copy.indices.length).toBeGreaterThan(0);
      const triangles = Array.from({length: copy.indices.length / 3}, (_, t) => [0, 1, 2].map(i => copy.vertices[copy.indices[t * 3 + i] * 3]));
      expect(triangles.some(xs => xs.every(x => x < -2.8 && x > -3.2))).toBe(false); // Shot-only left wall.
      expect(triangles.some(xs => xs.every(x => x > 2.8 && x < 3.2))).toBe(true); // Movement-only right wall.
      expect(Array.from({length: copy.indices.length / 3}, (_, t) => [0, 1, 2].map(i => copy.indices[t * 3 + i] * 3))
        .some(points => points.every(i => Math.abs(copy.vertices[i] - 2.9) < .01) &&
          Math.max(...points.map(i => copy.vertices[i + 1])) - Math.min(...points.map(i => copy.vertices[i + 1])) > 1)).toBe(true);
      expect(collision.corpseGeometry({x: .1, y: .1, z: .1}, 4)).toBe(copy);
      expect(collision.corpseGeometry({x: 100, y: 100, z: 100}, 2).indices).toHaveLength(0);
      expect(collision.sweep({x: 0, y: 0, z: 0}, {x: 5, y: 0, z: 0}, 72 * UNIT).fraction).toBeLessThan(1);
    } finally {collision.dispose();}
    expect(collision.corpseGeometry({x: 0, y: 0, z: 0}, 4).indices).toHaveLength(0);
  });
  it('preserves exact support, clipping and shot masks with baked query indexes and a restored world',async()=>{
    const {manifest,binary}=build(),original=await NativeMapCollision.create(manifest,binary);
    const prepared=original.exportPrepared(),snapshot=prepared.snapshot.slice().buffer as ArrayBuffer;
    const cached=await NativeMapCollision.create(manifest,binary,{metadata:prepared.metadata});
    const restored=await NativeMapCollision.create(manifest,binary,{metadata:prepared.metadata,snapshot});
    try {
      for(const map of [cached,restored])for(const x of [-2.5,0,2.5])for(const z of [-4,0,4]) {
        const p={x,y:0,z};
        expect(map.vertical(p,1,-1,72*UNIT)).toEqual(original.vertical(p,1,-1,72*UNIT));
        expect(map.sweep(p,{...p,x:x+4},72*UNIT)).toEqual(original.sweep(p,{...p,x:x+4},72*UNIT));
        expect(map.ray({...p,y:1},{x:-1,y:0,z:0},8)).toEqual(original.ray({...p,y:1},{x:-1,y:0,z:0},8));
      }
    }finally{original.dispose();cached.dispose();restored.dispose();}
  });
  it('stops upward jumps against native undersides instead of treating every face as a floor', async () => {
    const {manifest, binary} = build([new BoxGeometry(8, .2, 8).translate(0, -.1, 0), new BoxGeometry(8, .2, 8).translate(0, 2.2, 0)]);
    const collision = await NativeMapCollision.create(manifest, binary);
    try {
      const height = 72 * UNIT, p = {x: 0, y: 0, z: 0};
      const contact = collision.vertical(p, 0, 1, height);
      expect(contact.ceiling).toBe(true);
      expect(contact.grounded).toBe(false);
      expect(contact.feet).toBeCloseTo(2.1 - height, 5);
      expect(contact.normal?.y).toBe(-1);
    } finally {collision.dispose();}
  });
  it('matches the shared ground acceleration and supports jumping and airborne crouching', async () => {
    const {manifest, binary} = build(), collision = await NativeMapCollision.create(manifest, binary);
    const actor = (): ActorKinematics => ({position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0,
      feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true});
    const native = {solids: [], floor: null, native: collision}, flat = {solids: [], floor: 0};
    try {
      let actual = actor(), reference = actor();
      for (let tick = 0; tick < 64; tick++) {
        const input = {...idleInput(), forward: 1};
        const support = collision.vertical(actual.position, actual.feet, actual.feet - 1e-7, 72 * UNIT);
        actual = advanceActor(actual, input, 250 * UNIT, STEP, undefined, undefined, undefined, native);
        reference = advanceActor(reference, input, 250 * UNIT, STEP, undefined, undefined, undefined, flat);
        expect(actual.grounded, JSON.stringify({tick, support, actual})).toBe(true);
      }
      expect(Math.hypot(actual.velocity.x, actual.velocity.z)).toBeCloseTo(Math.hypot(reference.velocity.x, reference.velocity.z), 4);
      expect(Math.hypot(actual.velocity.x, actual.velocity.z)).toBeGreaterThan(240 * UNIT);
      expect(actual.position.z).toBeCloseTo(reference.position.z, 4);
      actual = actor(); reference = actor();
      for (let tick = 0; tick < 36; tick++) {
        const input = {...idleInput(), jump: tick === 0, jumpPressed: tick === 0, crouch: tick >= 8};
        actual = advanceActor(actual, input, 250 * UNIT, STEP, undefined, undefined, undefined, native);
        reference = advanceActor(reference, input, 250 * UNIT, STEP, undefined, undefined, undefined, flat);
        if (tick === 0) expect(actual.verticalVelocity).toBeGreaterThan(7);
        expect(actual.feet).toBeCloseTo(reference.feet, 3);
        expect(actual.eyeHeight).toBeCloseTo(reference.eyeHeight, 4);
      }
    } finally {collision.dispose();}
  });
  it('retains nonwalkable native contacts rather than discarding the collision', () => {
    const native = {fits: () => true, sweep: (from: any, to: any) => ({position: to, fraction: 1, startSolid: false}),
      vertical: () => ({feet: .904, grounded: false, ceiling: false, normal: {x: .866, y: .5, z: 0}})};
    expect(verticalContact({x: 0, y: 1, z: 0}, 1, -10, 1.8, [], null, native).feet).toBe(.904);
  });
  it('keeps the native seam ground stable through crouch transitions at world-scale coordinates', async () => {
    const {manifest, binary} = build([new BoxGeometry(8, .2, 8).rotateZ(.035).translate(42, -3, -54)]);
    const collision = await NativeMapCollision.create(manifest, binary);
    try {
      const p = {x: 42, y: -2, z: -54};
      const support = collision.vertical(p, -2, -4, 72 * UNIT);
      expect(support.grounded).toBe(true);
      let a: ActorKinematics = {position: {...p, y: support.feet + 64 * UNIT}, feet: support.feet, eyeHeight: 64 * UNIT,
        velocity: {x: 0, z: 0}, yaw: 0, verticalVelocity: 0, jumpHeld: false, grounded: true};
      for (let tick = 0; tick < 256; tick++) {
        a = advanceActor(a, {...idleInput(), crouch: tick >= 32 && tick < 160}, 215 * UNIT, STEP,
          undefined, undefined, undefined, {solids: [], floor: null, native: collision});
        expect(a.grounded, `airborne during native crouch tick ${tick}`).toBe(true);
        expect(a.feet).toBeCloseTo(support.feet, 10);
      }
      expect(a.duckAmount).toBe(0);
    } finally {collision.dispose();}
  });
  it.each([-.18, -.035, .035, .18])('keeps running momentum on a native %s-radian slope', async tilt => {
    const {manifest, binary} = build([new BoxGeometry(16, .2, 8).rotateZ(tilt).translate(42, -3, -54)]);
    const collision = await NativeMapCollision.create(manifest, binary);
    try {
      const p = {x: 40, y: -2, z: -54}, floor = collision.vertical(p, 0, -6, 72 * UNIT).feet;
      let a: ActorKinematics = {position: {...p, y: floor + 64 * UNIT}, feet: floor, eyeHeight: 64 * UNIT,
        velocity: {x: 0, z: 0}, yaw: 0, verticalVelocity: 0, jumpHeld: false, grounded: true};
      let reference = {...a};
      for (let tick = 0; tick < 128; tick++) {
        const input = {...idleInput(), side: 1};
        const before = a;
        a = advanceActor(a, input, 215 * UNIT, STEP, undefined, undefined, undefined,
          {solids: [], floor: null, native: collision});
        reference = advanceActor(reference, input, 215 * UNIT, STEP, undefined, undefined, undefined,
          {solids: [], floor});
        const from = {...before.position, y: before.feet};
        const detail = JSON.stringify({tick, before, a, move: moveOnTerrain(from, {...from, x: from.x + reference.velocity.x * STEP},
          72 * UNIT, {solids: [], floor: null, native: collision}, true)});
        expect(a.grounded, detail).toBe(true);
        expect(a.position.x, detail).toBeCloseTo(reference.position.x, 3);
        expect(a.velocity.x).toBeCloseTo(reference.velocity.x, 5);
        expect(a.verticalVelocity).toBe(0);
      }
    } finally {collision.dispose();}
  });
  it('slides along a native wall without losing its tangent momentum at mesh seams', async () => {
    const {manifest, binary} = build([new BoxGeometry(30, .2, 30).translate(0, -.1, 0),
      new BoxGeometry(.2, 4, 20).translate(2, 2, 0)]);
    const collision = await NativeMapCollision.create(manifest, binary);
    try {
      let a: ActorKinematics = {position: {x: 1.49, y: 64 * UNIT, z: 5}, feet: 0, eyeHeight: 64 * UNIT,
        velocity: {x: 0, z: 0}, yaw: 0, verticalVelocity: 0, jumpHeld: false, grounded: true};
      for (let tick = 0; tick < 160; tick++) {
        a = advanceActor(a, {...idleInput(), forward: 1, side: 1}, 215 * UNIT, STEP,
          undefined, undefined, undefined, {solids: [], floor: null, native: collision});
        expect(a.grounded).toBe(true);
        expect(a.position.x).toBeLessThanOrEqual(1.9 - 16 * UNIT + .001);
        if (tick > 48) expect(-a.velocity.z).toBeGreaterThan(3);
      }
      expect(a.position.z).toBeLessThan(1);
    } finally {collision.dispose();}
  });
  it.each([18, 19])('respects the shared 18u limit at a native %iu stair', async units => {
    const rise = units * UNIT;
    const {manifest, binary} = build([new BoxGeometry(30, .2, 30).translate(0, -.1, 0),
      new BoxGeometry(4, rise, 8).translate(3, rise / 2, 0)]);
    const collision = await NativeMapCollision.create(manifest, binary);
    try {
      let a: ActorKinematics = {position: {x: -1, y: 64 * UNIT, z: 0}, feet: 0, eyeHeight: 64 * UNIT,
        velocity: {x: 0, z: 0}, yaw: 0, verticalVelocity: 0, jumpHeld: false, grounded: true};
      for (let tick = 0; tick < 96; tick++) {
        a = advanceActor(a, {...idleInput(), side: 1}, 215 * UNIT, STEP,
          undefined, undefined, undefined, {solids: [], floor: null, native: collision});
        expect(a.grounded, `stair ${units}u tick ${tick}`).toBe(true);
      }
      if (units === 18) {
        expect(a.position.x).toBeGreaterThan(2);
        expect(a.feet).toBeCloseTo(rise, 6);
      } else {
        expect(a.position.x).toBeLessThan(.6);
        expect(a.feet).toBeCloseTo(0, 6);
      }
    } finally {collision.dispose();}
  });
  it('supports partial footprint overlap without extending a triangle beyond its edge', async () => {
    const {manifest, binary} = build([new BoxGeometry(1, .2, 1).translate(0, -.1, 0)]);
    const collision = await NativeMapCollision.create(manifest, binary);
    try {
      expect(collision.vertical({x: .6, y: 1, z: .6}, 1, -1, 72 * UNIT).grounded).toBe(true);
      expect(collision.vertical({x: .91, y: 1, z: .91}, 1, -1, 72 * UNIT).grounded).toBe(false);
      expect(collision.vertical({x: 0, y: -3, z: 0}, -3, -1, 72 * UNIT).feet).toBeCloseTo(-.2 - 72 * UNIT, 6);
    } finally {collision.dispose();}
  });
  it('does not turn an underside into walkable support for an embedded spawn', async () => {
    const {manifest, binary} = build([new BoxGeometry(8, 4, 8).translate(0, 2, 0)]);
    const collision = await NativeMapCollision.create(manifest, binary);
    try {
      expect(collision.vertical({x: 0, y: 1, z: 0}, 1, -1, 72 * UNIT).grounded).toBe(false);
      expect(collision.vertical({x: 0, y: 5, z: 0}, 5, 3, 72 * UNIT).feet).toBe(4);
    } finally {collision.dispose();}
  });
  it('makes repeated disposal and stale HMR queries safe without touching freed native memory', async () => {
    const {manifest, binary} = build(), collision = await NativeMapCollision.create(manifest, binary);
    collision.dispose();
    expect(() => collision.dispose()).not.toThrow();
    const p = {x: 0, y: 0, z: 0};
    expect(collision.sweep(p, {...p, x: 1}, 72 * UNIT)).toEqual({position: p, fraction: 0, startSolid: true});
    expect(collision.fits(p, 0, 72 * UNIT)).toBe(false);
    expect(collision.vertical(p, 0, -1, 72 * UNIT)).toEqual({feet: 0, grounded: false, ceiling: false});
    expect(collision.ray(p, {x: 1, y: 0, z: 0}, 10)).toBeUndefined();
    expect(collision.floorAt(0, 0)).toBeUndefined();
  });
});

describe('native map coordinate contract', () => {
  it('preserves Source units and handedness without height normalization', () => {
    expect(sourcePoint([100, 200, -120])).toEqual({x: 2.54, y: -3.048, z: -5.08});
    expect(new Set(prefireRoutes.map(route => route.id)).size).toBe(10);
    for (const route of prefireRoutes) expect(route.angles.length).toBeLessThanOrEqual(5);
  });
});

describe.skipIf(!existsSync('public/revamp/maps/dust2/collision.bin'))('installed Dust 2 collision', () => {
  let collision: NativeMapCollision;
  beforeAll(async () => {
    const bytes = readFileSync('public/revamp/maps/dust2/collision.bin');
    collision = await NativeMapCollision.create(JSON.parse(readFileSync('public/revamp/maps/dust2/collision.json', 'utf8')),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }, 30000);
  afterAll(() => collision?.dispose());
  it('keeps support while pushing into beveled Mid boxes instead of repeatedly landing', () => {
    for (const [x,y,yaw] of [[-340,1296,0],[-468,1232,0],[-340,1424,Math.PI]] as const) {
      const p = {x:x*UNIT,y:0,z:-y*UNIT};
      p.y = collision.vertical(p,128*UNIT,-160*UNIT,72*UNIT).feet;
      expect(collision.fits(p,p.y,72*UNIT)).toBe(true);
      let actor: ActorKinematics = {position:{...p,y:p.y+64*UNIT},feet:p.y,velocity:{x:0,z:0},
        yaw,eyeHeight:64*UNIT,verticalVelocity:0,grounded:true,jumpHeld:false};
      let landings = 0;
      for (let tick=0;tick<512;tick++) {
        const previous = actor;
        actor = advanceActor(actor,{...idleInput(),forward:1},215*UNIT,STEP,undefined,undefined,undefined,
          {solids:[],floor:null,native:collision});
        if (!previous.grounded && actor.grounded) landings++;
      }
      expect(landings,`${x},${y}`).toBeLessThanOrEqual(1);
    }
  });
  it('matches shared running release and counterstrafe braking on a clear native lane', () => {
    const p = settleNativePosition(collision, [1250, 1000, 0]);
    expect(collision.sweep(p, {...p, z: p.z - 4}, 72 * UNIT).fraction).toBe(1);
    expect(collision.sweep(p, {...p, z: p.z + 1}, 72 * UNIT).fraction).toBe(1);
    const initial: ActorKinematics = {position: {...p, y: p.y + 64 * UNIT}, velocity: {x: 0, z: -215 * UNIT}, yaw: 0,
      feet: p.y, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true};
    let actual = initial, reference = initial;
    for (let tick = 0; tick < 24; tick++) {
      const input = {...idleInput(), forward: tick >= 4 ? -1 : 0};
      actual = advanceActor(actual, input, 215 * UNIT, STEP, undefined, undefined, undefined,
        {solids: [], floor: null, native: collision});
      reference = advanceActor(reference, input, 215 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: p.y});
      expect(actual.grounded).toBe(true);
      expect(actual.velocity.x).toBeCloseTo(reference.velocity.x, 10);
      expect(actual.velocity.z).toBeCloseTo(reference.velocity.z, 10);
      expect(actual.position.z).toBeCloseTo(reference.position.z, 9);
    }
  });
  it('keeps installed-map grounding and weapon accuracy identical to the flat core while crouching', () => {
    // Independent of route authoring: native seams that previously produced
    // false air flags and 6-14 unit camera/feet jumps during stationary ducking.
    for (const point of [[900, 910, 0], [1250, 1000, 0], [380, 1390, 0], [-1400, 2190, 1],
      [-1540, 2290, -2], [-395, 1460, -126], [180, 2180, -125]] as const) {
      const p = settleNativePosition(collision, point);
      const initial: ActorKinematics = {position: {...p, y: p.y + 64 * UNIT}, velocity: {x: 0, z: 0}, yaw: 0,
        feet: p.y, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true};
      let actual = initial, reference = initial;
      const gun = new DuelWeaponState('ak47', () => .5), referenceGun = new DuelWeaponState('ak47', () => .5);
      for (let tick = 0; tick < 256; tick++) {
        const input = {...idleInput(), crouch: tick >= 64 && tick < 160};
        actual = advanceActor(actual, input, 215 * UNIT, STEP, undefined, undefined, undefined,
          {solids: [], floor: null, native: collision});
        reference = advanceActor(reference, input, 215 * UNIT, STEP, undefined, undefined, undefined, {solids: [], floor: p.y});
        const command = {...idleCommand(), crouch: input.crouch, firePressed: tick % 24 === 0};
        const shot = gun.advance(tick * STEP, STEP, command, {...actual, pitch: .08});
        const referenceShot = referenceGun.advance(tick * STEP, STEP, command, {...reference, pitch: .08});
        expect(actual.grounded, `${point.join(',')} tick ${tick}`).toBe(true);
        expect(actual.feet).toBeCloseTo(p.y, 10);
        expect(actual.eyeHeight).toBeCloseTo(reference.eyeHeight, 10);
        expect(gun.recovery.penalty).toBe(referenceGun.recovery.penalty);
        expect(shot?.direction).toEqual(referenceShot?.direction);
        expect(shot?.ordinal).toBe(referenceShot?.ordinal);
      }
    }
  });
  it('rejects a blocked source point rather than moving it silently into an adjacent space', () => {
    expect(() => settleNativePosition(collision, [348, 1390, 8])).toThrow('does not fit');
  });
  // Exact authored-route clearance and standing/crouched head visibility are
  // covered by routes.test.ts, without relocating targets to fit a 72u hull.
});
