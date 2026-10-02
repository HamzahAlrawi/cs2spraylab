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
  private elapsed = 0;
  private frames = 0;
  private cpu = 0;
  private warmup = 0;
  private slow = 0;
  private fast = 0;
  sample(dt: number, cpuMs: number, adaptive: boolean, active: boolean, cap: number) {
    if (dt <= 0 || dt > .25) return false;
    this.elapsed += dt; this.frames++; this.cpu += cpuMs;
    if (this.elapsed < .5) return false;
    this.fps = Math.round(this.frames / this.elapsed);
    this.cpuMs = this.cpu / this.frames;
    const window = this.elapsed;
    this.elapsed = this.frames = this.cpu = 0;
    if (!active) {this.slow = this.fast = this.warmup = 0; return true;}
    this.warmup += window;
    if (!adaptive || this.warmup < 3) return true;
    const target = Math.min(60, cap || 60), budget = 1000 / target;
    const overloaded = this.fps < target * .8 || this.cpuMs > budget * .85;
    this.slow = overloaded ? this.slow + window : 0;
    this.fast = !overloaded && this.fps >= target * .97 && this.cpuMs < budget * .5 ? this.fast + window : 0;
    if (this.slow >= 1.5) {this.adaptive = Math.max(.5, this.adaptive - .1); this.slow = this.fast = 0;}
    if (this.fast >= 8) {this.adaptive = Math.min(1, this.adaptive + .05); this.slow = this.fast = 0;}
    return true;
  }
  resetResolution() {this.adaptive = 1; this.warmup = this.slow = this.fast = 0;}
}

// Updated at 2 Hz, outside React's gameplay status updates.
export class PerformanceMeter {
  private element = document.createElement('output');
  constructor(host: HTMLElement) {
    this.element.className = 'performance-meter'; this.element.hidden = true;
    this.element.setAttribute('aria-label', 'Performance monitor'); host.append(this.element);
  }
  configure(visible: boolean) {this.element.hidden = !visible;}
  update(metrics: FrameMetrics, ratio: number) {
    if (this.element.hidden) return;
    this.element.textContent = `${metrics.fps} FPS | ${metrics.fps ? (1000 / metrics.fps).toFixed(1) : '0'} ms`;
    this.element.title = `CPU frame: ${metrics.cpuMs.toFixed(1)} ms. Render density: ${Math.round(ratio * 100)}%.`;
  }
  dispose() {this.element.remove();}
}
