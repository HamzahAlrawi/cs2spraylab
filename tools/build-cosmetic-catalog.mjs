import fs from 'node:fs/promises';
const source=JSON.parse(await fs.readFile('src/range/cosmetics-data.json','utf8'));
const fields=['id','equipment','label','category','price','unlockLevel','imageUrl','assetKey','kitId','stockOnly'];
const cosmetics=source.cosmetics.map(item=>Object.fromEntries(fields.filter(key=>item[key]!==undefined).map(key=>[key,item[key]])));
await fs.writeFile('src/range/cosmetic-catalog.json',JSON.stringify({cosmetics}));
console.log(JSON.stringify({entries:cosmetics.length,bytes:Buffer.byteLength(JSON.stringify({cosmetics}))}));
