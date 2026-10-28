import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {movementCli} from '../movement-conformance.mjs';

test('movement CLI keeps synthetic provenance, verifies import evidence and emits a failing report', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-cli-'));
  try {
    const source = path.join(directory, 'reference.json'), imported = path.join(directory, 'imported.json'), output = path.join(directory, 'comparison.json');
    await movementCli(['synthetic', source]);
    const reference = JSON.parse(fs.readFileSync(source));
    assert.equal(reference.provenance.kind, 'synthetic-regression');
    await assert.rejects(movementCli(['import', source, imported, 'package.json']), /SHA-256/);
    await movementCli(['import', source, imported, 'src/range/actor-physics.ts']);
    assert.deepEqual(JSON.parse(fs.readFileSync(imported)), reference);
    const report = await movementCli(['report', imported, output]); assert.equal(report.passed, true);
    assert.match(fs.readFileSync(report.plot, 'utf8'), /synthetic-regression/);
    assert.match(fs.readFileSync(report.plot, 'utf8'), /polyline/);
    reference.scenarios[0].samples[10].eye += 10;
    fs.writeFileSync(imported, JSON.stringify(reference));
    const failed = await movementCli(['report', imported, output]); assert.equal(failed.passed, false);
    assert.ok(failed.scenarios[0].failures.includes('eye/hull'));
    await assert.rejects(movementCli(['report', imported, imported]), /overwrite reference/);
  } finally {
    const resolved = path.resolve(directory), root = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(root) && path.basename(resolved).startsWith('movement-cli-'));
    fs.rmSync(resolved, {recursive: true});
  }
});
