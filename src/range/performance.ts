import type {Settings} from './config';

const policies = {
  high: {pixelRatio: 2, maxWidth: 2560, animationHz: 120, guideHz: 20, shadows: true},
  auto: {pixelRatio: 1.5, maxWidth: 1920, animationHz: 60, guideHz: 10, shadows: true},
  low: {pixelRatio: 1, maxWidth: 1280, animationHz: 45, guideHz: 8, shadows: false},
  performance: {pixelRatio: .75, maxWidth: 960, animationHz: 30, guideHz: 5, shadows: false}
};
export const qualityPolicy = (quality: Settings['quality']) => policies[quality];

export function renderPixelRatio(width: number, height: number, dpr: number, quality: Settings['quality'], adaptive = 1) {
  const policy = qualityPolicy(quality);
  // Bound both axes: an ultra-wide or portrait display must not undo the preset.
  return Math.min(dpr, policy.pixelRatio, policy.maxWidth / Math.max(1, width, height)) * adaptive;
}

export class FramePacer {
  private next = 0;
  private limit = -1;
  ready(timestamp: number, limit: number) {
    if (limit !== this.limit) {this.limit = limit; this.next = timestamp;}
    if (!limit) return true;
    if (timestamp + .5 < this.next) return false;
    const interval = 1000 / limit;
    this.next = this.next && timestamp < this.next + interval ? this.next + interval : timestamp + interval;
    return true;
  }
}

export class FrameMetrics {
  fps = 0;
  cpuMs = 0;
  adaptive = 1;
  animationHz = policies.auto.animationHz;
  p95Ms = 0;
  p99Ms = 0;
  onePercentLowFps = 0;
  longFrames = 0;
  framesOverBudget = 0;
  framesOver100Ms = 0;
  sampleCount = 0;
  private readonly intervals = new Float64Array(2048);
  private readonly budgets = new Float64Array(2048);
  private readonly sorted = new Float64Array(2048);
  private head = 0;
  private count = 0;
  private seconds = 0;
  private visible = true;
  private skipNext = false;
  private active?: boolean;
  private excluded = 0;
  private elapsed = 0;
  private frames = 0;
  private cpu = 0;
  private warmup = 0;
  private slow = 0;
  private fast = 0;
  private cpuSlow = 0;
  private cpuFast = 0;
  animationRate(quality: Settings['quality']) {
    return quality === 'auto' ? this.animationHz : qualityPolicy(quality).animationHz;
  }
  /** Called on visibility edges, including when rAF is suspended entirely. */
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible; this.skipNext = true;
    this.elapsed = this.frames = this.cpu = 0;
    this.warmup = this.slow = this.fast = this.cpuSlow = this.cpuFast = 0;
  }
  private summarize() {
    let over = 0, long = 0, veryLong = 0;
    for (let n = 0; n < this.count; n++) {
      const index = (this.head + n) % this.intervals.length, ms = this.intervals[index];
      this.sorted[n] = ms;
      over += Number(ms > this.budgets[index]); long += Number(ms > 50); veryLong += Number(ms > 100);
    }
    const sorted = this.sorted.subarray(0, this.count); sorted.sort();
    this.sampleCount = this.count;
    this.p95Ms = sorted[Math.ceil(this.count * .95) - 1] ?? 0;
    this.p99Ms = sorted[Math.ceil(this.count * .99) - 1] ?? 0;
    const tail = Math.ceil(this.count * .01);
    let sum = 0;
    for (let n = this.count - tail; n < this.count; n++) sum += sorted[n];
    this.onePercentLowFps = sum ? 1000 * tail / sum : 0;
    this.framesOverBudget = over; this.longFrames = long; this.framesOver100Ms = veryLong;
  }
  /** Explicit local snapshot; allocation is confined to export, not sampling. */
  exportReport(context: FrameReportContext = {}, includeSamples = false) {
    this.summarize();
    const labels: Record<string, string | number> = {};
    for (const key of ['hardware', 'browser', 'preset', 'quality', 'mode', 'route', 'loading', 'botCount', 'targetFps', 'frameLimit', 'intervalSource'] as const) {
      const value = context[key];
      if (typeof value === 'string') labels[key] = value.slice(0, 160);
      else if (typeof value === 'number' && Number.isFinite(value)) labels[key] = value;
    }
    return {schema: 'spraylab.frame-times/v1', context: labels,
      scope: 'Latest active visible rendered intervals, trailing 10 active seconds / 2048 frames (one stall may exceed the window); idle and resume intervals excluded. Supply raw dt, not simulation-clamped dt.',
      definitions: {percentiles: 'nearest rank', onePercentLow: '1000 / mean of slowest ceil(N * .01) frame times',
        longFrameMs: 50, over100Ms: 100, budget: '1000 / (cap || 60), strict greater-than'},
      summary: {fps: this.fps, cpuMs: this.cpuMs, adaptive: this.adaptive, animationHz: this.animationHz,
        sampleCount: this.count, seconds: this.seconds, p95Ms: this.p95Ms, p99Ms: this.p99Ms,
        onePercentLowFps: this.onePercentLowFps, framesOverBudget: this.framesOverBudget,
        longFrames: this.longFrames, framesOver100Ms: this.framesOver100Ms, excludedSamples: this.excluded},
      ...(includeSamples ? {frameTimesMs: Array.from({length: this.count}, (_, n) => this.intervals[(this.head + n) % this.intervals.length])} : {})};
  }
  report(context: FrameReportContext = {}, includeSamples = false) {return this.exportReport(context, includeSamples);}
  snapshot() {return this.exportReport().summary;}
  sample(dt: number, cpuMs: number, adaptive: boolean, active: boolean, cap: number) {
    if (!this.visible || this.skipNext || !Number.isFinite(dt) || dt <= 0 || !Number.isFinite(cpuMs) || cpuMs < 0) {
      this.skipNext = false; this.excluded++; return false;
    }
    if (active !== this.active) {
      this.active = active; this.elapsed = this.frames = this.cpu = 0;
      this.warmup = this.slow = this.fast = this.cpuSlow = this.cpuFast = 0;
      // No interval straddling preview/pause and active play belongs in tails.
      if (active) {this.excluded++; return false;}
    }
    if (active) {
      while (this.count && (this.count === this.intervals.length || this.seconds + dt > 10)) {
        this.seconds -= this.intervals[this.head] / 1000;
        this.head = (this.head + 1) % this.intervals.length; this.count--;
      }
      const index = (this.head + this.count) % this.intervals.length;
      this.intervals[index] = dt * 1000; this.budgets[index] = 1000 / (cap > 0 && Number.isFinite(cap) ? cap : 60);
      this.seconds += dt; this.count++;
    } else this.excluded++;
    this.elapsed += dt; this.frames++; this.cpu += cpuMs;
    if (this.elapsed < .5) return false;
    this.fps = Math.round(this.frames / this.elapsed);
    this.cpuMs = this.cpu / this.frames;
    this.summarize();
    const window = this.elapsed;
    this.elapsed = this.frames = this.cpu = 0;
    if (!active) {this.slow = this.fast = this.cpuSlow = this.cpuFast = this.warmup = 0; return true;}
    this.warmup += window;
    if (!adaptive || this.warmup < 3) return true;
    const target = Math.min(60, cap || 60), budget = 1000 / target;
    // Resolution alone cannot relieve CPU-bound pose evaluation. Thin visual
    // sampling only after sustained pressure; simulation and aiming stay full rate.
    this.cpuSlow = this.cpuMs > budget * .75 ? this.cpuSlow + window : 0;
    this.cpuFast = this.cpuMs < budget * .45 ? this.cpuFast + window : 0;
    if (this.cpuSlow >= 1.5) {this.animationHz = Math.max(30, this.animationHz - 10); this.cpuSlow = this.cpuFast = 0;}
    if (this.cpuFast >= 8) {this.animationHz = Math.min(60, this.animationHz + 5); this.cpuSlow = this.cpuFast = 0;}
    const overloaded = this.fps < target * .8 || this.cpuMs > budget * .85;
    this.slow = overloaded ? this.slow + window : 0;
    this.fast = !overloaded && this.fps >= target * .97 && this.cpuMs < budget * .5 ? this.fast + window : 0;
    if (this.slow >= 1.5) {this.adaptive = Math.max(.5, this.adaptive - .1); this.slow = this.fast = 0;}
    if (this.fast >= 8) {this.adaptive = Math.min(1, this.adaptive + .05); this.slow = this.fast = 0;}
    return true;
  }
  resetResolution() {
    this.adaptive = 1; this.animationHz = policies.auto.animationHz;
    this.warmup = this.slow = this.fast = this.cpuSlow = this.cpuFast = 0;
  }
}

