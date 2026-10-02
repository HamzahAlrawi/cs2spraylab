import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';

const rows=JSON.parse(fs.readFileSync('src/range/cosmetics-data.json')).cosmetics.filter(row=>row.equipment==='knife');
const groups=[...new Set(rows.map(row=>row.assetKey))];
const only=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7).split(',');
const output='research/knives/screenshots';fs.mkdirSync(output,{recursive:true});
const vite=await createServer({server:{host:'127.0.0.1',port:5189,strictPort:true},logLevel:'error'});
let browser;
try {
  await vite.listen();browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('http://127.0.0.1:5189/art/knife_preview.html');
  await page.waitForFunction(()=>window.knifeQA);
  const report={models:[],errors};
  for(const key of groups.filter(key=>!only||only.includes(key))) {
    const item=rows.find(row=>row.assetKey===key&&/doppler_phase2|aa_fade/.test(row.kitName??''))??rows.find(row=>row.assetKey===key);
    const result=await page.evaluate(id=>window.knifeQA.load(id),item.id);
    assert.ok(result.visible>1000,`${key}: blank native idle view`);
    const actions={};
    for(const name of ['draw','inspect','fire','fire-alt']) {
      actions[name]=await page.evaluate(name=>window.knifeQA.frame(name,.5),name);
      assert.ok(actions[name].visible>300,`${key}: blank ${name}`);
    }
    await page.evaluate(()=>window.knifeQA.frame('inspect',.35));
    await page.screenshot({path:`${output}/${key}-desktop.png`});
    await page.setViewportSize({width:390,height:844});
    const mobile=await page.evaluate(()=>window.knifeQA.frame('idle',.3));
    assert.ok(mobile.visible>500,`${key}: blank mobile view`);
    await page.screenshot({path:`${output}/${key}-mobile.png`});
    await page.setViewportSize({width:1440,height:1000});
    const world=await page.evaluate(id=>window.knifeQA.load(id,'world'),item.id);
    assert.ok(world.visible>500,`${key}: blank native world mesh`);
    await page.screenshot({path:`${output}/${key}-world.png`});
    const disposed=await page.evaluate(()=>window.knifeQA.clear());
    assert.equal(disposed.geometries,0,`${key}: leaked geometry`);
    assert.ok(disposed.textures<=1,`${key}: leaked textures`);
    report.models.push({key,id:item.id,idle:result,actions,mobile,world,disposed});
    console.log('RENDER VERIFIED',key,'desktop/mobile/actions/world/disposal');
  }
  assert.deepEqual(errors,[]);fs.writeFileSync('docs/knife-render-audit.json',JSON.stringify(report,null,2)+'\n');
} finally {await browser?.close();await vite.close();}
