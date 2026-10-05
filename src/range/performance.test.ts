import {describe, expect, it} from 'vitest';
import {defaults, sanitizeSettings} from './config';
import {FrameMetrics, FramePacer, qualityPolicy, renderPixelRatio} from './performance';

describe('performance settings', () => {
  it('migrates existing profiles without enabling the FPS overlay', () => {
    const settings = sanitizeSettings({quality:'low'});
    expect(settings).toMatchObject({quality:'low',showFps:false,frameLimit:0,animatedGuides:true,protectShortcuts:true});
    expect(sanitizeSettings({quality:'performance',frameLimit:60,showFps:true})).toMatchObject({quality:'performance',frameLimit:60,showFps:true});
    expect(sanitizeSettings({quality:'performance'}).frameLimit).toBe(60);
    expect(sanitizeSettings({quality:'performance',frameLimit:0}).frameLimit).toBe(0);
    expect(sanitizeSettings({frameLimit:Infinity,quality:'invalid'})).toMatchObject({frameLimit:0,quality:defaults.quality});
  });
  it('bounds render density on retina, ultrawide and portrait screens', () => {
    expect(renderPixelRatio(1920,1080,2,'performance')).toBe(.5);
    expect(renderPixelRatio(500,2000,3,'performance')).toBe(.48);
    expect(renderPixelRatio(800,600,1,'high')).toBe(1);
    expect(renderPixelRatio(800,600,2,'auto',.5)).toBe(.75);
    expect(qualityPolicy('performance').shadows).toBe(false);
  });
});

describe('render-only frame pacing', () => {
  it.each([30,60,120])('paces %i FPS without accumulated timing drift', cap => {
    const pacer = new FramePacer();
    let count = 0;
    for (let i = 0; i < 2400; i++) if (pacer.ready(i * 1000 / 240, cap)) count++;
    expect(count).toBeCloseTo(cap * 10, 0);
  });
  it('resets when entering a game or changing caps and recovers after a stalled frame', () => {
    const pacer = new FramePacer();
    expect(pacer.ready(0,15)).toBe(true);
    expect(pacer.ready(10,15)).toBe(false);
    expect(pacer.ready(10,0)).toBe(true);
    expect(pacer.ready(11,0)).toBe(true);
    expect(pacer.ready(12,60)).toBe(true);
    expect(pacer.ready(1000,60)).toBe(true);
    expect(pacer.ready(1010,60)).toBe(false);
  });
});

const samples = (metrics: FrameMetrics, seconds: number, fps: number, cpu: number, active = true, cap = 0) => {
  for (let i = 0; i < seconds * fps; i++) metrics.sample(1/fps,cpu,true,active,cap);
};
describe('adaptive resolution', () => {
  it('waits for asset warmup and sustained overload, then remains bounded', () => {
    const metrics = new FrameMetrics();
    samples(metrics,3,30,24); expect(metrics.adaptive).toBe(1);
    samples(metrics,3,30,24); expect(metrics.adaptive).toBeLessThan(1);
    samples(metrics,60,30,24); expect(metrics.adaptive).toBe(.5);
  });
  it('recovers slowly after sustained headroom instead of oscillating', () => {
    const metrics = new FrameMetrics(); metrics.adaptive = .5;
    samples(metrics,6,60,3); expect(metrics.adaptive).toBe(.5);
    samples(metrics,10,60,3); expect(metrics.adaptive).toBeGreaterThan(.5);
    samples(metrics,120,60,3); expect(metrics.adaptive).toBe(1);
  });
  it('does not treat an intentionally capped or idle frame rate as overload', () => {
    const metrics = new FrameMetrics();
    samples(metrics,20,30,8,true,30); expect(metrics.adaptive).toBe(1);
    samples(metrics,20,15,5,false); expect(metrics.adaptive).toBe(1);
    expect(metrics.fps).toBe(15); expect(metrics.cpuMs).toBe(5);
  });
  it('reduces automatic visual pose sampling for sustained CPU pressure, with bounded slow recovery', () => {
    const metrics = new FrameMetrics();
    samples(metrics, 3, 30, 24); expect(metrics.animationRate('auto')).toBe(60);
    samples(metrics, 15, 30, 24); expect(metrics.animationRate('auto')).toBe(30);
    expect(metrics.animationRate('high')).toBe(120);
    expect(metrics.animationRate('low')).toBe(45);
    samples(metrics, 6, 60, 3); expect(metrics.animationRate('auto')).toBe(30);
    samples(metrics, 60, 60, 3); expect(metrics.animationRate('auto')).toBe(60);
    metrics.resetResolution(); expect(metrics.animationRate('auto')).toBe(60);
  });
  it('does not thin animation for GPU-only slow frames, intentional caps or idle previews', () => {
    for (const [fps, cpu, active, cap] of [[30, 3, true, 0], [30, 20, true, 30], [15, 20, false, 0]] as const) {
      const metrics = new FrameMetrics(); samples(metrics, 30, fps, cpu, active, cap);
      expect(metrics.animationRate('auto')).toBe(60);
    }
    const metrics = new FrameMetrics();
    for (let index = 0; index < 600; index++) metrics.sample(1 / 30, 24, false, true, 0);
    expect(metrics.animationRate('auto')).toBe(60);
  });
});