export type FrameReportContext = {hardware?: string; browser?: string; preset?: string; route?: string;
  quality?: string; mode?: string; frameLimit?: number; intervalSource?: 'raw' | 'clamped';
  loading?: 'cold' | 'warm' | 'unknown'; botCount?: number; targetFps?: number};

// Updated at 2 Hz, outside React's gameplay status updates.
export class PerformanceMeter {
  private element = document.createElement('output');
  private metrics?: FrameMetrics;
  private readonly visibility = () => this.metrics?.setVisible(!document.hidden);
  constructor(host: HTMLElement) {
    this.element.className = 'performance-meter'; this.element.hidden = true;
    this.element.setAttribute('aria-label', 'Performance monitor'); host.append(this.element);
    // Keep the fixed-height HUD clear of ammo on narrow screens.
    this.element.style.width = 'min(530px, calc(100% - 16px))';
    this.element.style.overflow = 'hidden'; this.element.style.textOverflow = 'ellipsis';
    document.addEventListener('visibilitychange', this.visibility);
  }
  configure(visible: boolean) {this.element.hidden = !visible;}
  update(metrics: FrameMetrics, ratio: number) {
    this.metrics = metrics; metrics.setVisible(!document.hidden);
    if (this.element.hidden) return;
    this.element.textContent = `${metrics.fps} FPS | p95 ${metrics.p95Ms.toFixed(1)} | p99 ${metrics.p99Ms.toFixed(1)} ms | 1% ${metrics.onePercentLowFps.toFixed(0)} FPS | >50ms ${metrics.longFrames}`;
    this.element.title = `${this.element.textContent}. Active samples: ${metrics.sampleCount}. Over budget: ${metrics.framesOverBudget}; >100 ms: ${metrics.framesOver100Ms}. CPU: ${metrics.cpuMs.toFixed(1)} ms. Render density: ${Math.round(ratio * 100)}%.`;
  }
  exportReport(context: FrameReportContext = {}, includeSamples = false) {return this.metrics?.exportReport(context, includeSamples);}
  dispose() {document.removeEventListener('visibilitychange', this.visibility); this.metrics = undefined; this.element.remove();}
}
