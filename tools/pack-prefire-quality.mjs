import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function packPrefireQuality(qualityPath,artifactsPath){
  const directory=path.dirname(path.resolve(qualityPath));
  if(path.dirname(path.resolve(artifactsPath))!==directory)throw Error('Quality and artifact index must share a publication folder');
  const quality=JSON.parse(fs.readFileSync(qualityPath,'utf8'));
  const artifacts=JSON.parse(fs.readFileSync(artifactsPath,'utf8')),packed={};
  for(const sha of new Set(quality.checks.filter(c=>c.status==='passed').map(c=>c.reportSha256))){
    if(!/^[a-f0-9]{64}$/.test(sha)||typeof artifacts[sha]!=='string')throw Error('Missing/invalid proof identity');
    const source=path.resolve(path.dirname(artifactsPath),artifacts[sha]);
    if(path.extname(source)!=='.json')throw Error('Proof must be JSON');
    const bytes=fs.readFileSync(source);
    if(hash(bytes)!==sha)throw Error('Proof checksum mismatch');
    const report=JSON.parse(bytes);
    if(report.schemaVersion!==1||!Array.isArray(report.checks)||JSON.stringify(report.build)!==JSON.stringify(quality.build))
      throw Error('Proof identity/build mismatch');
    packed[sha]=`proof-${sha}.json`;
    const target=path.join(directory,packed[sha]);
    if(fs.existsSync(target)&&hash(fs.readFileSync(target))!==sha)throw Error('Existing proof content differs');
    if(!fs.existsSync(target))fs.writeFileSync(target,bytes);
  }
  fs.writeFileSync(artifactsPath,JSON.stringify(packed,null,2)+'\n');
  return packed;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [quality,artifacts]=process.argv.slice(2);
  if(!quality||!artifacts)throw Error('Usage: node tools/pack-prefire-quality.mjs <quality.json> <quality.json.artifacts.json>');
  console.log(JSON.stringify(packPrefireQuality(quality,artifacts),null,2));
}
