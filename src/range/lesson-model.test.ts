import {describe, expect, it} from 'vitest';
import {STEP} from './actor-physics';
import {MovementLesson, demonstrationInput, demonstrationLesson} from './lesson-model';

describe('completed lesson snapshots', () => {
  it.each([0, 1, 2])('keeps lesson %s display and feedback unchanged while braking continues', lesson => {
    const model = demonstrationLesson(lesson);
    for (let i = 0; i < 128 && !model.complete; i++) {
      model.update(STEP, demonstrationInput(model));
      if (model.time > .4 && model.settled && model.aligned) model.shoot();
    }
    expect(model.complete).toBe(true);
    const snapshot = {...model.snapshot}, message = model.message, shotSpeed = model.shotSpeed;
    for (let i = 0; i < 256; i++) model.update(STEP, i % 2 ? 1 : -1);
    model.shoot();
    expect(model.snapshot).toEqual(snapshot);
    expect(model.message).toBe(message); expect(model.shotSpeed).toBe(shotSpeed);
    expect(Math.abs(model.velocity)).toBe(0);
  });
});

describe('manual lesson attempts', () => {
  it('offers a retry after coasting instead of asking for an unavailable shot in lesson one', () => {
    const model = new MovementLesson(0);
    for (let i = 0; i < 45; i++) model.update(STEP, 1);
    for (let i = 0; i < 128; i++) model.update(STEP, 0);
    expect(model.complete).toBe(false);
    expect(model.message).toContain('Hold D to build speed again');
    expect(model.message).not.toMatch(/fire|shoot/);
  });

  it.each([1, 2])('can complete lesson %s with the default start position and manual inputs', lesson => {
    const model = new MovementLesson(lesson);
    for (let i = 0; i < 40; i++) model.update(STEP, 1);
    for (let i = 0; i < 10; i++) model.update(STEP, -1);
    model.shoot();
    expect(model.complete).toBe(true);
  });
});
