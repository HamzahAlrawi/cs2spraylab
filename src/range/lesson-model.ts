import {groundVelocity, UNIT} from './actor-physics';
import {gameData} from './config';

export class MovementLesson {
  x = -1.4; velocity = 0; peak = 0; time = 0; counterAt = -Infinity;
  complete = false; message = 'Hold D to move right.'; shots = 0; shotSpeed: number | null = null;
  snapshot: {x: number; velocity: number; aligned: boolean; settled: boolean} | null = null;
  readonly cap = gameData.weapons.m4a4.speed * UNIT;
  constructor(public lesson: number) {}
  get settled() {return Math.abs(this.velocity) <= this.cap * .34;}
  get visible() {return this.lesson < 2 || this.x > -.35;}
  get aligned() {return Math.abs(this.x) <= .3 && this.visible;}
  update(dt: number, input: number) {
    if (this.complete) input = 0;
    this.time += dt;
    if (input * this.velocity < -.5) this.counterAt = this.time;
    this.velocity = groundVelocity(this.velocity, 0, input, 0, this.cap, dt).x;
    this.x = Math.max(-5, Math.min(5, this.x + this.velocity * dt));
    if (Math.abs(this.x) === 5) this.velocity = 0;
    this.peak = Math.max(this.peak, Math.abs(this.velocity));
    if (this.complete) return;
    if (this.lesson === 0 && this.peak > this.cap * .65 && Math.abs(this.velocity) < 8 * UNIT && this.time - this.counterAt < .2) {
      this.finish('Counter-strafe complete: you used the opposite key to brake before shooting.');
    } else if (this.shots === 0) this.message = this.peak < this.cap * .65 ? 'Hold D to build sideways speed.'
      : !this.settled ? 'Release D, then briefly tap A to counter-strafe.'
      : this.lesson === 0 ? 'Stopped without completing the counter-strafe. Hold D to build speed again, then release D and briefly tap A.'
      : 'Stop complete. Put the crosshair on the head, then fire.';
  }
  shoot() {
    if (this.complete || this.lesson === 0) return;
    this.shots++;
    if (!this.visible) this.message = 'Still behind cover. Strafe farther right to clear the wall before taking the shot.';
    else if (!this.settled) this.message = 'Moving shot: counter-strafe before clicking. Release D, tap A and wait for the stop.';
    else if (!this.aligned) this.message = `The head is ${this.x < 0 ? 'right' : 'left'} of your crosshair. Use a small strafe to align it.`;
    else if (this.peak < this.cap * .65 || this.time - this.counterAt > 1.25) this.message = 'Hit, but this rep needs a counter-strafe. Build sideways speed, tap the opposite key to brake, then fire.';
    else {this.shotSpeed = Math.abs(this.velocity) / UNIT; this.finish(this.lesson === 1 ? 'Good crosshair placement and counter-strafe: first bullet connected.' : 'Clean peek: cleared the wall, counter-strafed and landed the first bullet.');}
  }
  private finish(message: string) {
    this.complete = true; this.message = message;
    this.snapshot = {x: this.x, velocity: this.velocity, aligned: this.aligned, settled: this.settled};
  }
}

// Start far enough left for this measured acceleration/braking sequence to finish on the head.
export function demonstrationLesson(lesson: number) {
  const probe = new MovementLesson(1); probe.x = 0;
  while (probe.time < .7) probe.update(1 / 128, demonstrationInput(probe));
  const result = new MovementLesson(lesson); result.x = -probe.x;
  return result;
}
export function demonstrationInput(model: MovementLesson) {
  return model.time < .36 ? 1 : model.velocity > .02 ? -1 : 0;
}
