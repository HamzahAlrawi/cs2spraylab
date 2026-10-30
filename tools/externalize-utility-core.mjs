import fs from 'node:fs';
import {createHash} from 'node:crypto';

// Preserve the exact existing pixels; this is a storage migration, not a reimport.
const file='src/range/duel/utility-particles-native.json',manifest=JSON.parse(fs.readFileSync(file)),asset=manifest.assets.he;
const bytes=asset.url.startsWith('data:')?Buffer.from(asset.url.split(',')[1],'base64'):fs.readFileSync(`public/revamp${asset.url}`);
const hash=createHash('sha256').update(bytes).digest('hex');
if(hash!==asset.sha256||bytes.length!==asset.bytes)throw Error('Existing HE core does not match its manifest');
asset.url=`/utility-presentation/he-core-${hash.slice(0,12)}.webp`;
fs.mkdirSync('public/revamp/utility-presentation',{recursive:true});fs.writeFileSync(`public/revamp${asset.url}`,bytes);
fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({url:asset.url,bytes:bytes.length,sha256:hash}));
