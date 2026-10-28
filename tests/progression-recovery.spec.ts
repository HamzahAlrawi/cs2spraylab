import {readFileSync} from 'node:fs';
import {expect, test, type Page} from '@playwright/test';

const gift = 'SPRAYLAB-L50-045794E5F92C1EAF';
const key = 'spraylab.progression.v1';
async function boot(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'guided', volume: 0, quality: 'performance', protectShortcuts: false}));
    localStorage.setItem('spraylab.settingsHint.v1', 'seen');
  });
  await page.goto('/'); await expect(page.locator('canvas[data-range]')).toBeVisible();
}
async function account(page: Page) {
  await page.getByRole('button', {name: /Open armory/}).click();
  await page.locator('.progression-save-gifts > summary').click();
  await expect(page.getByLabel('Gift code', {exact: true})).toBeEnabled();
}
async function redeem(page: Page, code = gift) {
  await page.getByLabel('Gift code', {exact: true}).fill(code);
  await page.getByRole('button', {name: 'Redeem', exact: true}).click();
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);

test('level-50 gift, duplicate protection and downloaded backup import work on desktop and mobile', async ({page}, info) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await boot(page); await account(page);
  await redeem(page, 'wrong-code'); await expect(page.locator('.progression-save-status')).toContainText('invalid');
  await redeem(page); await expect(page.locator('.progression-save-status')).toContainText('72,761 credits. Level 50.');
  expect(await saved(page)).toMatchObject({xp: 91385, balance: 72761, completedDuels: 0, completedDrills: 0});
  await redeem(page); await expect(page.locator('.progression-save-status')).toContainText('already been redeemed');
  const download = page.waitForEvent('download'); await page.getByRole('button', {name: 'Export backup', exact: true}).click();
  const file = await download, bytes = readFileSync((await file.path())!);
  expect(file.suggestedFilename()).toMatch(/^spraylab-progress-.*\.json$/);
  expect(JSON.parse(bytes.toString()).copy.profile.redeemedGifts).toContain('recovery-level50-20261028');
  // Simulate complete site-data removal, not just the disposable map cache.
  await page.evaluate(async key => {
    for (const item of Object.keys(localStorage)) if (item.startsWith(key)) localStorage.removeItem(item);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('spraylab-profile-backups-v1');
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('Profile database was left open'));
    });
  }, key);
  await page.reload(); await account(page);
  await expect(page.locator('.progression-level-label')).toContainText('Level 1');
  await page.locator('.progression-save-gifts input[type=file]').setInputFiles({name: 'progress.json', mimeType: 'application/json', buffer: bytes});
  await expect(page.getByRole('button', {name: 'Replace progress', exact: true})).toBeVisible();
  await expect(page.locator('.progression-level-label')).toContainText('Level 1');
  await page.getByRole('button', {name: 'Replace progress', exact: true}).click();
  await expect(page.locator('.progression-save-status')).toContainText('Progress restored. Level 50.');
  expect((await saved(page)).balance).toBe(72761);
  await redeem(page); await expect(page.locator('.progression-save-status')).toContainText('already been redeemed');
  const overflow = await page.locator('.progression-armory').evaluate(node => node.scrollWidth > node.clientWidth + 1);
  expect(overflow).toBe(false); expect(errors).toEqual([]);
  await page.screenshot({path: `research/progress-gifts-${info.project.name}.png`});
});

test('separate profile database restores cleared localStorage and rotating copies restore a damaged primary', async ({page}) => {
  await boot(page); await account(page); await redeem(page);
  await expect(page.locator('.progression-save-status')).toContainText('Gift redeemed');
  await page.evaluate(key => {for (const item of Object.keys(localStorage)) if (item.startsWith(key)) localStorage.removeItem(item);}, key);
  await page.reload(); await account(page);
  await expect(page.locator('.progression-level-label')).toContainText('Level 50');
  expect((await saved(page)).balance).toBe(72761);
  await page.evaluate(key => localStorage.setItem(key, '{corrupted'), key);
  await page.reload(); await account(page);
  await expect(page.locator('.progression-level-label')).toContainText('Level 50');
  expect(await page.evaluate(key => localStorage.getItem(`${key}.corrupt`), key)).toBe('{corrupted');
  await redeem(page); await expect(page.locator('.progression-save-status')).toContainText('already been redeemed');
});

