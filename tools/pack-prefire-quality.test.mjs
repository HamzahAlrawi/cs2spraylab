import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packPrefireQuality} from './pack-prefire-quality.mjs';

test('packages exact proof bytes without external research paths or changing audit results',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'prefire-proof-'));t.after(()=>{
    const target=path.resolve(root);
    assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('prefire-proof-'));
    fs.rmSync(target,{recursive:true,force:true});
  });
  const build={mapId:'fixture',catalogRevision:'v1'},bytes=Buffer.from(JSON.stringify({schemaVersion:1,build,checks:[{gate:'materials',status:'passed',cases:1}]}));
  const sha=createHash('sha256').update(bytes).digest('hex');
  const folder=path.join(root,'public');fs.mkdirSync(folder);fs.writeFileSync(path.join(root,'research.json'),bytes);
  const quality=path.join(folder,'quality.json'),artifacts=quality+'.artifacts.json';
  const checks=[{gate:'materials',status:'passed',cases:1,reportSha256:sha}];
  fs.writeFileSync(quality,JSON.stringify({schemaVersion:1,build,checks}));
  fs.writeFileSync(artifacts,JSON.stringify({[sha]:'../research.json'}));
  const previous=fs.readFileSync(quality);
  const result=packPrefireQuality(quality,artifacts);
  assert.equal(result[sha],`proof-${sha}.json`);assert.deepEqual(fs.readFileSync(path.join(folder,result[sha])),bytes);
  assert.deepEqual(fs.readFileSync(quality),previous);assert.deepEqual(packPrefireQuality(quality,artifacts),result);
  fs.writeFileSync(path.join(folder,result[sha]),'corrupt');
  assert.throws(()=>packPrefireQuality(quality,artifacts),/checksum mismatch/);
});
