import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {splitEncounterMatches, verifyEncounterArtifacts} from '../validate-prefire-evidence.mjs';
import {createPrefireAuthoringRegistry} from '../prefire-map-adapters.mjs';
import {writePrefireAuthoringPreview} from '../prefire-authoring-preview.mjs';

test('match split is seeded, order-independent, disjoint and never splits rounds', () => {
  const rows = Array.from({length: 20}, (_, i) => ({matchId: `match-${i % 5}`, round: i}));
  const split = splitEncounterMatches(rows, 'frozen');
  assert.deepEqual(split, splitEncounterMatches(rows.toReversed(), 'frozen'));
  assert.equal(split.trainMatches.some(id => split.heldoutMatches.includes(id)), false);
  assert.equal(new Set([...split.trainMatches, ...split.heldoutMatches]).size, 5);
  assert.throws(() => splitEncounterMatches(rows, ''));
  assert.throws(() => splitEncounterMatches(rows, 'seed', 1));
});

test('content-hash source and raw-foot proof gate rejects stale, forged and changed observations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prefire-evidence-'));
  try {
    const put = (name, content) => {fs.writeFileSync(path.join(root, name), content); return createHash('sha256').update(content).digest('hex');};
    const sourceSha256 = put('source.json', '{}'), extractorSha256 = put('extractor.mjs', '// fixture only');
    const geometrySha256 = 'a'.repeat(64);
    const member = {actorId: 'actor', angleId: 'hold', pocketId: 'pocket', observedFeet: [32, 0, 0], crouched: false};
    const row = {id: 'row', sourceId: 'source', matchId: 'match', roundId: '1', routeId: 'entry', tick: 100,
      context: {side: 'ct', phase: 'preplant'}, members: [member]};
    const reportSha256 = put('proof.json', JSON.stringify({schemaVersion: 1, geometrySha256, records: [{...member,
      sourceId: row.sourceId, matchId: row.matchId, roundId: row.roundId, tick: row.tick, status: 'accepted-local', sourceSha256, extractorSha256}]}));
    member.pocketProof = {reportSha256};
    const build = {mapId: 'synthetic', catalogRevision: 'fixture', gameBuild: 'test', geometrySha256};
    const snapshot = {sourceId: row.sourceId, matchId: row.matchId, roundId: row.roundId, routeId: row.routeId,
      tick: row.tick, context: row.context, sourceSha256, extractorSha256,
      arrivalEvent: {tick: row.tick, definition: 'Synthetic first approach crossing', approachingActorId: 'attacker'},
      defenders: [{actorId: member.actorId, alive: true, member},
        ...Array.from({length: 4}, (_, i) => ({actorId: `dead-${i}`, alive: false}))]};
    const snapshotSha256 = put('snapshot.json', JSON.stringify({schemaVersion: 1, build, snapshots: [snapshot]}));
    row.snapshotProof = {method: 'complete-defender-snapshot-v1', reportSha256: snapshotSha256};
    const evidence = {build, sources: [{id: 'source', sha256: sourceSha256, extractor: {sha256: extractorSha256}}],
      pockets: [{reportSha256}], observations: [row]};
    const artifacts = {[sourceSha256]: 'source.json', [extractorSha256]: 'extractor.mjs', [reportSha256]: 'proof.json', [snapshotSha256]: 'snapshot.json'};
    assert.deepEqual(verifyEncounterArtifacts(evidence, artifacts, root), []);
    const original = structuredClone(row);
    row.members = [];
    assert.match(verifyEncounterArtifacts(evidence, artifacts, root).join(' '), /live defender/);
    Object.assign(row, structuredClone(original));
    for (const change of [s => {s.tick++;}, s => {s.arrivalEvent.tick++;}, s => {s.defenders.pop();},
      s => {s.defenders[1].alive = true;}, s => {s.context.phase = 'postplant';}, s => {s.sourceSha256 = 'c'.repeat(64);}]) {
      const changed = structuredClone(snapshot); change(changed);
      const sha = put('changed.json', JSON.stringify({schemaVersion: 1, build, snapshots: [changed]}));
      row.snapshotProof.reportSha256 = sha;
      assert.match(verifyEncounterArtifacts(evidence, {...artifacts, [sha]: 'changed.json'}, root).join(' '), /complete snapshot/);
    }
    row.snapshotProof.reportSha256 = snapshotSha256;
    member.observedFeet = [-32, 0, 0];
    row.members = [member];
    assert.match(verifyEncounterArtifacts(evidence, artifacts, root).join(' '), /raw-foot proof/);
    fs.writeFileSync(path.join(root, 'source.json'), '{"changed":true}');
    assert.match(verifyEncounterArtifacts(evidence, artifacts, root).join(' '), /checksum mismatch/);
    assert.match(verifyEncounterArtifacts(evidence, {}, root).join(' '), /missing artifact/);
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test('empty rosters require all five recorded dead states, not a self-declared complete flag', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prefire-empty-'));
  try {
    const artifacts = {};
    const put = (name, value) => {
      const content = JSON.stringify(value), sha = createHash('sha256').update(content).digest('hex');
      fs.writeFileSync(path.join(root, name), content); artifacts[sha] = name; return sha;
    };
    const sourceSha256 = put('source.json', {synthetic: true}), extractorSha256 = put('extractor.json', {fixture: true});
    const build = {mapId: 'synthetic', catalogRevision: 'fixture', gameBuild: 'test', geometrySha256: 'a'.repeat(64)};
    const row = {id: 'empty', sourceId: 'source', matchId: 'match', roundId: '1', routeId: 'entry', tick: 100, context: {side: 'ct'}, members: []};
    const snapshot = {...row, sourceSha256, extractorSha256,
      arrivalEvent: {tick: 100, definition: 'Synthetic arrival', approachingActorId: 'attacker'},
      defenders: Array.from({length: 5}, (_, i) => ({actorId: `dead-${i}`, alive: false}))};
    const sha = put('snapshots.json', {schemaVersion: 1, build, snapshots: [snapshot]});
    row.snapshotProof = {method: 'complete-defender-snapshot-v1', reportSha256: sha};
    const evidence = {build, sources: [{id: 'source', sha256: sourceSha256, extractor: {sha256: extractorSha256}}], pockets: [], observations: [row]};
    assert.deepEqual(verifyEncounterArtifacts(evidence, artifacts, root), []);
    snapshot.defenders[0].alive = true;
    row.snapshotProof.reportSha256 = put('unmapped.json', {schemaVersion: 1, build, snapshots: [snapshot]});
    assert.match(verifyEncounterArtifacts(evidence, artifacts, root).join(' '), /live defender/);
    delete row.snapshotProof;
    assert.match(verifyEncounterArtifacts(evidence, artifacts, root).join(' '), /snapshot/);
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test('authoring registry adds next maps without changing shared commands', async () => {
  const registry = createPrefireAuthoringRegistry([{id: 'next', load: async () => ({catalog: {id: 'next', revision: 'v1'},
    build: {mapId: 'next', catalogRevision: 'v1'}})}]);
  assert.deepEqual(registry.ids(), ['next']);
  assert.equal((await registry.load('next', {})).catalog.id, 'next');
  await assert.rejects(registry.load('de_dust2', {}), /Unknown/);
  assert.throws(() => registry.register({id: 'next', load() {}}), /duplicate/);
});

test('read-only authoring preview escapes catalog strings and includes route playback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prefire-preview-'));
  try {
    const output = path.join(root, 'preview.html');
    writePrefireAuthoringPreview(output, {build: {mapId: 'synthetic'}}, [{id: 'route', name: '</script><script>bad()</script>',
      spawn: [0, 0, 0], path: [[32, 0, 0]], angles: [{id: 'hold', name: 'Hold', position: [64, 0, 0]}]}]);
    const html = fs.readFileSync(output, 'utf8');
    assert.equal(html.includes('</script><script>bad()'), false);
    assert.match(html, /requestAnimationFrame/); assert.match(html, /Route progress/);
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});
