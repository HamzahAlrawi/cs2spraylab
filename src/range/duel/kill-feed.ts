import type {Equipment} from '../equipment';
import type {UtilityKind} from './utility-loadout';

export const KILL_FEED_LIMIT = 6;
export const KILL_FEED_SECONDS = 5;

export type KillFeedEvent = {
  shooter: number;
  victim: number;
  shotId: number;
  equipment: Equipment;
  utility?: UtilityKind;
  headshot: boolean;
  shooterName?: string;
  victimName?: string;
};

export type KillFeedEntry = Readonly<KillFeedEvent & {
  id: number;
  shooterName: string;
  victimName: string;
  time: number;
  expiresAt: number;
  local: 'kill' | 'death' | 'other';
}>;

/** Inject a monotonic clock in seconds (for example sim.time); clear on a new round/clock reset. */
export class KillFeedModel {
  private rows: KillFeedEntry[] = [];
  private seen = new Map<string, number>();
  private nextId = 0;

  constructor(private readonly localPlayerId = 0) {}

  push(event: KillFeedEvent, time: number): void {
    this.prune(time);
    const key = `${event.shooter}:${event.shotId}:${event.victim}`;
    if (this.seen.has(key)) return;
    this.seen.set(key, time + KILL_FEED_SECONDS);
    // Retain evicted rows' identities too, without allowing an unbounded pellet cache.
    if (this.seen.size > 256) this.seen.delete(this.seen.keys().next().value!);
    this.rows = [Object.freeze({...event,
      id: this.nextId++, time, expiresAt: time + KILL_FEED_SECONDS,
      shooterName: event.shooterName?.trim() || this.name(event.shooter),
      victimName: event.victimName?.trim() || this.name(event.victim),
      local: event.victim === this.localPlayerId ? 'death' : event.shooter === this.localPlayerId ? 'kill' : 'other',
    }), ...this.rows].slice(0, KILL_FEED_LIMIT);
  }

  /** Newest first; returns a snapshot, never the mutable backing array. */
  entries(time: number): readonly KillFeedEntry[] {
    this.prune(time);
    return this.rows.slice();
  }

  clear(): void {
    this.rows = [];
    this.seen.clear();
  }

  private name(id: number): string {
    return id === this.localPlayerId ? 'You' : `Bot ${id}`;
  }

  private prune(time: number): void {
    if (!Number.isFinite(time)) throw new RangeError('Kill feed time must be finite seconds');
    this.rows = this.rows.filter(row => time < row.expiresAt);
    for (const [key, expiry] of this.seen) if (time >= expiry) this.seen.delete(key);
  }
}
