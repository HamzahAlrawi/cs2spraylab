import {clamp, UNIT} from '../actor-physics';
import type {DuelActorSnapshot} from './types';

type ViewActor = Pick<DuelActorSnapshot, 'position' | 'feet' | 'grounded' | 'alive' | 'generation' | 'supportingActor'>;

// Presentation only: Source's stair-view approach, not a camera/shot-origin
// replacement. See docs/dust2-prefire.md for the CS2 verification boundary.
export class StepView {
  private floor?: number;
  private eye?: number;
  private generation?: number;
  private x = 0;
  private z = 0;

  reset() {this.floor = this.eye = this.generation = undefined;}

  update(actor: ViewActor, dt: number) {
    const eye = actor.position.y - actor.feet;
    const discontinuity = Math.hypot(actor.position.x - this.x, actor.position.z - this.z) > 64 * UNIT;
    if (this.floor === undefined || this.generation !== actor.generation || discontinuity ||
      !actor.alive || !actor.grounded || actor.supportingActor !== undefined || Math.abs(eye - (this.eye ?? eye)) > 1e-6) {
      this.floor = actor.feet;
    } else {
      const change = actor.feet - this.floor, advance = Math.max(0, Math.min(dt, .25)) * 150 * UNIT;
      this.floor += clamp(change, -advance, advance);
      this.floor = clamp(this.floor, actor.feet - 18 * UNIT, actor.feet + 18 * UNIT);
    }
    this.eye = eye; this.generation = actor.generation;
    this.x = actor.position.x; this.z = actor.position.z;
    return actor.position.y + this.floor - actor.feet;
  }
}
