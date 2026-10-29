import {defineConfig,devices} from '@playwright/test';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  testDir:'.',testMatch:'duel-radar-overhaul.spec.ts',workers:1,timeout:60000,
  outputDir:'../test-results-radar-overhaul',expect:{timeout:15000},
  use:{baseURL:'http://127.0.0.1:5191',screenshot:'only-on-failure',trace:'retain-on-failure'},
  projects:[
    {name:'chromium',use:{...devices['Desktop Chrome'],channel:'chromium',viewport:{width:1440,height:1000}}},
    {name:'mobile-chromium',use:{...devices['Pixel 7'],channel:'chromium'}},
    {name:'firefox',use:{...devices['Desktop Firefox']}},
    {name:'webkit',use:{...devices['Desktop Safari']}}
  ],
  webServer:{cwd:fileURLToPath(new URL('..',import.meta.url)),
    command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5191 --strictPort',
    url:'http://127.0.0.1:5191',reuseExistingServer:false}
});
