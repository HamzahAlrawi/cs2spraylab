import {expect, test} from '@playwright/test';

test('scorecard keeps measured, legacy and incomplete feedback readable at panel widths', async ({page}, info) => {
  await page.addInitScript(() => localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance'})));
  await page.goto(process.env.SCORECARD_AUDIT_URL ?? '/');
  await expect(page.locator('canvas[data-duel]')).toBeVisible();
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite-dev/deps/react.js', rootPath = '/node_modules/.vite-dev/deps/react-dom_client.js';
    const cardPath = '/src/range/duel/DuelScorecard.tsx', coachPath = '/src/range/duel/coaching.ts';
    const simPath = '/src/range/duel/simulation.ts';
    const react = await import(/* @vite-ignore */ reactPath), roots = await import(/* @vite-ignore */ rootPath);
    const createElement = react.createElement ?? react.default.createElement, createRoot = roots.createRoot ?? roots.default.createRoot;
    const {DuelScorecard} = await import(/* @vite-ignore */ cardPath);
    const {DuelCoach} = await import(/* @vite-ignore */ coachPath);
    const {DuelSimulation} = await import(/* @vite-ignore */ simPath);
    const coach = new DuelCoach(), self = {...new DuelSimulation().snapshot()[0], position: {x: 0, y: 1.6, z: 0},
      yaw: 0, pitch: 0, grounded: true, velocity: {x: 0, z: 0}};
    const point = {x: 0, y: 1.6, z: -20};
    coach.observe(1, self, [{id: 1, position: point, aimPoint: point, headPoint: point}]);
    coach.shot(self, 1, 1);
    coach.shotEvidence(1, {aimOnTarget: true, rayOnTarget: true, stoppedByCover: false, recoilDegrees: 0, recovering: false});
    coach.hit({kind: 'hit', tick: 1, shooter: 0, victim: 1, shotId: 1, group: 'head', point,
      healthDamage: 40, armorDamage: 0, lethal: false}, 1.2);
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div'); host.className = 'duel-controls-body';
    host.style.cssText = `width:${Math.min(innerWidth, 264)}px;background:#222c27;min-height:100vh;`;
    document.body.appendChild(host);
    const root = createRoot(host), review = coach.review();
    const history = [{date: '2026-10-10T10:00:00Z', outcome: 'won', review}];
    (window as any).scorecardAudit = {
      current: () => root.render(createElement(DuelScorecard, {review, history})),
      mistakes: () => {
        const c = new DuelCoach(), moving = {...self, velocity: {x: 5.08, z: 0}};
        for (let i = 0; i < 9; i++) {
          c.observe(1 + i * .1, moving, [{id: 1, position: point, aimPoint: point, headPoint: point}]);
          c.shot(moving, i + 1, 1 + i * .1);
          c.shotEvidence(i + 1, {aimOnTarget: i < 3, rayOnTarget: i < 3, stoppedByCover: false, recoilDegrees: i, recovering: true});
          if (i < 3) c.hit({kind: 'hit', tick: 1, shotId: i + 1, shooter: 0, victim: 1, group: 'chest', point,
            healthDamage: 20, armorDamage: 0, lethal: false}, 1 + i * .1);
        }
        const mistakes = c.review();
        (window as any).scorecardAudit.expectedActions = mistakes.debrief!.findings.map(finding => finding.action);
        root.render(createElement(DuelScorecard, {review: mistakes, history: []}));
      },
      profile: () => {
        const key = `setup-v2:${'a'.repeat(32)}`, other = `setup-v2:${'b'.repeat(32)}`;
        const aim = {version: 1, weapons: ['ak47'], counts: {encounters: 6, damaged: 6, killed: 3, shots: 40, hits: 12,
          headHits: 1, headEligibleHits: 12, rifleShots: 40, stoppedRifleShots: 15, sprayShots: 30, sprayHits: 8,
          reactionExcluded: 1, reactionUnmeasured: 0}, measurements: {firstShot: [300, 300, 300, 300, 300, 300],
          reaction: [200, 210, 220, 230, 240], damage: [700, 750, 800, 750, 700, 750],
          kill: [900, 950, 1000], damageToKill: [200, 200, 250], correction: [10, 10, 10, 10, 10, 10]}};
        const current = {...review, aim};
        const previous = Array.from({length: 9}, (_, i) => ({date: `2026-10-${20-i}T10:00:00Z`, outcome: 'won', setupKey: key,
          review: {...review, aim: {...review.aim}}}));
        root.render(createElement(DuelScorecard, {review: current, setupKey: key, history: [
          {date: '2026-10-24T10:00:00Z', outcome: 'won', review: current, setupKey: key},
          {date: '2026-10-23T10:00:00Z', outcome: 'won', review: {...current, aim: {...aim, counts: {...aim.counts, encounters: 999}}}, setupKey: other},
          ...previous]}));
      },
      legacy: () => root.render(createElement(DuelScorecard, {review: new DuelCoach().review(), history: [{...history[0],
        review: {...review, coaching: undefined, message: 'Stop before shooting', tip: 'Settle before the first shot.'}}]})),
      incomplete: () => root.render(createElement(DuelScorecard, {review: {shots: 2, score: NaN,
        coaching: {focus: 'undefined', action: '[object Object]', metrics: [null]}},
        history: [{date: 'bad-date', outcome: 'undefined', review: {shots: 2}}]})),
    };
    (window as any).scorecardAudit.current();
  });
  const card = page.getByRole('region', {name: 'Duel scorecard'});
  const advanced = card.locator(':scope > details').filter({has: page.locator(':scope > summary', {hasText: 'Advanced details'})});
  const history = card.locator(':scope > details').filter({has: page.locator(':scope > summary', {hasText: 'Recent rounds'})});
  const focus = card.getByRole('region', {name: 'Next practice focus'});
  const headline = card.getByLabel('Round headline stats');
  await expect(card.getByRole('heading', {level: 3})).toHaveText('Duel overview');
  await expect(card.locator(':scope > details')).toHaveCount(2);
  await expect(advanced).not.toHaveAttribute('open');
  await expect(history).not.toHaveAttribute('open');
  await expect(card.getByLabel('Measured skills')).toContainText('Aim');
  await expect(card.getByLabel('Measured skills')).toContainText('Movement');
  await expect(card.getByLabel('Measured skills')).toContainText('Positioning');
  await expect(headline.locator(':scope > div')).toHaveCount(6);
  await expect(headline).toContainText('Opening accuracy');
  await expect(headline).toContainText('n=1 damaged contacts');
  await expect(headline).toContainText('n=0 lethal contacts');
  await expect(card.locator(':scope > .duel-scorecard-confidence')).toContainText('1 measured opening / 1 visible-target shots');
  await expect(card.locator(':scope > .duel-scorecard-confidence')).toContainText('Provisional');
  await expect(card.getByText('Next rep', {exact: true})).toBeVisible();
  await expect(focus).toContainText('Not enough openings to judge consistency.');
  await expect(card.getByText('Local technique score: 100/100', {exact: true})).toBeHidden();
  const aim = card.getByRole('region', {name: 'Aim skill profile'});
  await expect(aim).toBeHidden();
  await expect(card.getByText('35% weight.', {exact: false})).toBeHidden();
  await card.screenshot({path: info.outputPath('current-collapsed.png')});
  await advanced.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(advanced).toHaveAttribute('open');
  await expect(aim).toBeVisible();
  await expect(aim.getByText('Reaction (input estimate)', {exact: true})).toBeVisible();
  await expect(aim.getByText('Time to kill', {exact: true})).toBeVisible();
  await expect(aim).toContainText('not a Leetify rating');
  await expect(advanced.getByText('Contact to first shot', {exact: true}).last()).toBeVisible();
  await expect(card.locator('.duel-scorecard-fights')).toContainText('1/1 hits');
  await expect(card.locator('.duel-scorecard-fights')).toContainText('opening hit');
  await history.locator(':scope > summary').click();
  await expect(card.getByText('Shot timing', {exact: true})).toBeVisible();
  expect(await card.locator('.duel-scorecard-skills>div').first().evaluate(row => getComputedStyle(row).display)).toBe('block');
  expect(await card.locator('.duel-scorecard-skills dd').first().evaluate(row => getComputedStyle(row).whiteSpace)).toBe('normal');
  await card.screenshot({path: info.outputPath('current-expanded.png')});

  const checkTextBounds = async () => {
    const issues = await card.evaluate(element => {
      const bounds = element.getBoundingClientRect(), walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const lines: {text: string; left: number; right: number; top: number; bottom: number}[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent?.trim() || !node.parentElement?.checkVisibility()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) {
          lines.push({text: node.textContent.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom});
        }
      }
      const issues = lines.filter(line => line.left < bounds.left - 1 || line.right > bounds.right + 1).map(line => `Overflow: ${line.text}`);
      for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) {
        if (Math.min(lines[a].right, lines[b].right) - Math.max(lines[a].left, lines[b].left) > 1 &&
          Math.min(lines[a].bottom, lines[b].bottom) - Math.max(lines[a].top, lines[b].top) > 1) {
          issues.push(`Overlap: ${lines[a].text} / ${lines[b].text}`);
        }
      }
      return issues;
    });
    expect(issues).toEqual([]);
  };
  await checkTextBounds();
  const download = page.waitForEvent('download');
  await card.getByRole('button', {name: 'Export duel history'}).click();
  expect((await download).suggestedFilename()).toBe('spraylab-duels.json');

  await card.evaluate(element => element.parentElement!.setAttribute('data-coaching-tips', 'false'));
  await expect(card.getByRole('heading', {level: 3})).toBeVisible();
  await expect(focus.locator('h4')).toBeHidden();
  await expect(card.locator('.duel-scorecard-action')).toBeHidden();
  await expect(card.locator('.duel-scorecard-skills dd>p').first()).toBeHidden();
  await expect(card.locator('.duel-scorecard-stats').first()).toBeVisible();
  await expect(card.getByRole('meter', {name: 'Shot timing practice score'})).toBeVisible();
  await card.evaluate(element => element.parentElement!.removeAttribute('data-coaching-tips'));

  await page.evaluate(() => (window as any).scorecardAudit.mistakes());
  await expect(focus.getByRole('heading', {name: 'Counter-strafe before the first bullet'})).toBeVisible();
  await expect(focus.locator('.duel-scorecard-weakness')).toHaveCount(2);
  await expect(focus).toContainText('200 u/s');
  await expect(focus).toContainText('6/6 later rifle bullets');
  const expectedActions = await page.evaluate(() => (window as any).scorecardAudit.expectedActions as string[]);
  for (const [i, action] of expectedActions.slice(0, 2).entries()) {
    await expect(focus.locator('.duel-scorecard-action').nth(i)).toHaveText(`Try: ${action}`);
  }
  await expect(card).toContainText('Misses: aim / recoil line');
  await checkTextBounds();
  await card.screenshot({path: info.outputPath('specific-fight-evidence.png')});

  await page.evaluate(() => (window as any).scorecardAudit.profile());
  await expect(aim).toContainText('10 same-setup rounds');
  await expect(aim).toContainText('15 contacts');
  await expect(aim.getByLabel('Measured aim weaknesses')).toBeVisible();
  await expect(aim.getByLabel('Measured aim weaknesses')).toContainText('target');
  await aim.getByText('Six-part aim breakdown', {exact: true}).click();
  await expect(aim.getByRole('meter', {name: 'Rifle stop accuracy target score'})).toBeVisible();
  await expect(aim.getByRole('meter', {name: 'Time to damage (<1 s) target score'})).toBeVisible();
  await checkTextBounds();
  await aim.screenshot({path: info.outputPath('aim-profile.png')});
  await card.evaluate(element => element.parentElement!.setAttribute('data-coaching-tips', 'false'));
  await expect(aim.locator('.duel-finding-action').first()).toBeHidden();
  await expect(aim.getByText('Time to kill', {exact: true})).toBeVisible();
  await expect(aim.locator('.duel-aim-measurement').first()).toBeVisible();
  await card.evaluate(element => element.parentElement!.removeAttribute('data-coaching-tips'));

  await advanced.locator(':scope > summary').click();
  await history.locator(':scope > summary').click();
  await expect(aim).toBeHidden();
  await checkTextBounds();

  await page.evaluate(() => (window as any).scorecardAudit.legacy());
  await expect(card).toContainText('Last completed round');
  await expect(card.getByText('Stop before shooting', {exact: true})).toBeHidden();
  await expect(headline).toContainText('40 / 0');
  await advanced.locator(':scope > summary').click();
  await expect(card.getByText('Stop before shooting', {exact: true})).toBeVisible();
  await expect(card.getByText('Settle before the first shot.', {exact: true})).toBeVisible();
  await checkTextBounds();
  await card.screenshot({path: info.outputPath('legacy.png')});

  await page.evaluate(() => (window as any).scorecardAudit.incomplete());
  await expect(card.getByRole('heading', {level: 3})).toHaveText('Duel overview');
  await expect(headline).toContainText('--');
  await history.locator(':scope > summary').click();
  await expect(card).not.toContainText(/NaN|undefined|Infinity|Invalid Date|\[object Object\]/);
  await expect(card).toContainText('Time unavailable');
  await expect(history).toContainText('Round recorded');
  await checkTextBounds();
  await card.screenshot({path: info.outputPath('incomplete.png')});
});
