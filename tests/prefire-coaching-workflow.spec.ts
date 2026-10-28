import {expect, test} from '@playwright/test';

test('validated map setup selection and saved-angle retry remain separate from route records', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Native geometry workflow'); test.setTimeout(150000);
  const route = {id: 'long-doors'}, angle = {id: 'openprefire:a_long/2', name: 'Long doors corner'};
  const summary = {score: 0, focus: angle.name, evidence: 'The opening shot was moving.', action: 'Brake before firing.',
    goal: 'Repeat a settled opening.', confidence: 'Test fixture: one measured opening.', metrics: [
      {label: 'Settled openings', score: 0, value: 'No', detail: 'Opening velocity'}]};
  await page.addInitScript(({routeId, angleId, summary}) => {
    localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'}));
    localStorage.setItem('spraylab.prefire.angles.v1', JSON.stringify([{id: 'workflow-fixture', key: 'fixture', routeId, angleId,
      date: '2026-10-16T00:00:00.000Z', scope: 'route', cleared: false, summary}]));
  }, {routeId: route.id, angleId: angle.id!, summary});
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
    const {DuelEngine} = await import(/* @vite-ignore */ path), tick = DuelEngine.prototype.tick;
    DuelEngine.prototype.tick = function(time: number) {(window as any).prefireWorkflowQA = this; return tick.call(this, time);};
  });
  await page.getByLabel('Training mode').selectOption('prefire');
  await expect(page.getByLabel('Prefire route')).toBeVisible({timeout: 90000});
  await page.getByRole('radio', {name: 'Setups', exact: true}).check();
  await page.locator('summary').filter({hasText: /^Encounter options/}).click();
  await expect(page.getByLabel('Encounter evidence')).toContainText('Authored defender setups');
  await expect.poll(() => page.evaluate(() => (window as any).prefireWorkflowQA?.sim.encounter?.mode)).toBe('authored-coverage');
  const roster = await page.evaluate(() => {const e = (window as any).prefireWorkflowQA; return {actors: e.sim.actors.length - 1, selected: e.sim.selectedAngles.length};});
  expect(roster.actors).toBe(roster.selected); expect(roster.actors).toBeLessThanOrEqual(5);
  await page.locator('summary').filter({hasText: /^Run review/}).click();
  await page.getByText('Aim & engagement metrics', {exact: true}).click();
  const aimProfile = page.getByRole('region', {name: 'Aim skill profile'});
  await expect(aimProfile).toBeVisible();
  await expect(aimProfile.getByText('Reaction (input estimate)', {exact: true})).toBeVisible();
  await expect(aimProfile.getByText('Time to kill', {exact: true})).toBeVisible();
  await expect(aimProfile).toContainText('not a Leetify rating');
  await page.getByText('Saved angle diagnoses (1)', {exact: true}).click();
  await page.locator('.prefire-angle-review').filter({has: page.getByText('Saved angle diagnoses (1)', {exact: true})}).getByRole('button', {name: 'Practice this · 3 reps', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Practice block'})).toContainText('0 of 3 reps');
  await expect.poll(() => page.evaluate(() => (window as any).prefireWorkflowQA?.sim.actors.length)).toBe(2);
  const isolated = await page.evaluate(() => {
    const e = (window as any).prefireWorkflowQA;
    e.sim.phase = 'result'; e.sim.outcome = 'won'; e.report();
    return {retry: !!e.scenario.retry, start: e.sim.route.startLabel, result: e.scenario.report(e.sim).progress.attempts,
      xpAttempt: e.xpAttempt, stored: JSON.parse(localStorage.getItem('spraylab.prefire.history.v1') || '[]').length};
  });
  expect(isolated.retry).toBe(true); expect(isolated.start).toContain('Validated covered');
  expect(isolated.result).toBe(0); expect(isolated.stored).toBe(0); expect(isolated.xpAttempt).toBeNull();
  await page.getByRole('button', {name: 'End practice block'}).click();
  await expect(page.getByRole('region', {name: 'Practice block'})).toHaveCount(0);
  await expect(page.getByRole('radio', {name: 'Setups', exact: true})).toBeChecked();
  expect(errors).toEqual([]);
});
