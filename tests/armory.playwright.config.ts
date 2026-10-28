import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import base from '../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: ['armory-ui.spec.ts', 'cosmetic-collection.spec.ts', 'arsenal-progression.spec.ts', 'weapon-effects.spec.ts', 'achievements.spec.ts', 'loadout-changelog.spec.ts'],
  use: {...base.use, baseURL: 'http://127.0.0.1:5184'},
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
    reuseExistingServer: true,
  },
});
