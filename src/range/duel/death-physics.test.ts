import {describe, expect, it} from 'vitest';
import {DeathPhysics} from './death-physics';

describe('cosmetic skeletal contact solver', () => {
  it('follows bounded native-derived drive samples while preserving contacts and fixed-step determinism', () => {
    const bodies=[{name:'head',position:{x:0,y:1.6,z:0},radius:.12}];
    const drive={frames:[{time:0,positions:[{x:0,y:1.6,z:0}]},
      {time:.4,positions:[{x:.4,y:.5,z:0}]},{time:.8,positions:[{x:.7,y:-1,z:0}]}]};
    const a=new DeathPhysics(bodies,[],undefined,drive),b=new DeathPhysics(bodies,[],undefined,drive);
    for(let n=0;n<60;n++)a.step(1/60);
    for(let n=0;n<240;n++)b.step(1/240);
    expect([...a.positions]).toEqual([...b.positions]);
    expect(a.point('head')!.y).toBeGreaterThanOrEqual(.12);
    expect(a.point('head')!.x).toBeGreaterThan(.3);
    expect(drive.frames[2].positions[0].y).toBe(-1);
    expect(()=>new DeathPhysics(bodies,[],undefined,{frames:[]})).toThrow(/pose drive/);
    expect(()=>new DeathPhysics(bodies,[],undefined,{frames:[drive.frames[1],drive.frames[0]]})).toThrow(/pose drive/);
  });
  it('uses the shared native 800-unit gravity, not Earth gravity', () => {
    const rag = new DeathPhysics([{name: 'head', position: {x: 0, y: 2, z: 0}, radius: .12}], []);
    rag.step(1 / 120); expect(rag.point('head')!.y).toBeCloseTo(2 - 800 * .0254 / 120 ** 2, 10);
  });
  it('settles against the floor without penetrating and freezes the solved pose', () => {
    const rag = new DeathPhysics([{name: 'head', position: {x: 0, y: 2, z: 0}, radius: .12} ], []);
    const contacts = [];
    for (let n = 0; n < 600; n++) contacts.push(...rag.step(1 / 60));
    expect(rag.point('head')!.y).toBeCloseTo(.12); expect(rag.sleeping).toBe(true);
    expect(contacts.length).toBeGreaterThan(0); expect(contacts.length).toBeLessThan(8);
    expect(contacts[0].point.y).toBeCloseTo(0); expect(contacts[0].normal).toEqual({x: 0, y: 1, z: 0});
    const final = [...rag.positions]; rag.step(5); expect([...rag.positions]).toEqual(final);
  });
  it('lands on arbitrary prop tops and sweeps thin side walls', () => {
    const world = {boxes: [{center: {x: 0, y: .5, z: 0}, size: {x: 3, y: 1, z: 3}}]};
    const rag = new DeathPhysics([{name: 'hip', position: {x: 0, y: 3, z: 0}, radius: .12}], []);
    for (let n = 0; n < 300; n++) rag.step(1 / 60, world);
    expect(rag.point('hip')!.y).toBeCloseTo(1.12);
    const moving = new DeathPhysics([{name: 'hip', position: {x: -.3, y: 1, z: 0}, radius: .04}], [], {x: 8, y: 0, z: 0});
    const walls = [];
    for (let n = 0; n < 10; n++) walls.push(...moving.step(1 / 120, {boxes: [{center: {x: 0, y: 1, z: 0}, size: {x: .01, y: 5, z: 5}}]}));
    expect(moving.point('hip')!.x).toBeLessThanOrEqual(-.045 + 1e-8);
    expect(walls[0].solid).toBe(0); expect(walls[0].point.x).toBeCloseTo(-.005);
    expect(walls[0].normal.x).toBe(-1);
  });
  it('preserves link lengths, is deterministic across render rates, and does not mutate initial poses', () => {
    const bodies = [{name: 'hip', position: {x: 0, y: 2, z: 0}, radius: .12},
      {name: 'head', position: {x: 0, y: 2.7, z: .05}, radius: .12}];
    const links = [{a: 'hip', b: 'head'}];
    const a = new DeathPhysics(bodies, links), b = new DeathPhysics(bodies, links);
    a.impulse('head', {x: 2, y: -.5, z: 1}); b.impulse('head', {x: 2, y: -.5, z: 1});
    for (let n = 0; n < 120; n++) a.step(1 / 60);
    for (let n = 0; n < 240; n++) b.step(1 / 120);
    expect([...a.positions]).toEqual([...b.positions]); expect(bodies[0].position.y).toBe(2);
    const hip = a.point('hip')!, head = a.point('head')!;
    expect(Math.hypot(head.x - hip.x, head.y - hip.y, head.z - hip.z)).toBeCloseTo(Math.hypot(.7, .05), 2);
  });
  it('bounds catch-up after pauses and rejects invalid or oversized skeletons', () => {
    const a = new DeathPhysics([{name: 'hip', position: {x: 0, y: 2, z: 0}, radius: .1}], []);
    a.step(Infinity); a.step(NaN); expect(a.point('hip')!.y).toBe(2);
    a.step(100); expect(a.point('hip')!.y).toBeGreaterThan(1.9);
    expect(() => new DeathPhysics([{name: 'hip', position: {x: NaN, y: 0, z: 0}, radius: .1}], [])).toThrow();
    expect(() => new DeathPhysics(Array.from({length: 25}, (_, i) => ({name: String(i), position: {x: 0, y: 1, z: 0}, radius: .1})), [])).toThrow();
    expect(() => new DeathPhysics(a.bodies, [{a: 'hip', b: 'missing'}])).toThrow();
  });
  it('uses native-map contact instead of an imaginary y=0 floor, then sleeps without more queries',()=>{
    let queries=0;
    const rag=new DeathPhysics([{name:'head',position:{x:1,y:0,z:2},radius:.12}],[]);
    const world={floor:-1000,sweepSphere:(from:{x:number;y:number;z:number},to:{x:number;y:number;z:number},radius:number)=>{
      queries++;const floor=-2+radius;
      if(to.y>=floor)return {position:{...to},fraction:1,startSolid:false};
      const fraction=Math.max(0,(from.y-floor)/(from.y-to.y));
      return {position:{...to,y:floor},fraction,contact:{normal:{x:0,y:1,z:0}},startSolid:false};
    }};
    const contacts=[];for(let n=0;n<300;n++)contacts.push(...rag.step(1/60,world));
    expect(rag.point('head')!.y).toBeCloseTo(-1.88);expect(rag.sleeping).toBe(true);
    expect(contacts.some(contact=>contact.solid===-2)).toBe(true);
    const count=queries;rag.step(1,world);expect(queries).toBe(count);
  });
});
