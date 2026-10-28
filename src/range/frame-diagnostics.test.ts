import {describe, expect, it} from 'vitest';
import {FrameMetrics} from './performance';

describe('bounded active frame-time diagnostics', () => {
  it('uses nearest-rank percentiles and mean of the slowest 1%, including >250ms stalls', () => {
    const metrics = new FrameMetrics(); metrics.sample(.01, 1, false, true, 100);
    for (let n = 0; n < 98; n++) metrics.sample(.01, 1, false, true, 100);
    metrics.sample(.1, 1, false, true, 100); metrics.sample(.5, 1, false, true, 100);
    expect(metrics.report({quality: 'low', intervalSource: 'raw'})).toMatchObject({context: {quality: 'low', intervalSource: 'raw'},
      summary: {sampleCount: 100, p95Ms: 10, p99Ms: 100, onePercentLowFps: 2, framesOverBudget: 2, longFrames: 2, framesOver100Ms: 1}});
  });
  it('excludes pause and visibility gaps, including the first resumed interval', () => {
    const metrics = new FrameMetrics(); metrics.sample(.01, 1, false, true, 100);
    metrics.sample(.02, 1, false, true, 100);
    metrics.sample(2, 1, false, false, 100);
    metrics.sample(1, 1, false, true, 100);
    metrics.setVisible(false); metrics.sample(2, 1, false, true, 100);
    metrics.setVisible(true); metrics.sample(3, 1, false, true, 100);
    metrics.sample(.03, 1, false, true, 100);
    expect(metrics.report({}, true).frameTimesMs).toEqual([20, 30]);
    expect(metrics.snapshot().longFrames).toBe(0);
  });
  it('evicts old stalls by active duration and bounds extremely high refresh histories', () => {
    const metrics = new FrameMetrics(); metrics.sample(.01, 1, false, true, 0); metrics.sample(.5, 1, false, true, 0);
    for (let n = 0; n < 1200; n++) metrics.sample(.01, 1, false, true, 0);
    expect(metrics.snapshot().p99Ms).toBe(10); expect(metrics.snapshot().longFrames).toBe(0);
    for (let n = 0; n < 5000; n++) metrics.sample(.001, 1, false, true, 0);
    expect(metrics.report({}, true).frameTimesMs).toHaveLength(2048);
    expect(metrics.snapshot().seconds).toBeLessThanOrEqual(10);
  });
  it('keeps a long active stall instead of misclassifying it as a suspended tab', () => {
    const metrics = new FrameMetrics(); metrics.sample(.01, 1, false, true, 0); metrics.sample(12, 1, false, true, 0);
    expect(metrics.snapshot()).toMatchObject({p99Ms: 12000, longFrames: 1, sampleCount: 1});
    metrics.sample(.01, 1, false, true, 0); expect(metrics.snapshot().longFrames).toBe(0);
  });
  it('rejects invalid timing and bounds and detaches exported metadata/samples', () => {
    const metrics = new FrameMetrics();
    for (const dt of [NaN, Infinity, -1, 0]) metrics.sample(dt, 1, true, true, 0);
    metrics.sample(.01, 1, false, true, 0); metrics.sample(.02, 1, false, true, 0);
    const report = metrics.report({route: 'a'.repeat(500)}, true);
    expect(report.context.route).toHaveLength(160); report.frameTimesMs![0] = 999;
    expect(metrics.snapshot().p99Ms).toBe(20); expect(metrics.report().frameTimesMs).toBeUndefined();
    expect(JSON.stringify(metrics.report()).length).toBeLessThan(2000);
  });
});
