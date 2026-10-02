import fs from 'node:fs';
import path from 'node:path';
import {parseKeyValues} from './cosmetic-keyvalues.mjs';
import {importInventoryPreview} from './native-inventory-preview.mjs';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve(process.env.SOURCE2VIEWER || '.local-tools/vrf/Source2Viewer-CLI.exe');
const vpk = `${game}/game/csgo/pak01_dir.vpk`, work = 'research/cosmetic-actors';
const items = parseKeyValues(fs.readFileSync(`${work}/items_game.txt`, 'utf8')).items_game;
const file = 'src/range/actor-cosmetics-data.json', data = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const item of data.cosmetics.filter(item => item.equipment === 'gloves')) {
  const name = items.items[item.itemId].name, kit = items.paint_kits[item.kitId].name;
  Object.assign(item, await importInventoryPreview({id: item.id,
    resource: `panorama/images/econ/default_generated/${name}_${kit}_light_png.vtex_c`, cli, vpk, work}));
  console.log('Imported glove inventory preview:', item.id);
}
await importInventoryPreview({id: 'gloves-standard',
  resource: 'panorama/images/econ/weapons/base_weapons/ct_gloves_png.vtex_c', cli, vpk, work});
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
