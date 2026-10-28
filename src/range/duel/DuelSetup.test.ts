import {createElement, type ComponentProps} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {equipmentNames} from '../equipment';
import {duelDefaults, type DuelConfig} from './config';
import {DuelSetup} from './DuelSetup';

function renderSetup(patch: Partial<DuelConfig> = {}) {
  const props: ComponentProps<typeof DuelSetup> = {
    config: {...duelDefaults, weapons: [...duelDefaults.weapons], overrides: [], ...patch},
    arenaDesign: 'Courtyard', weaponToAdd: 'm4a4',
    setWeaponToAdd: vi.fn(), update: vi.fn(), updateBot: vi.fn(), customizeBot: vi.fn(),
  };
  return {html: renderToStaticMarkup(createElement(DuelSetup, props)), props};
}

const globalLabels = [
  'Number of bots', 'Bot skill level', 'Bot behavior', 'Add bot weapon', 'Add weapon to bot pool',
  'Use generated arenas', 'Real map chunk', 'Duel route arrows', 'Bot health', 'Player health', 'Bot armor', 'Bot helmet',
  'Bot armor points', 'Player armor', 'Player helmet', 'Player armor points',
  'Bot aim accuracy', 'Bot trading', 'Round restart delay', 'Protect Ctrl+W',
  'Show radar', 'Rotate radar', 'Radar zoom',
  'Enable utilities', 'Bot utilities', 'Carry HE grenade', 'Flashbang count', 'Carry Smoke grenade',
  'Carry Molotov', 'Carry Incendiary grenade', 'Carry Decoy grenade',
];

function controlTag(html: string, label: string) {
  const tag = html.match(new RegExp(`<(?:input|select|button)\\b[^>]*aria-label="${label}"[^>]*>`))?.[0];
  expect(tag, label).toBeDefined();
  return tag!;
}

describe('Duel setup disclosures', () => {
  it('puts the essential opponent controls before all optional disclosures', () => {
    const {html} = renderSetup();
    const basics = html.slice(0, html.indexOf('</section>'));
    const labels = ['Number of bots', 'Bot skill level', 'Bot behavior', 'Add bot weapon', 'Add weapon to bot pool'];
    let previous = -1;
    for (const label of labels) {
      const position = basics.indexOf(`aria-label="${label}"`);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
    expect(basics).not.toContain('<details');
    expect(basics).not.toContain('aria-label="Bot health"');
    expect(html.indexOf('</section>')).toBeLessThan(html.indexOf('<details'));
  });

  it('uses initially collapsed native disclosures with summaries and no scripted keyboard replacement', () => {
    const {html} = renderSetup({botCount: 2});
    expect(html.match(/<details class="duel-setup-section(?: duel-utility-setup)?">/g)).toHaveLength(5);
    expect(html.match(/<details class="duel-bot-details duel-setup-bot">/g)).toHaveLength(2);
    expect(html.match(/<summary>/g)).toHaveLength(7);
    expect(html.match(/<details\b[^>]*\bopen(?:=|\s|>)/g)).toBeNull();
    for (const name of ['Utility', 'Arena', 'Health &amp; armor', 'Advanced combat &amp; radar', 'Opponents']) {
      expect(html).toContain(`<span>${name}</span>`);
    }
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('tabindex="-1"');
  });

  it('preserves the exact accessible names of every global and custom opponent control', () => {
    const {html} = renderSetup({botCount: 2, weapons: ['ak47', 'm4a4'], overrides: [{skill: 6}, {weapon: 'knife'}]});
    const expected = [...globalLabels, 'Remove AK-47', 'Remove M4A4'];
    for (const bot of [1, 2]) {
      expected.push(`Customize bot ${bot}`);
      for (const field of ['weapon', 'skill', 'behavior', 'health', 'armor', 'helmet', 'armor points', 'accuracy']) {
        expected.push(`Bot ${bot} ${field}`);
      }
    }
    const labels = [...html.matchAll(/<(?:input|select|button)\b[^>]*aria-label="([^"]+)"/g)].map(match => match[1]);
    expect(labels.sort()).toEqual(expected.sort());
  });

  it('keeps all five opponent customizations available and inherited values unchanged', () => {
    const {html} = renderSetup({botCount: 5, skill: '10+', weapons: ['m4a4', 'knife']});
    for (let bot = 1; bot <= 5; bot++) {
      expect(controlTag(html, `Customize bot ${bot}`)).not.toContain('checked=');
      expect(html).not.toContain(`aria-label="Bot ${bot} weapon"`);
      const weapon = equipmentNames[bot % 2 ? 'm4a4' : 'knife'];
      expect(html).toContain(`Bot ${bot}<span>${weapon} / Lv 10+</span>`);
    }
    expect(html).toContain('<option value="10+" selected="">10+</option>');
  });

  it.each([1, 3])('preserves slider and health limits for %s bots', botCount => {
    const {html} = renderSetup({botCount, generatedMaps:true, overrides: [{accuracy: 1.2}]});
    for (const [label, min, max, step] of [
      ['Number of bots', '1', '5', '1'],
      ['Arena size', botCount <= 2 ? '.65' : '1', '1.5', '.05'],
      ['Bot aim accuracy', '.5', '1.5', '.05'],
      ['Round restart delay', '1', '3', '.1'],
      ['Radar zoom', '.25', '1', '.05'],
      ['Bot 1 accuracy', '.5', '1.5', '.05'],
    ]) {
      const tag = controlTag(html, label);
      expect(tag).toContain(`min="${min}"`);
      expect(tag).toContain(`max="${max}"`);
      expect(tag).toContain(`step="${step}"`);
    }
    for (const label of ['Bot health', 'Player health', 'Bot 1 health']) {
      expect(controlTag(html, label)).toContain('min="1" max="500"');
    }
  });

  it('preserves armor dependencies and the last-weapon removal guard', () => {
    const {html} = renderSetup({armor: false, playerArmor: false, overrides: [{armor: false}]});
    for (const label of ['Bot helmet', 'Bot armor points', 'Player helmet', 'Player armor points', 'Bot 1 helmet', 'Bot 1 armor points']) {
      expect(controlTag(html, label)).toContain('disabled=""');
    }
    expect(controlTag(html, 'Remove AK-47')).toContain('disabled=""');
    const multipleWeapons = renderSetup({weapons: ['ak47', 'm4a4']}).html;
    expect(controlTag(multipleWeapons, 'Remove AK-47')).not.toContain('disabled=');
    expect(controlTag(multipleWeapons, 'Remove M4A4')).not.toContain('disabled=');
  });

  it('does not apply presets or change any configuration while rendering optional groups', () => {
    const config: DuelConfig = {...duelDefaults, botCount: 2, weapons: ['m4a4', 'knife'], skill: '10+',
      radarEnabled: false, tradeEnabled: false, accuracy: 1.25, overrides: [{health: 250, skill: 8}]};
    const before = JSON.stringify(config);
    const {props, html} = renderSetup(config);
    expect(JSON.stringify(config)).toBe(before);
    expect(props.config).toEqual(config);
    expect(props.update).not.toHaveBeenCalled();
    expect(props.updateBot).not.toHaveBeenCalled();
    expect(props.customizeBot).not.toHaveBeenCalled();
    expect(props.setWeaponToAdd).not.toHaveBeenCalled();
    expect(controlTag(html, 'Bot trading')).not.toContain('checked=');
    expect(controlTag(html, 'Show radar')).not.toContain('checked=');
    expect(controlTag(html, 'Bot 1 health')).toContain('value="250"');
    expect(html).toContain('lucide-plus');
    expect(html).not.toContain('>+</button>');
  });
});
