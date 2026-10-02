import fs from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {hash} from './native-knives.mjs';

const models=JSON.parse(fs.readFileSync('docs/knife-asset-inventory.json'));
const cosmetics=JSON.parse(fs.readFileSync('src/range/cosmetics-data.json')).cosmetics.filter(row=>row.equipment==='knife');
const audit=JSON.parse(fs.readFileSync('docs/knife-cosmetics-inventory.json'));
assert.equal(Object.values(models.knives).filter(knife=>!knife.stockOnly).length,20);
assert.equal(new Set(cosmetics.map(row=>row.id)).size,cosmetics.length);
const images=new Map();let total=0,maxView=0;
for(const [id,knife] of Object.entries(models.knives)) {
  const finishes=cosmetics.filter(row=>row.assetKey===id);
  assert.equal(finishes.length,knife.stockOnly?1:audit.knives[id].finishes);
  if(!knife.stockOnly)assert.ok(finishes.length>10,`${id}: ten or fewer native skins`);
  assert.equal(knife.inverseBind.length,16);assert.ok(knife.inverseBind.every(Number.isFinite));
  for(const key of [id,`view-${id}`]) {
    const file=`public/revamp/models/${key}.glb`,bytes=fs.readFileSync(file),entry=knife.exports[key];
    assert.equal(bytes.toString('utf8',0,4),'glTF');assert.equal(bytes.readUInt32LE(4),2);
    assert.equal(bytes.readUInt32LE(8),bytes.length);assert.equal(hash(file),entry.sha256);
    const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
    assert.ok(doc.meshes.length&&doc.skins.length);assert.ok(!doc.images?.some(image=>image.uri));
    assert.ok(!doc.nodes.some(node=>/Cube|thirdperson_/i.test(node.name??'')));
    assert.ok(doc.meshes.some(mesh=>/weapon|body_/i.test(mesh.name)));
    if(key.startsWith('view-')) {
      assert.ok(bytes.length<4*1048576,`${id}: view GLB exceeds 4 MiB budget`);maxView=Math.max(maxView,bytes.length);
      assert.ok(doc.meshes.some(mesh=>/firstperson_default_gloves_arms/.test(mesh.name)));
      for(const label of ['idle','draw','inspect','fire','fire-alt']) {
        assert.ok(doc.animations.some(clip=>clip.name===label),`${id}: missing ${label}`);
        const provenance=knife.viewAudit.clips[label];
        assert.ok(provenance.path.startsWith(knife.namespace));assert.ok(provenance.seconds>0);
        assert.ok(provenance.maxPartMatrixError<1e-4);
        assert.ok(provenance.weaponSlot.includes(knife.skeleton));
      }
    }
    total+=bytes.length;
  }
  const phaseHashes=new Set();
  for(const row of finishes) {
    assert.equal(row.category,'knife');assert.equal(row.equipment,'knife');
    assert.equal(hash(`public/revamp${row.imageUrl}`),row.imageSha256);
    assert.match(row.imageSource,/^panorama\/images\/econ\//);assert.match(row.imageSourceSha256,/^[a-f0-9]{64}$/);
    if(!knife.stockOnly) {
      assert.equal(row.imageSource,`panorama/images/econ/default_generated/${knife.inventoryName}_${row.kitName}_light_png.vtex_c`);
      assert.equal(hash(`public/revamp${row.paintMaskMap}`),row.paintMaskSha256);
      assert.match(row.paintMaskSource,/\/composite_inputs\/.+_masks_/);
      assert.match(row.sourceSha256,/^[a-f0-9]{64}$/);
      if(row.map)assert.equal(hash(`public/revamp${row.map}`),row.textureSha256);
      if(/doppler|marbleized/.test(row.kitName)) {assert.ok(!phaseHashes.has(row.imageSha256),`${id}: duplicate phase preview`);phaseHashes.add(row.imageSha256);}
    }
    for(const url of [row.imageUrl,row.map,row.paintMaskMap].filter(Boolean)) {
      if(images.has(url))continue;
      const image=sharp(`public/revamp${url}`),meta=await image.metadata(),stats=await image.stats();
      assert.ok(meta.width>=128&&meta.height>=128&&meta.width<=512&&meta.height<=512,`${url}: invalid dimensions`);
      assert.ok(stats.channels.slice(0,3).some(channel=>channel.stdev>5),`${url}: blank image`);
      if(meta.hasAlpha)assert.ok(stats.channels.at(-1).sum>0,`${url}: fully transparent`);
      images.set(url,true);
    }
  }
  console.log(`VERIFIED ${id}: ${finishes.length} choices, native view actions, UV mask and preview hashes`);
}
console.log(`Verified ${cosmetics.length} choices, ${images.size} bounded images; GLBs ${(total/1048576).toFixed(2)} MiB total, largest view ${(maxView/1048576).toFixed(2)} MiB. No runtime preload list added.`);
