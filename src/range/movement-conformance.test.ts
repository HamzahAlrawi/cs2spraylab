import {describe, expect, it} from 'vitest';
import {compareMovementReference, MOVEMENT_MODEL, MOVEMENT_SCHEMA, movementScenarios, parseMovementReference,
  runMovementScenario, type MovementReference} from './movement-conformance';

const fixture = (): MovementReference => ({schema: MOVEMENT_SCHEMA, modelVersion: MOVEMENT_MODEL,
  provenance: {kind: 'synthetic-regression', source: 'test-generated shared motor', build: 'trainer only', recordedAt: '2026-10-15T00:00:00Z',
    method: 'Synthetic output; not a CS2 measurement', sha256: '0'.repeat(64), precision: 'double-precision deterministic motor'},
  tolerances: {timeSeconds: 1e-8, positionUnits: 1e-7, speedUnitsPerSecond: 1e-7, heightUnits: 1e-7,
    stoppingDistanceUnits: 1e-7, landingDisplacementUnits: 1e-7, stopSpeedUnitsPerSecond: .1, rationale: 'Synthetic repeatability only'},
  scenarios: movementScenarios.map(scenario => ({scenario: structuredClone(scenario), samples: runMovementScenario(scenario)}))});

describe('versioned movement trajectory conformance', () => {
  it('runs all authored scenarios deterministically without claiming native capture evidence', () => {
    const reference = parseMovementReference(fixture()), report = compareMovementReference(reference);
    expect(report.scenarios.map(s => [s.id, s.failures])).toEqual(movementScenarios.map(s => [s.id, []]));
    expect(report.passed).toBe(true); expect(report.provenance.kind).toBe('synthetic-regression');
  });
  it('exposes speed-time, stopping, gradual crouch eye/hull, jump+crouch, slopes and landing evidence', () => {
    const reference = fixture(), report = compareMovementReference(reference);
    const release = report.scenarios[0];
    expect(release.expectedEvents.stoppingDistance).toBeGreaterThan(10);
    expect(release.expectedEvents.stoppingDistance).toBeLessThan(40);
    // Pinned trainer-only regression values, never labeled native measurements.
    expect(release.expectedEvents.stoppingDistance).toBeCloseTo(32.28804714987072, 8);
    expect(release.expectedEvents.stopTime).toBe(1.3828125);
    expect(report.scenarios[1].expectedEvents.stoppingDistance).toBeCloseTo(10.991850687902968, 8);
    const crouch = reference.scenarios.find(s => s.scenario.id === 'crouch-moving')!.samples;
    expect(crouch.some(s => s.hull > 54 && s.hull < 72)).toBe(true);
    expect(Math.min(...crouch.map(s => s.hull))).toBe(54); expect(Math.min(...crouch.map(s => s.eye))).toBe(46);
    const jump = reference.scenarios.find(s => s.scenario.id === 'jump-crouch')!.samples;
    expect(Math.max(...jump.map(s => s.feet))).toBeGreaterThan(56);
    expect(report.scenarios.find(s => s.id === 'slope-landing')!.actualEvents.landings.length).toBeGreaterThan(0);
    expect(report.scenarios.find(s => s.id === 'edge-landing')!.actualEvents.landings.length).toBeGreaterThan(0);
  });
  it('fails measured discrepancies rather than tuning them out, and retains the declared tolerance', () => {
    const reference = fixture(); reference.scenarios[0].samples[20].x += 2;
    const report = compareMovementReference(reference);
    expect(report.scenarios[0].failures).toContain('position'); expect(report.passed).toBe(false);
    expect(report.tolerances.positionUnits).toBe(1e-7);
  });
  it('rejects missing provenance/tolerances, incompatible versions and partial/unordered captures', () => {
    for (const mutate of [
      (r: any) => {delete r.provenance.precision;}, (r: any) => {r.provenance.sha256 = 'unknown';},
      (r: any) => {r.schema = 'v999';}, (r: any) => {delete r.tolerances.rationale;},
      (r: any) => {r.scenarios[0].samples.pop();}, (r: any) => {r.scenarios[0].samples[1].time = 0;},
      (r: any) => {r.scenarios[0].scenario.commands[0].at = .1;}, (r: any) => {r.scenarios[0].scenario.initial.x = NaN;},
    ]) {const reference = fixture(); mutate(reference); expect(() => parseMovementReference(reference)).toThrow();}
  });
});
