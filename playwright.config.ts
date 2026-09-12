import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: './tests', timeout: 60000, expect: { timeout: 15000 }, workers: 1,
  use: { baseURL: 'http://localhost:5176', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], channel: 'chromium' } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
    ...(['brave', 'opera-gx'] as const).filter(name => existsSync(`.local-tools/${name}/${name === 'brave' ? 'brave' : 'opera'}.exe`)).map(name => ({ name,
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: resolve(`.local-tools/${name}/${name === 'brave' ? 'brave' : 'opera'}.exe`) } }
    }))
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5176 --strictPort', url: 'http://localhost:5176', reuseExistingServer: true }
});
