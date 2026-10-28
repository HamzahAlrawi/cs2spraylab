import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {ArmoryInventory, ArmoryItemDetails, CosmeticPreview} from './ArmoryInventory';
import {createProgressionController, type CosmeticDefinition} from './progression';

const catalog: CosmeticDefinition[] = [
  {id: 'ak-stock', equipment: 'ak47', label: 'Stock', isDefault: true, unlockLevel: 1},
  ...Array.from({length: 12}, (_, i) => ({id: `ak-${i}`, equipment: 'ak47', label: `Finish ${i}`, unlockLevel: i + 1, price: 100 + i * 100})),
  {id: 'm4-stock', equipment: 'm4a4', label: 'Other weapon', isDefault: true, unlockLevel: 1},
];
const controller = createProgressionController({catalog, storage: null});
const base = controller.getSnapshot().profile;
const render = (view: 'collection' | 'unlocks', profile = base) => renderToStaticMarkup(createElement(ArmoryInventory, {
  controller, profile, initialEquipment: 'ak47', equipmentLabels: {ak47: 'AK-47'}, view, onViewChange: () => {}, onNotice: () => {},
}));

describe('armory presentation', () => {
  it('keeps collection owned-only and scoped to one weapon', () => {
    const html = render('collection');
    expect(html).toContain('Preview Stock, AK-47, Equipped');
    expect(html).not.toContain('Preview Other weapon');
    expect(html).not.toContain('Preview Finish');
    expect(html).toContain('Included');
    expect(html).not.toContain('Purchase confirmation');
  });

  it('pages unlocks instead of rendering the entire catalog and exposes level gates', () => {
    const html = render('unlocks');
    expect(html.match(/class="progression-choice[ "]/g)).toHaveLength(8);
    expect(html).toContain('1-8 of 12');
    expect(html).toContain('aria-label="Next page"');
    expect(html).toContain('12 not owned');
    expect(html).toContain('Level 2');
    expect(html).not.toContain('Preview Stock');
    expect(html).not.toContain('Confirm purchase');
  });

  it('does not present a previously owned high-level finish as locked', () => {
    const item = catalog[8], profile = {...base, owned: [...base.owned, item.id]};
    const html = renderToStaticMarkup(createElement(ArmoryItemDetails, {item, controller, profile, equipmentLabel: 'AK-47', onPurchased: () => {}, onNotice: () => {}}));
    expect(html).toContain(`aria-label="Equip ${item.label}"`);
    expect(html).toContain('already owned');
    expect(html).not.toContain('Level locked');
  });

  it('shows the exact credit shortfall and disables an unaffordable action', () => {
    const item = catalog[1];
    const html = renderToStaticMarkup(createElement(ArmoryItemDetails, {item, controller, profile: {...base, balance: 25}, equipmentLabel: 'AK-47', onPurchased: () => {}, onNotice: () => {}}));
    expect(html).toContain('75 more credits needed.');
    expect(html).toContain('Insufficient credits');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Purchase confirmation');
  });

  it('uses the existing glove asset and an honest missing-preview fallback', () => {
    expect(renderToStaticMarkup(createElement(CosmeticPreview, {item: {id: 'gloves-stock', equipment: 'gloves', label: 'Gloves', isDefault: true, unlockLevel: 1}})))
      .toContain('/textures/cosmetics/gloves-standard-preview.webp');
    expect(renderToStaticMarkup(createElement(CosmeticPreview, {item: catalog[1]}))).toContain('Preview unavailable');
  });
});
