import type {Equipment} from './equipment';

/** Prepare carried weapons one at a time, only while the player isn't training. */
export class WeaponPreloader {
  private revision = 0;
  private pending?: {id: number; idle: boolean};

  start(weapons: readonly Equipment[], load: (weapon: Equipment) => Promise<unknown>, available: () => boolean) {
    this.cancel();
    const revision = this.revision;
    const queue = [...new Set(weapons)];
    const schedule = () => {
      if (revision !== this.revision || !queue.length) return;
      const run = async () => {
        if (revision !== this.revision) return;
        this.pending = undefined;
        if (available()) {
          try {await load(queue.shift()!);} catch { /* Selection reports unavailable assets; optional warmup doesn't. */ }
        }
        schedule();
      };
      if (available() && typeof requestIdleCallback === 'function') {
        this.pending = {id: requestIdleCallback(() => {void run();}, {timeout: 2000}), idle: true};
      } else this.pending = {id: window.setTimeout(() => {void run();}, 300), idle: false};
    };
    schedule();
  }

  cancel() {
    this.revision++;
    if (this.pending) {
      if (this.pending.idle) cancelIdleCallback(this.pending.id);
      else clearTimeout(this.pending.id);
      this.pending = undefined;
    }
  }
}