test('an already open second tab sees the new save and cannot redeem the same gift twice', async ({page, context}) => {
  await boot(page); const second = await context.newPage(); await boot(second);
  await account(page); await account(second);
  await redeem(page); await expect(page.locator('.progression-save-status')).toContainText('Gift redeemed');
  await expect(second.locator('.progression-level-label')).toContainText('Level 50');
  await redeem(second); await expect(second.locator('.progression-save-status')).toContainText('already been redeemed');
  expect((await saved(second)).balance).toBe(72761); await second.close();
});

test('persistent storage request reports denial honestly without breaking gifts or backup export', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persisted', {value: async () => false});
    Object.defineProperty(navigator.storage, 'persist', {value: async () => false});
  });
  await boot(page); await account(page);
  await page.getByRole('button', {name: 'Request persistent storage', exact: true}).click();
  await expect(page.locator('.progression-save-persistence')).toContainText('not granted');
  await redeem(page); await expect(page.locator('.progression-save-status')).toContainText('Gift redeemed');
});

test('profile database transactions protect unknown future formats even when the incoming revision is newer', async ({page}) => {
  await boot(page);
  const results = await page.evaluate(async () => {
    const path = '/src/range/progression-persistence.ts';
    const {browserProfileMirror, profileCopy} = await import(/* @vite-ignore */ path);
    const key = 'future-format-test';
    const transaction = async (write?: any) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('spraylab-profile-backups-v1', 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {return await new Promise<any>((resolve, reject) => {
        const tx = db.transaction('profiles', write ? 'readwrite' : 'readonly'), store = tx.objectStore('profiles');
        const request = write ? store.put(write, key) : store.get(key);
        let result: any; request.onsuccess = () => {result = request.result;};
        tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error);
      });} finally {db.close();}
    };
    const original = profileCopy({version: 2, xp: 185}, 1), results = [];
    for (const future of [{...original, version: 2}, profileCopy({version: 999, xp: 10000}, 1)]) {
      await transaction(future);
      const accepted = await browserProfileMirror(key)!.write(profileCopy({version: 2, xp: 0}, Date.now()));
      results.push({accepted, unchanged: JSON.stringify(await transaction()) === JSON.stringify(future)});
    }
    return results;
  });
  expect(results).toEqual([{accepted: false, unchanged: true}, {accepted: false, unchanged: true}]);
});

test('quota failure shows a visible warning and leaves the gift usable after storage is restored', async ({page}) => {
  await boot(page); await account(page);
  await page.evaluate(key => {
    const set = Storage.prototype.setItem;
    (window as any).progressionOriginalSetItem = set;
    Storage.prototype.setItem = function(name, value) {
      if (name.startsWith(key)) throw new DOMException('Test storage full', 'QuotaExceededError');
      return set.call(this, name, value);
    };
  }, key);
  await redeem(page); await expect(page.locator('.progression-save-status')).toContainText('Gift not redeemed');
  await expect(page.locator('.progression-level-label')).toContainText('Level 1');
  await page.getByRole('button', {name: 'Close armory', exact: true}).click();
  await expect(page.locator('.progression-storage-banner')).toContainText('Progress is not being saved');
  await page.evaluate(() => {Storage.prototype.setItem = (window as any).progressionOriginalSetItem;});
  await account(page); await redeem(page);
  await expect(page.locator('.progression-save-status')).toContainText('Gift redeemed');
  expect((await saved(page)).balance).toBe(72761);
  await page.getByRole('button', {name: 'Close armory', exact: true}).click();
  await expect(page.locator('.progression-storage-banner')).toHaveCount(0);
});
