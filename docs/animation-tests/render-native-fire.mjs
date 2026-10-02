import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const ids = Object.keys(JSON.parse(fs.readFileSync('src/range/game-data.json')).weapons);
const legacy = [...new Set(JSON.parse(fs.readFileSync('src/range/cosmetics-data.json')).cosmetics
  .map(item => item.assetKey).filter(key => key?.endsWith('-legacy')))];
const server = await createServer({server:{host:'127.0.0.1',port:0,strictPort:true},logLevel:'error'});
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({headless:true});
const output = 'research/fire-animation-audit/screenshots'; fs.mkdirSync(output,{recursive:true});
const records = [];
try {
  for (const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]) {
    const page = await browser.newPage({viewport});
    const errors = []; page.on('pageerror',error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/docs/animation-tests/fire-preview.html`);
    await page.waitForFunction(() => window.fireAudit);
    for (const assetKey of [...ids,...legacy]) {
      const loaded = await page.evaluate(key => window.fireAudit.load(key),assetKey);
      assert.ok(loaded.colors > 100 && loaded.drawCalls > 0,`${label}/${assetKey}: blank idle`);
      for (const action of loaded.actions) {
        const before = await page.evaluate(name => window.fireAudit.sample(name,0),action);
        const after = await page.evaluate(name => window.fireAudit.sample(name,.2),action);
        assert.ok(after.colors > 100 && after.drawCalls > 0,`${label}/${assetKey}/${action}: blank fire`);
        assert.notEqual(before.hash,after.hash,`${label}/${assetKey}/${action}: no visible motion`);
        records.push({viewport:label,assetKey,action,colors:after.colors,drawCalls:after.drawCalls});
      }
      if (['ak47','usp','elite','awp','sg553','sg553-legacy'].includes(assetKey)) {
        await page.screenshot({path:`${output}/${label}-${assetKey}.png`});
      }
    }
    assert.deepEqual(errors,[],`${label}: browser errors`); await page.close();
  }
  fs.writeFileSync(`${output}/render-results.json`,JSON.stringify(records,null,2) + '\n');
  console.log(`Verified ${records.length} native firing renders across desktop/mobile; ${ids.length + legacy.length} assemblies.`);
} finally {await browser.close(); await server.close();}
