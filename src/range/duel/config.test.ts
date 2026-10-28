import {describe, expect, it} from 'vitest';
import {botConfig,duelDefaults,restoreDuelConfig,rosterBehaviors,sanitizeDuelConfig} from './config';

describe('first-visit Duel setup',()=>{
  it('starts three FACEIT level 1 bots when no settings have been saved',()=>{
    const config=restoreDuelConfig(null);
    expect(config).toMatchObject({botCount:3,skill:1});
    expect(Array.from({length:config.botCount},(_,index)=>botConfig(config,index).skill)).toEqual([1,1,1]);
  });
  it.each([{botCount:1,skill:3},{botCount:5,skill:'10+'},{botCount:2,skill:7,overrides:[{skill:9}]}])(
    'preserves existing saved setup %j',saved=>{
      expect(restoreDuelConfig(JSON.stringify(saved))).toEqual(sanitizeDuelConfig(saved));
    });
  it('uses the beginner preset for invalid JSON and retains legacy partial-setting fallbacks',()=>{
    expect(restoreDuelConfig('{broken')).toMatchObject({botCount:3,skill:1});
    expect(restoreDuelConfig('{}')).toEqual(duelDefaults);
  });
});

describe('Duel bot trading configuration', () => {
  it('enables trading for new and legacy settings', () => {
    expect(duelDefaults.tradeEnabled).toBe(true);
    expect(sanitizeDuelConfig(undefined)).toEqual(duelDefaults);
    expect(sanitizeDuelConfig({botCount: 3, behavior: 'holder'})).toMatchObject({
      botCount: 3, behavior: 'holder', tradeEnabled: true,
    });
  });

  it.each([true, false])('preserves explicitly saved trading=%s through JSON storage', tradeEnabled => {
    const config = sanitizeDuelConfig({botCount: 3, tradeEnabled, skill: 7, radarEnabled: false});
    const saved = JSON.stringify(config);
    expect(sanitizeDuelConfig(JSON.parse(saved))).toEqual(config);
    expect(config).toMatchObject({botCount: 3, tradeEnabled, skill: 7, radarEnabled: false});
  });

  it.each(['false', 'true', 0, 1, null, undefined, [], {}])('defaults invalid trading flag %j without coercion', tradeEnabled => {
    expect(sanitizeDuelConfig({tradeEnabled}).tradeEnabled).toBe(true);
  });

  it('does not mutate input or retain unknown fields', () => {
    const input = {tradeEnabled: false, extra: 'ignored'};
    expect(sanitizeDuelConfig(input)).toEqual({...duelDefaults, tradeEnabled: false});
    expect(input).toEqual({tradeEnabled: false, extra: 'ignored'});
  });
});

describe('defensive mixed rosters', () => {
  it('favors cover holders without removing patient or aggressive options', () => {
    const config = sanitizeDuelConfig({botCount: 5});
    const rosters = Array.from({length: 200}, (_, seed) => rosterBehaviors(config, seed));
    expect(rosters).toEqual(Array.from({length: 200}, (_, seed) => rosterBehaviors(config, seed)));
    expect(rosters.every(roster => roster.includes('holder') && roster.includes('patient'))).toBe(true);
    const all = rosters.flat();
    expect(all.filter(behavior => behavior === 'holder').length).toBeGreaterThan(450);
    expect(all.filter(behavior => behavior === 'aggressive').length).toBeGreaterThan(30);
    expect(all.filter(behavior => behavior === 'aggressive').length).toBeLessThan(100);
    expect(duelDefaults).toMatchObject({skill: 3, behavior: 'mixed', accuracy: 1});
  });

  it('preserves explicit behavior and individual overrides', () => {
    expect(rosterBehaviors(sanitizeDuelConfig({botCount: 5, behavior: 'aggressive'}), 19)).toEqual(Array(5).fill('aggressive'));
    expect(rosterBehaviors(sanitizeDuelConfig({botCount: 2, behavior: 'holder', overrides: [{behavior: 'patient'}]}), 19))
      .toEqual(['patient', 'holder']);
  });
});
