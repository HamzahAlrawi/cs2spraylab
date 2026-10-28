import {describe, expect, it} from 'vitest';
import {fitsHull, sweepHull, verticalContact} from '../actor-collision';
import {UNIT, type Vec} from '../actor-physics';
import {randomStream} from '../duel/rng';
import type {NativeMapCollision} from './native-collision';
import {auditHoldPocket} from './hold-pocket-audit';
import {encounterFixture} from './encounter-test-data';
import {encounterSignature, jointSetupDistribution, validateEncounterEvidence, validateHeldoutEncounters} from './encounter-evidence';
import {authoredEncounterCoverage, choosePrefireEncounter} from './encounters';
import type {EncounterObservation, PrefireRoute} from './schema';

describe('contextual joint encounter evidence', () => {
  it('samples deterministic complete setups, never independent teammates or padded roster slots', () => {
    const {catalog, route, build} = encounterFixture();
    const rosters = new Set<string>();
    for (let seed = 0; seed < 80; seed++) {
      const first = choosePrefireEncounter(catalog, route, randomStream(seed, 'encounter'), {build});
      expect(first).toEqual(choosePrefireEncounter(catalog, route, randomStream(seed, 'encounter'), {build}));
      expect(first.mode).toBe('contextual-evidence');
      const roster = first.angles.map(angle => angle.id).join(',');
      expect(['a0,a1', 'a2,a3']).toContain(roster); rosters.add(roster);
    }
    expect(rosters.size).toBe(2);
  });
  it('uses only actually recorded context and never broadens a sparse filter', () => {
    const {catalog, route, build} = encounterFixture();
    const selected = choosePrefireEncounter(catalog, route, () => 0, {build, context: {equipment: 'rifles', arrival: 'opening'}});
    expect(selected.conditionedOn).toEqual(['side', 'phase', 'equipment', 'arrival']);
    expect(selected.evidence).toMatchObject({trainObservations: 12, trainMatches: 3, heldoutObservations: 8, heldoutMatches: 2,
      selectedSetupObservations: 6, selectedSetupMatches: 3, unseenSetupShare: 0, confidence: 'heldout-supported'});
    expect(selected.evidence.totalVariation).toBeCloseTo(0);
    expect(selected.evidence.provenance[0]).toMatchObject({id: 'synthetic', revision: 'fixture', sha256: 'a'.repeat(64)});
    expect(selected).toMatchObject({build, evidence: {revision: 'synthetic-test-v1'}});
    const unknown = choosePrefireEncounter(catalog, route, () => 0, {build, context: {equipment: 'pistols'}});
    expect(unknown).toMatchObject({mode: 'authored-coverage', fallbackReason: 'low-support', evidence: {trainObservations: 0, totalVariation: null}});
    expect(choosePrefireEncounter(catalog, route, () => 0, {build, context: {side: 't'}}).fallbackReason).toBe('context-conflict');
    const withoutArrival = {...catalog, encounters: {...catalog.encounters!, sources: catalog.encounters!.sources.map(source =>
      ({...source, fields: {side: 'side', phase: 'phase', equipment: 'equipment'}})),
    observations: catalog.encounters!.observations.map(row => ({...row, context: {side: row.context.side, phase: row.context.phase, equipment: row.context.equipment}}))}};
    expect(choosePrefireEncounter(withoutArrival, route, () => 0, {build, context: {arrival: 'opening'}}))
      .toMatchObject({fallbackReason: 'unsupported-context', unavailableFields: ['arrival']});
  });
  it('keeps no-data and low-data fallback authored, whole-roster and explicitly unmeasured', () => {
    const {catalog, route, build, evidence} = encounterFixture();
    const lineups = [{id: 'left', name: 'Left', angles: route.angles.slice(0, 2)}, {id: 'right', name: 'Right', angles: route.angles.slice(2)}];
    const expanded = {...route, lineups};
    for (let seed = 0; seed < 20; seed++) {
      const selected = choosePrefireEncounter({...catalog, routes: [expanded], encounters: undefined}, expanded, randomStream(seed, 'fallback'), {build});
      expect(selected.mode).toBe('authored-coverage'); expect(selected.label).toContain('not measured');
      expect(['a0,a1,a2,a3', 'a0,a1', 'a2,a3']).toContain(selected.angles.map(angle => angle.id).join(','));
      expect(selected.evidence.confidence).toBe('unknown');
    }
    const sparse = {...evidence, observations: evidence.observations.filter(row => +row.roundId === 0)};
    expect(choosePrefireEncounter({...catalog, encounters: sparse}, route, () => 0, {build}).fallbackReason).toBe('low-support');
    expect(() => authoredEncounterCoverage({...route, angles: [{...route.angles[0]}, {...route.angles[0], id: 'overlap'}]}, () => 0)).toThrow('No compatible');
  });
  it('keeps heldout matches out of fitting and detects unseen setups, leakage and repeats', () => {
    const {evidence, catalog, route, build} = encounterFixture();
    const changed = {...evidence, observations: evidence.observations.map(row => evidence.split.heldoutMatches.includes(row.matchId)
      ? {...row, members: [row.members[0]]} : row)};
    const report = validateHeldoutEncounters(changed, route.id);
    expect(report.totalVariation).toBe(1); expect(report.unseenSetupShare).toBe(1);
    expect([...report.distribution.keys()]).toEqual([...validateHeldoutEncounters(evidence, route.id).distribution.keys()]);
    expect(choosePrefireEncounter({...catalog, encounters: changed}, route, () => 0, {build}).fallbackReason).toBe('heldout-failed');
    expect(validateEncounterEvidence({...evidence, split: {...evidence.split, heldoutMatches: ['match-0', 'match-3', 'match-4']}}, catalog, build).join(' ')).toContain('leaking');
    expect(validateEncounterEvidence({...evidence, observations: [...evidence.observations, {...evidence.observations[0], id: 'repeat'}]}, catalog, build).join(' ')).toContain('duplicate');
  });
  it('retains zero-defender observations instead of inventing a minimum enemy count', () => {
    const {evidence, catalog, route, build} = encounterFixture();
    const empty = {...evidence, observations: evidence.observations.map(row => ({...row, members: []}))};
    expect(validateEncounterEvidence(empty, catalog, build)).toEqual([]);
    expect(choosePrefireEncounter({...catalog, encounters: empty}, route, () => 0, {build})).toMatchObject({mode: 'contextual-evidence', angles: []});
    const unproven = {...empty, observations: empty.observations.map(row => ({...row, snapshotProof: undefined}))};
    expect(validateEncounterEvidence(unproven as unknown as typeof evidence, catalog, build).join(' ')).toContain('complete snapshot/arrival proof');
  });
  it('does not equate raw round counts with independent match support', () => {
    const {evidence} = encounterFixture(), a = evidence.observations[0], b = evidence.observations[1];
    const rows: EncounterObservation[] = [a, {...a, roundId: 'second'}, {...b, matchId: 'another'}];
    const distribution = jointSetupDistribution(rows);
    expect(distribution.get(encounterSignature(a))?.weight).toBe(.5);
    expect(distribution.get(encounterSignature(b))?.weight).toBe(.5);
  });
  it('rejects stale builds, unsupported metadata, unmapped pockets, malformed inputs and incomplete teams', () => {
    const {evidence, catalog, route, build} = encounterFixture();
    expect(choosePrefireEncounter(catalog, route, () => 0, {build: {...build, gameBuild: 'changed'}}).fallbackReason).toBe('invalid-evidence');
    expect(validateEncounterEvidence({...evidence, sources: []}, catalog, build).length).toBeGreaterThan(0);
    expect(validateEncounterEvidence({...evidence, observations: [{...evidence.observations[0], complete: false} as unknown as EncounterObservation]}, catalog, build).join(' ')).toContain('incomplete');
    expect(validateEncounterEvidence({...evidence, pockets: []}, catalog, build).join(' ')).toContain('pocket');
    const incompatible = {...evidence, observations: evidence.observations.map(row => ({...row,
      members: row.members.map(member => ({...member, observedFeet: [32, 0, 0] as const}))}))};
    expect(validateEncounterEvidence(incompatible, catalog, build).join(' ')).toContain('incompatible');
    expect(validateEncounterEvidence({} as typeof evidence, catalog, build)).toContain('Malformed encounter evidence structure.');
    const restricted = {...evidence, sources: evidence.sources.map(source => ({...source, rights: {...source.rights, status: 'restricted' as const}}))};
    expect(choosePrefireEncounter({...catalog, encounters: restricted}, route, () => 0, {build}).fallbackReason).toBe('rights-not-approved');
  });
  it('requires a raw-foot physical corridor, rejecting same-radius observations across a thin wall', () => {
    const {evidence, catalog, route, build} = encounterFixture();
    const wall = {center: {x: 0, y: 128 * UNIT, z: 0}, size: {x: 4 * UNIT, y: 256 * UNIT, z: 400 * UNIT}};
    const collision = {fits: (p: Vec, feet: number, height: number) => fitsHull(p, feet, height, [wall]),
      sweep: (a: Vec, b: Vec, height: number) => sweepHull(a, b, height, [wall]),
      vertical: (p: Vec, a: number, b: number, height: number) => verticalContact(p, a, b, height, [wall], 0),
      ray: () => undefined} as unknown as NativeMapCollision;
    const rows = evidence.observations.map(row => ({...row, members: row.members.map(member => member.angleId === 'a0'
      ? {...member, observedFeet: [-32, 0, 0] as const} : member)}));
    const wrong = {...evidence, observations: rows};
    expect(validateEncounterEvidence(wrong, catalog, build, (member, _pocket, approach: PrefireRoute) => {
      const angle = approach.angles.find(angle => angle.id === member.angleId)!;
      return auditHoldPocket(collision, member.observedFeet, angle.position) === 'accepted-local';
    }).join(' ')).toContain('raw-foot pocket');
    expect(route.angles[0].position).toEqual([32, 0, 0]);
  });
});
