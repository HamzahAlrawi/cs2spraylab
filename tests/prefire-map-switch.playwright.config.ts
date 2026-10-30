import {defineConfig, devices} from '@playwright/test';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  testDir: '.', testMatch: 'prefire-map-switch.spec.ts', timeout: 30000, workers: 1,
  outputDir: '../node_modules/.cache/prefire-map-switch-results',
  metadata: {prefireMapSwitchFixture: true},
  use: {baseURL: 'http://127.0.0.1:5198'},
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome'], channel: 'chromium'}}],
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'node tests/prefire-map-switch-server.mjs',
    url: 'http://127.0.0.1:5198/tests/prefire-map-switch-host.html', reuseExistingServer: false,
  },
});
