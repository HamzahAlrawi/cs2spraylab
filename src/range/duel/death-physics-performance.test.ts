import {describe, expect, it} from 'vitest';
import {DeathPhysics, type DeathBody, type DeathBox, type DeathContact} from './death-physics';
import {randomStream} from './rng';

const axes = ['x', 'y', 'z'] as const;
type Solver = {
  collide: (body: number, box: DeathBox, solid: number, contacts: DeathContact[]) => void;
  contact: (body: number, axis: number, value: number, solid: number, contacts: DeathContact[]) => void;
};

function referenceCollision(physics: DeathPhysics, box: DeathBox, contacts: DeathContact[]) {
  const radius = physics.bodies[0].radius;
  const min = axes.map(a => box.center[a] - box.size[a] / 2 - radius);
  const max = axes.map(a => box.center[a] + box.size[a] / 2 + radius);
  if (min.some((v, k) => physics.positions[k] >= max[k] || physics.positions[k] <= v)) return;
  let axis = 0, value = min[0], gap = Infinity;
  for (let k = 0; k < 3; k++) for (const edge of [min[k], max[k]]) {
    const distance = Math.abs(edge - physics.positions[k]);
    if (distance < gap) {axis = k; value = edge; gap = distance;}
  }
  (physics as unknown as Solver).contact(0, axis, value, 1, contacts);
}

describe('allocation-light corpse box contacts', () => {
  it('preserves the complete contact output and strict edge ties across 2000 seeded cases', () => {
    const random = randomStream(431, 'death-contact-parity');
    for (let sample = 0; sample < 2000; sample++) {
      const box: DeathBox = {center: {x: random() * 4 - 2, y: random() * 3, z: random() * 4 - 2},
        size: {x: .05 + random() * 4, y: .05 + random() * 3, z: .05 + random() * 4}};
      const body: DeathBody = {name: 'pelvis', radius: .03 + random() * .2,
        position: sample % 20 === 0 ? {...box.center} :
          {x: random() * 8 - 4, y: random() * 6 - 1, z: random() * 8 - 4}};
      if (sample % 20 === 1) body.position.x = box.center.x - box.size.x / 2 - body.radius;
      const velocity = {x: random() * 4 - 2, y: random() * 4 - 2, z: random() * 4 - 2};
      const fast = new DeathPhysics([body], [], velocity), reference = new DeathPhysics([body], [], velocity);
      const contacts: DeathContact[] = [], expected: DeathContact[] = [];
      (fast as unknown as Solver).collide(0, box, 1, contacts); referenceCollision(reference, box, expected);
      expect(Array.from(fast.positions)).toEqual(Array.from(reference.positions));
      expect(contacts).toEqual(expected);
    }
  });
});
