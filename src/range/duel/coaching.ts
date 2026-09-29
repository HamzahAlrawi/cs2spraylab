import {UNIT, type Vec} from '../actor-physics';
import {aimError} from '../drills';
import {equipmentStats} from '../equipment';
import type {DuelActorSnapshot, DuelEvent} from './types';
import type {VisibleEnemy} from './perception';

export type DuelReview = {
  shots: number; hits: number; heads: number; kills: number; damage: number; taken: number;
  movingShots: number; airShots: number; accuracy: number; settled: number; headRate: number;
  score: number | null; meanSpeed: number; placement: number | null; timeToDamage: number | null;
  exposedSeconds: number; multipleAnglesSeconds: number; message: string; tip: string;
};
export class DuelCoach {
  shots = 0; hits = 0; heads = 0; kills = 0; damage = 0; taken = 0;
  movingShots = 0; airShots = 0; speedTotal = 0; exposedSeconds = 0; multipleAnglesSeconds = 0;
  private spotted = new Map<number, number>();
  private damaged = new Set<number>();
  private placements: number[] = [];
  private times: number[] = [];
  private unsettledShots = 0;
  observe(time: number, self: DuelActorSnapshot, visible: VisibleEnemy[]) {
    if (visible.length) this.exposedSeconds += 1 / 32;
    if (visible.length > 1) this.multipleAnglesSeconds += 1 / 32;
    for (const enemy of visible) if (!this.spotted.has(enemy.id)) {
      this.spotted.set(enemy.id, time);
      this.placements.push(aimError(self.position, self.yaw, self.pitch, enemy.aimPoint));
    }
    for (const id of this.spotted.keys()) if (!visible.some(enemy => enemy.id === id) && !this.damaged.has(id)) this.spotted.delete(id);
  }
  shot(self: DuelActorSnapshot) {
    if (self.equipment === 'knife') return;
    this.shots++;
    const speed = Math.hypot(self.velocity.x, self.velocity.z) / UNIT;
    this.speedTotal += speed;
    const moving = speed > equipmentStats(self.equipment).speed * .34;
    const airborne = !(self.grounded ?? self.feet === 0);
    this.movingShots += +moving;
    this.airShots += +airborne;
    this.unsettledShots += +(moving || airborne);
  }
  hit(event: Extract<DuelEvent, {kind: 'hit'}>, time: number, melee = false) {
    if (event.victim === 0) this.taken += event.healthDamage;
    if (event.shooter !== 0) return;
    if (!melee) {this.hits++; this.heads += +(event.group === 'head');}
    this.kills += +event.lethal; this.damage += event.healthDamage;
    const seen = this.spotted.get(event.victim);
    if (seen !== undefined && !this.damaged.has(event.victim)) this.times.push((time - seen) * 1000);
    this.damaged.add(event.victim);
  }
  review(): DuelReview {
    const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const accuracy = this.shots ? 100 * this.hits / this.shots : 0;
    const settled = this.shots ? 100 * (this.shots - this.unsettledShots) / this.shots : 0;
    const headRate = this.hits ? 100 * this.heads / this.hits : 0;
    const placement = mean(this.placements), timeToDamage = mean(this.times);
    let message = 'Keep the first bullet deliberate', tip = 'Prepare the next corner at head height. Use movement for small alignment changes and the mouse for unexpected positions.';
    if (!this.shots) {message = 'Find one fight you can take'; tip = 'Move to the next edge, check one angle, then stop before firing. Use 1 or 2 to equip a gun.';}
    else if (this.airShots) {message = `${this.airShots} shot${this.airShots === 1 ? '' : 's'} fired in the air`; tip = 'Land before firing a rifle. Jumping adds inaccuracy even when your crosshair is on the target.';}
    else if (this.movingShots / this.shots > .2) {message = `${this.movingShots}/${this.shots} shots fired while moving`; tip = 'Moving right? Release D, briefly tap A, then fire as you stop. Crouching is not an instant brake.';}
    else if (this.multipleAnglesSeconds > 1) {message = 'You exposed yourself to several enemies'; tip = 'Use the edge of cover to fight one visible angle at a time. Avoid swinging into two opponents together.';}
    else if (placement !== null && placement > 4) {message = 'Prepare your aim before the enemy appears'; tip = 'Hold head height near the next corner. Strafe to adjust a small horizontal gap; use the mouse when an enemy is elsewhere.';}
    else if (accuracy < 25) {message = 'Make the next burst easier to control'; tip = 'Use taps at long range and controlled bursts closer in. Learn this weapon against the wall at several distances, then return to duels.';}
    else if (headRate < 20 && this.hits >= 3) {message = 'Your first aim is landing low'; tip = 'Start at head height. Body shots can finish a fight, but do not begin every duel by aiming at the chest.';}
    else if (timeToDamage !== null && timeToDamage > 700) {message = 'Reduce the adjustment before your first hit'; tip = 'Pre-aim the likely angle and stop on it. Time to damage includes aiming and firing, not just reaction time.';}
    else if (this.kills) {message = 'Good shot timing'; tip = 'Keep the same stop-and-shoot rhythm. After a kill, check the next angle instead of holding the old one.';}
    const score = this.shots ? Math.round(settled * .4 + accuracy * .35 +
      Math.max(0, 15 - (placement ?? 15) * 2) + Math.max(0, 10 - this.multipleAnglesSeconds * 3)) : null;
    return {shots: this.shots, hits: this.hits, heads: this.heads, kills: this.kills, damage: this.damage, taken: this.taken,
      movingShots: this.movingShots, airShots: this.airShots, exposedSeconds: this.exposedSeconds,
      multipleAnglesSeconds: this.multipleAnglesSeconds, accuracy, settled, headRate, score, placement, timeToDamage,
      meanSpeed: this.shots ? this.speedTotal / this.shots : 0, message, tip};
  }
}

export type DuelHistory = {date: string; outcome: string; review: DuelReview};
export function loadDuelHistory(): DuelHistory[] {
  try {
    const value = JSON.parse(localStorage.getItem('spraylab.duel.history.v1') || '[]');
    return Array.isArray(value) ? value.filter(v => v && typeof v.date === 'string' && typeof v.outcome === 'string' &&
      v.review && ['shots', 'hits', 'heads', 'kills', 'damage', 'taken', 'accuracy', 'settled', 'headRate',
        'movingShots', 'airShots', 'meanSpeed', 'exposedSeconds', 'multipleAnglesSeconds'].every(k => Number.isFinite(v.review[k]) && v.review[k] >= 0) &&
      ['score', 'placement', 'timeToDamage'].every(k => v.review[k] === null || Number.isFinite(v.review[k]) && v.review[k] >= 0) &&
      typeof v.review.tip === 'string' && typeof v.review.message === 'string').slice(0, 50) : [];
  } catch {return [];}
}

export function damageBearing(player: Vec, source: Vec) {return Math.atan2(source.x - player.x, player.z - source.z);}
