import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const sourceDigest=bytes=>digest(bytes.toString().replace(/\r\n/g,'\n'));
export const jsonDigest=value=>digest(JSON.stringify(value));
export function readDelivered(root,asset){
  if(!asset||!/^\/maps\/[a-z0-9_-]+\/duel\/objects\/[a-f0-9]{64}\.(bin|gz)$/.test(asset.url))throw Error('Missing/invalid map delivery resource.');
  const bytes=fs.readFileSync(inside(root,`public/revamp${asset.url}`));
  if(bytes.length!==asset.bytes||digest(bytes)!==asset.sha256)throw Error('Delivered map resource checksum mismatch.');
  if(!['gzip','identity'].includes(asset.encoding))throw Error('Unknown delivery encoding.');
  const decoded=asset.encoding==='gzip'?gunzipSync(bytes):bytes;
  if(decoded.length!==asset.decodedBytes||digest(decoded)!==asset.decodedSha256)throw Error('Decoded map resource checksum mismatch.');
  return decoded;
}
export function inside(root,file){
  const absolute=path.resolve(root,file),relative=path.relative(root,absolute);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>['.git','.codex','.agents','node_modules'].includes(p)))
    throw Error(`Unsafe workspace path: ${file}`);
  // Resolve existing ancestors to reject junction/symlink escapes, including new output files.
  let ancestor=absolute;
  while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
  const real=path.relative(fs.realpathSync(root),fs.realpathSync(ancestor));
  if(real.startsWith('..')||path.isAbsolute(real))throw Error(`Path escapes workspace: ${file}`);
  return absolute;
}
export function writeNew(root,file,value){
  const target=inside(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
/** Broad invalidation is deliberate: any training implementation change requires evidence review. */
export function dependencies(root){
  const files=[];
  const walk=dir=>{for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
    const file=`${dir}/${entry.name}`;
    if(entry.isDirectory())walk(file);
    else if(/\.(?:ts|tsx|mjs|json)$/.test(file)&&!/(?:\.test\.|\.d\.ts$|changelog-data\.ts$)/.test(file))files.push(file);
  }};
  walk('src/range');
  for(const file of ['package.json','package-lock.json','tools/map-onboarding.mjs','tools/map-onboarding-lib.mjs','tools/audit-prefire-bots.mjs'])files.push(file);
  // Adapter metadata contains the receipt itself; packageKey/catalog digest pin that separately.
  return Object.fromEntries(files.sort().filter(f=>!f.startsWith('src/range/prefire/maps/')).map(f=>[f,sourceDigest(fs.readFileSync(inside(root,f)))]));
}
export function validateDependencies(expected,current){
  if(!expected||typeof expected!=='object'||Array.isArray(expected))return ['Missing code dependency snapshot.'];
  const errors=[];
  for(const file of new Set([...Object.keys(expected),...Object.keys(current)]))
    if(expected[file]!==current[file])errors.push(`Changed/missing code dependency: ${file}`);
  return errors;
}
/** Reports are reviewable claims, not cryptographic proof that a manual observation is true. */
export function validateReports(reports,identity,current){
  const errors=[],results=[],reviewers=new Set();
  if(!Array.isArray(reports)||!reports.length)return {errors:['No evidence reports.'],results,reviewers:[]};
  const seen=new Set();
  for(const artifact of reports){
    try{
      if(typeof artifact.body!=='string'||digest(artifact.body)!==artifact.sha256||seen.has(artifact.sha256))throw Error('Missing, duplicate or modified report bytes.');
      seen.add(artifact.sha256);
      const report=JSON.parse(artifact.body);
      for(const [key,value] of Object.entries(identity))if(report[key]!==value)throw Error(`Stale report ${key}.`);
      if(report.complete!==true||!Array.isArray(report.findings)||report.findings.length||!Array.isArray(report.results)||!report.results.length)
        throw Error('Incomplete, diagnostic-only or failed report.');
      const changed=validateDependencies(report.dependencies,current);if(changed.length)throw Error(changed.join(' '));
      if(!report.inputs||!Object.keys(report.inputs).length)throw Error('Report needs source/capture/measurement inputs.');
      for(const result of report.results){
        if(['reference-review','browser','native-reference'].includes(result?.kind)){
          if(typeof report.reviewer!=='string'||!report.reviewer.trim())throw Error('Human/reference/browser review needs a named reviewer.');
          reviewers.add(report.reviewer.trim());
        }
        results.push({...result,artifactSha256:artifact.sha256});
      }
    }catch(error){errors.push(`Evidence report: ${error.message}`);}
  }
  return {errors,results,reviewers:[...reviewers]};
}
