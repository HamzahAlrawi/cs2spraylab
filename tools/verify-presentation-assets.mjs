import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {NodeIO} from '@gltf-transform/core';

const index=JSON.parse(fs.readFileSync('public/revamp/models/duel-gestures/index.json','utf8'));
const io=new NodeIO(); let clips=0;
for(const [id,asset] of Object.entries(index.assets)) {
  const bytes=fs.readFileSync(`public/revamp${asset.url}`);
  assert.equal(bytes.length,asset.bytes,`${id}: byte manifest`);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256,`${id}: hash manifest`);
  assert.ok(asset.bytes<1.5*1048576,`${id}: eager download too large`);
  const root=(await io.readBinary(bytes)).getRoot();
  assert.equal(root.listMeshes().length,0,`${id}: duplicated character geometry`);
  assert.equal(root.listTextures().length,0,`${id}: duplicated textures`);
  for(const clip of root.listAnimations()) for(const channel of clip.listChannels()) {
    assert.match(channel.getTargetNode().getName(),/^(?:(?:spine_|neck_|head_|clavicle_|arm_|hand_|finger_|thumb_)|wpn(?:Pivot)?$)/,`${id}: lower-body/root track`);
    assert.ok([...channel.getSampler().getOutput().getArray()].every(Number.isFinite),`${id}: nonfinite tracks`);
  }
  for(const clip of root.listAnimations()) assert.ok(clip.listChannels().some(channel=>channel.getTargetNode().getName()==='wpn'),`${id}: missing weapon attachment tracks`);
  clips+=root.listAnimations().length;
}
const output='research/presentation-audit'; fs.mkdirSync(output,{recursive:true});
const records=[], server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true},logLevel:'error'});
await server.listen(); let browser;
try {
  browser=await chromium.launch({headless:true});
  for(const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]) {
    const page=await browser.newPage({viewport}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/docs/animation-tests/presentation-preview.html`);
    await page.waitForFunction(()=>window.presentationAudit);
    for(const id of ['nova','xm1014','mag7','sawedoff','zeus']) {
      const idle=await page.evaluate(id=>window.presentationAudit.load('view',id),id);
      assert.ok(idle.colors>100&&idle.drawCalls>0,`${label}/${id}: blank view`);
      for(const action of ['fire',...(id==='zeus'?[]:['reload']),...(['nova','xm1014','sawedoff'].includes(id)?['start','shell','finish']:[])]) {
        const before=await page.evaluate(action=>window.presentationAudit.sample(action,.15),action);
        const after=await page.evaluate(action=>window.presentationAudit.sample(action,.6),action);
        assert.ok(after.colors>100&&after.drawCalls>0,`${label}/${id}/${action}: blank`);
        assert.notEqual(before.hash,after.hash,`${label}/${id}/${action}: static pose`);
        records.push({viewport:label,kind:'view',id,action,...after});
      }
      await page.screenshot({path:`${output}/${label}-view-${id}.png`});
    }
    for(const id of ['ak47','usp','elite','nova','xm1014','mag7','sawedoff','zeus']) {
      const idle=await page.evaluate(id=>window.presentationAudit.load('world',id),id);
      assert.ok(idle.colors>100&&idle.drawCalls>0,`${label}/${id}: blank world`);
      for(const action of idle.actions) {
        const before=await page.evaluate(action=>window.presentationAudit.sample(action,.15),action);
        const after=await page.evaluate(action=>window.presentationAudit.sample(action,.6),action);
        assert.notEqual(before.hash,after.hash,`${label}/${id}/${action}: static world gesture`);
        records.push({viewport:label,kind:'world',id,action,...after});
      }
      const level=await page.evaluate(()=>window.presentationAudit.aim(0));
      const aimed=await page.evaluate(()=>window.presentationAudit.aim(.6));
      assert.notEqual(level.hash,aimed.hash,`${label}/${id}: static aim`);
      await page.screenshot({path:`${output}/${label}-world-${id}.png`});
      if(id==='ak47') {
        const death=await page.evaluate(()=>window.presentationAudit.die());
        assert.notEqual(death.before.hash,death.after.hash,`${label}: static ragdoll`);
        assert.ok(death.after.contacts>0,`${label}: no death contacts`);
        await page.screenshot({path:`${output}/${label}-death-contact.png`});
        records.push({viewport:label,kind:'death',id,...death.after});
      }
    }
    assert.deepEqual(errors,[],`${label}: browser errors`); await page.close();
  }
  fs.writeFileSync(`${output}/render-results.json`,JSON.stringify({packs:Object.keys(index.assets).length,clips,records},null,2)+'\n');
  console.log(`Verified ${clips} finite upper-body clips in ${Object.keys(index.assets).length} bounded packs; ${records.length} desktop/mobile pose renders.`);
} finally {await browser?.close();await server.close();}
