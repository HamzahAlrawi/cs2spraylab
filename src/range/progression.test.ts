import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {ProgressionPanel, XpNotification} from './ProgressionPanel';
import {sanitizeAchievements} from './achievements';
import {
  BUTTERFLY_EMERALD_ID, BUTTERFLY_EMERALD_LEVEL, MAX_LEVEL, MAX_XP, MAX_CREDITS, MAX_CREDIT_COUNTER, MAX_COMPLETIONS,
  PROGRESSION_KEY, PROGRESSION_VERSION, PROGRESSION_MILESTONES, STANDARD_KNIFE_ID,
  cosmeticCategory, cosmeticPrice, createProgressionController, creditsForXp, equippedCosmetic, evaluateDrillXp, evaluateDuelXp, levelProgress, ownsCosmetic,
  prepareCosmeticCatalog, sanitizeProgression, xpForLevel,
  type CosmeticDefinition, type DrillMode, type DrillXpResult, type DuelXpResult, type DuelXpSetup,
  type ProgressionStorage, type XpBot,
} from './progression';

const definitions: CosmeticDefinition[] = [
  {id: 'test-stock', equipment: 'ak47', label: 'Standard finish', unlockLevel: 1, isDefault: true},
  {id: 'test-finish', equipment: 'ak47', label: 'Test finish', unlockLevel: 2, legacyUnlockLevel:2, price: 180, imageUrl: '/test/finish.webp', swatch: '#ff00cc', assetKey: 'test-texture'},
  {id: BUTTERFLY_EMERALD_ID, equipment: 'knife', label: 'Test butterfly cosmetic', unlockLevel: BUTTERFLY_EMERALD_LEVEL, legacyUnlockLevel:20, price: 40_000, assetKey: 'test-knife'},
];
const bot = (patch: Partial<XpBot> = {}): XpBot => ({id: '1', skill: 5, health: 100, armor: true, accuracy: 1, weapon: 'ak47', ...patch});
const setup = (patch: Partial<DuelXpSetup> = {}): DuelXpSetup => ({playerHealth: 100, playerArmor: true, bots: [bot()], ...patch});
const win = (config = setup(), score = 75): DuelXpResult => ({completion: 'completed', outcome: 'won',activeSeconds:60,
  review: {score, shots: 20 * config.bots.length, hits: 5 * config.bots.length, damage: config.bots.reduce((sum, item) => sum + item.health, 0), kills: config.bots.length},
  opponents: config.bots.map(item => ({id: item.id, healthDamage: item.health, killed: true})),
});
const partial = (config = setup(), damage = 50, score: number | null = 75): DuelXpResult => ({completion: 'completed', outcome: 'lost',activeSeconds:60,
  review: {score, shots: 10, hits: damage ? 2 : 0, kills: 0, damage},
  opponents: config.bots.map((item, index) => ({id: item.id, healthDamage: index ? 0 : damage, killed: false})),
});
const drill = (patch: Partial<DrillXpResult> = {}): DrillXpResult => ({completion: 'completed', objectiveCompleted: true, score: 80,
  shots: 10, hits: 5, activeSeconds: 5, movementReps: 1, targetsHit: 2, ...patch});
const memory = (initial?: unknown) => {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(PROGRESSION_KEY, JSON.stringify(initial));
  const storage: ProgressionStorage = {getItem: vi.fn(key => data.get(key) ?? null), setItem: vi.fn((key, value) => {data.set(key, value);})};
  return {storage, data};
};
const award = (controller: ReturnType<typeof createProgressionController>, config = setup(), score = 75) => {
  const id = controller.beginDuel(config, 'settings:0')!;
  return controller.completeDuel(id, win(config, score), config, 'settings:0');
};
const savedProfile = (patch: Record<string, unknown> = {}) => ({version: PROGRESSION_VERSION, xp: 0, balance: 0,
  creditsEarned: 0, creditsSpent: 0, owned: [], equipped: {}, completedDuels: 0, completedDrills: 0, milestones: [], achievements: sanitizeAchievements(undefined), ...patch});

describe('progression level curve and native catalog boundary', () => {
  it('begins at level one, crosses exact thresholds, and has increasingly spaced levels', () => {
    expect(levelProgress(0)).toMatchObject({level: 1, current: 0, needed: 185, remaining: 185, fraction: 0});
    let previousGap = 0;
    for (let level = 2; level <= MAX_LEVEL; level++) {
      const threshold = xpForLevel(level), gap = threshold - xpForLevel(level - 1);
      expect(levelProgress(threshold - 1).level).toBe(level - 1);
      expect(levelProgress(threshold).level).toBe(level);
      expect(gap).toBeGreaterThan(previousGap);
      previousGap = gap;
    }
    expect(xpForLevel(20)).toBe(15485);
    expect(levelProgress(MAX_XP)).toMatchObject({level: MAX_LEVEL, fraction: 1, remaining: 0, needed: 0});
  });
  it.each([NaN, Infinity, -1])('keeps malformed level totals finite: %s', value => {
    expect(levelProgress(value)).toMatchObject({level: 1, total: 0, fraction: 0});
    expect(Number.isFinite(xpForLevel(value))).toBe(true);
  });
  it('only provides a neutral standard knife until the main catalog supplies assets', () => {
    expect(prepareCosmeticCatalog()).toEqual([{id: STANDARD_KNIFE_ID, equipment: 'knife', category: 'knife', price: 0, label: 'Standard knife', unlockLevel: 1, isDefault: true}]);
    expect(prepareCosmeticCatalog().some(item => item.id === BUTTERFLY_EMERALD_ID)).toBe(false);
  });
  it('keeps native metadata but rejects duplicate IDs, unsafe previews, invalid levels and prototype keys', () => {
    const catalog = prepareCosmeticCatalog([...definitions,
      {...definitions[1], label: 'Duplicate'},
      {...definitions[1], id: 'bad-level', unlockLevel: 0},
      {...definitions[1], id: '__proto__'},
      {...definitions[1], id: 'unsafe-preview', imageUrl: '//example.test/tracker', swatch: 'url(bad)'},
    ]);
    expect(catalog.find(item => item.id === 'test-finish')).toMatchObject({label: 'Test finish', imageUrl: '/test/finish.webp', swatch: '#ff00cc', assetKey: 'test-texture'});
    expect(catalog.filter(item => item.id === 'test-finish')).toHaveLength(1);
    expect(catalog.some(item => item.id === 'bad-level' || item.id === '__proto__')).toBe(false);
    expect(catalog.find(item => item.id === 'unsafe-preview')).not.toHaveProperty('imageUrl');
    expect(catalog.find(item => item.id === 'unsafe-preview')).not.toHaveProperty('swatch');
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog[0])).toBe(true);
  });
  it('enforces standard knife at level one and emerald no earlier than level twenty', () => {
    const catalog = prepareCosmeticCatalog([
      {id: STANDARD_KNIFE_ID, equipment: 'knife', label: 'Incorrect name', unlockLevel: 90, assetKey: 'native-default'},
      {...definitions[2], unlockLevel: 1, isDefault: true},
    ]);
    expect(catalog[0]).toMatchObject({label: 'Standard knife', unlockLevel: 1, isDefault: true, assetKey: 'native-default'});
    expect(catalog[1]).toMatchObject({unlockLevel: 20, isDefault: false});
  });
  it('never accepts a standard knife mapped to a gun', () => {
    expect(prepareCosmeticCatalog([{...definitions[0], id: STANDARD_KNIFE_ID}])[0].equipment).toBe('knife');
  });
});

describe('fair deterministic duel XP', () => {
  it('bounds currency from very fast high-difficulty rounds without reducing earned XP',()=>{
    const config=setup({bots:Array.from({length:5},(_,index)=>bot({id:String(index+1),skill:'10+'}))});
    const controller=createProgressionController({storage:null});
    const id=controller.beginDuel(config,'0')!;
    const result={...win(config,100),activeSeconds:5};
    const reward=controller.completeDuel(id,result,config,'0');
    expect(reward.xp).toBe(evaluateDuelXp(config,result).xp);
    expect(reward.credits).toBe(30);
    expect(controller.getSnapshot().profile.balance).toBe(30);
  });
  it.each([NaN,Infinity,-1,3601])('rejects malformed active time %s',activeSeconds=>{
    expect(evaluateDuelXp(setup(),{...win(),activeSeconds}).xp).toBe(0);
  });
  it('awards the same inputs identically and uses the coaching score', () => {
    const config = setup();
    expect(evaluateDuelXp(config, win(config))).toEqual({xp: 151, reason: 'earned'});
    expect(evaluateDuelXp(config, win(config))).toEqual(evaluateDuelXp(config, win(config)));
    expect(evaluateDuelXp(config, win(config, 100)).xp).toBeGreaterThan(evaluateDuelXp(config, win(config, 0)).xp);
  });
  it('scales monotonically across actual FACEIT skills including 10+', () => {
    let previous = 0;
    for (const skill of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, '10+'] as const) {
      const config = setup({bots: [bot({skill})]});
      const xp = evaluateDuelXp(config, win(config)).xp;
      expect(xp).toBeGreaterThan(previous);
      previous = xp;
    }
  });
  it.each([
    {skill: 1, winXp: 60, lossXp: 16},
    {skill: 5, winXp: 151, lossXp: 41},
    {skill: 10, winXp: 214, lossXp: 58},
    {skill: '10+', winXp: 232, lossXp: 63},
  ] as const)('weights skill $skill for wins and engaged losses without subtracting XP', ({skill, winXp, lossXp}) => {
    const config = setup({bots: [bot({skill})]});
    expect(evaluateDuelXp(config, win(config))).toEqual({xp: winXp, reason: 'earned'});
    expect(evaluateDuelXp(config, partial(config))).toEqual({xp: lossXp, reason: 'earned'});
    expect(lossXp).toBeLessThan(winXp);
    expect(evaluateDuelXp(config, {...partial(config), outcome: 'draw'}).xp).toBeGreaterThan(lossXp);
    expect(evaluateDuelXp(config, partial(config, 0))).toEqual({xp: 0, reason: 'no-engagement'});
  });
  it('gives high difficulty a substantially larger differential on both wins and losses', () => {
    const low = setup({bots: [bot({skill: 1})]}), high = setup({bots: [bot({skill: '10+'})]});
    expect(evaluateDuelXp(high, win(high)).xp).toBeGreaterThan(evaluateDuelXp(low, win(low)).xp * 3.5);
    expect(evaluateDuelXp(high, partial(high)).xp).toBeGreaterThan(evaluateDuelXp(low, partial(low)).xp * 3.5);
  });
  it('weights multi-bot difficulty by actual engagement and retains roster scaling', () => {
    const low = setup({bots: Array.from({length: 3}, (_, index) => bot({id: String(index + 1), skill: 1}))});
    const mixed = setup({bots: [bot({id: '1', skill: 1}), bot({id: '2', skill: 5}), bot({id: '3', skill: '10+'})]});
    const high = setup({bots: low.bots.map(item => ({...item, skill: '10+'}))});
    const lowXp = evaluateDuelXp(low, win(low)).xp, mixedXp = evaluateDuelXp(mixed, win(mixed)).xp;
    const highXp = evaluateDuelXp(high, win(high)).xp, singleHigh = setup({bots: [bot({skill: '10+'})]});
    expect(mixedXp).toBeGreaterThan(lowXp);
    expect(highXp).toBeGreaterThan(mixedXp);
    expect(highXp).toBeGreaterThan(lowXp * 2.5);
    expect(highXp).toBeLessThan(evaluateDuelXp(singleHigh, win(singleHigh)).xp * 3);
    const lowEngagement = partial(mixed);
    const highEngagement = {...lowEngagement, opponents: mixed.bots.map(item => ({id: item.id, healthDamage: item.id === '3' ? 50 : 0, killed: false}))};
    expect(evaluateDuelXp(mixed, highEngagement).xp).toBeGreaterThan(evaluateDuelXp(mixed, lowEngagement).xp);
    expect(evaluateDuelXp(mixed, highEngagement).xp).toBeLessThan(evaluateDuelXp(singleHigh, partial(singleHigh)).xp);
  });
  it('uses each bot override and is independent of roster order', () => {
    const config = setup({bots: [bot({id: '1', skill: 2, health: 40, armor: false, accuracy: .5}), bot({id: '2', skill: 10}), bot({id: '3', skill: 5})]});
    const result = win(config);
    const homogeneous = setup({bots: config.bots.map(item => ({...item, skill: 10, health: 100, armor: true, accuracy: 1}))});
    expect(evaluateDuelXp(config, result).xp).toBeLessThan(evaluateDuelXp(homogeneous, win(homogeneous)).xp);
    expect(evaluateDuelXp({...config, bots: [...config.bots].reverse()}, {...result, opponents: [...result.opponents].reverse()})).toEqual(evaluateDuelXp(config, result));
  });
  it('grows sublinearly with bot count and does not multiply stacked difficulty fivefold', () => {
    const values = Array.from({length: 5}, (_, index) => {
      const config = setup({bots: Array.from({length: index + 1}, (__, i) => bot({id: `${i + 1}`}))});
      return evaluateDuelXp(config, win(config)).xp;
    });
    expect(values[4]).toBeGreaterThan(values[0]);
    expect(values[4]).toBeLessThan(values[0] * 3);
    for (let i = 2; i < values.length; i++) expect(values[i] - values[i - 1]).toBeLessThan(values[i - 1] - values[i - 2]);
  });
  it('reduces XP for low health, no armor, low accuracy and extra player health', () => {
    const normal = setup(), expected = evaluateDuelXp(normal, win(normal)).xp;
    for (const config of [setup({bots: [bot({health: 20})]}), setup({bots: [bot({armor: false})]}),
      setup({bots: [bot({accuracy: .5})]}), setup({playerHealth: 500})]) {
      expect(evaluateDuelXp(config, win(config)).xp).toBeLessThan(expected);
    }
    const oneHp = setup({bots: [bot({health: 1})], playerHealth: 500});
    expect(evaluateDuelXp(oneHp, win(oneHp)).xp).toBe(0);
  });
  it('does not reward self-imposed health/armor handicaps or inflate high-health opponents', () => {
    const normal = evaluateDuelXp(setup(), win()).xp;
    for (const config of [setup({playerHealth: 1}), setup({playerArmor: false}), setup({bots: [bot({health: 500})]})]) {
      expect(evaluateDuelXp(config, win(config)).xp).toBe(normal);
    }
  });
  it('does not boost a loss by adding untouched difficult opponents', () => {
    const one = setup(), padded = setup({bots: [bot(), bot({id: '2', skill: '10+'}), bot({id: '3', skill: '10+'})]});
    expect(evaluateDuelXp(padded, partial(padded)).xp).toBeLessThan(evaluateDuelXp(one, partial(one)).xp);
  });
  it('does not boost a full clear by padding the roster with one-HP bots', () => {
    const normal = setup(), padded = setup({bots: [bot(), ...Array.from({length: 4}, (_, i) => bot({id: `${i + 2}`, skill: 1, health: 1, armor: false}))]});
    expect(evaluateDuelXp(padded, win(padded)).xp - evaluateDuelXp(normal, win(normal)).xp).toBeLessThan(5);
  });
  it('rewards partial legitimate damage on a loss, less than a completed win', () => {
    const config = setup(), lose = evaluateDuelXp(config, partial(config));
    expect(lose.xp).toBeGreaterThan(0);
    expect(lose.xp).toBeLessThan(evaluateDuelXp(config, win(config)).xp);
    expect(evaluateDuelXp(config, {...partial(config), outcome: 'draw'}).xp).toBeGreaterThan(lose.xp);
  });
  it('allows legitimate melee damage with a null gun coaching score', () => {
    const result = win();
    expect(evaluateDuelXp(setup(), {...result, review: {...result.review, shots: 0, hits: 0, score: null}}).xp).toBeGreaterThan(0);
  });
  it('gives no XP for AFK, firing at walls, or taking damage without dealing damage', () => {
    expect(evaluateDuelXp(setup(), partial(setup(), 0)).reason).toBe('no-engagement');
    const result = partial(setup(), 0, null);
    expect(evaluateDuelXp(setup(), {...result, review: {...result.review, shots: 0, hits: 0}}).xp).toBe(0);
  });
  it.each(['reset', 'abandoned', 'settings-changed'] as const)('rejects %s even with a good score', completion => {
    expect(evaluateDuelXp(setup(), {...win(), completion})).toEqual({xp: 0, reason: 'not-completed'});
  });
  it('rejects impossible totals, invented kills, duplicated bots and mismatched outcome', () => {
    const result = win();
    const invalid: DuelXpResult[] = [
      {...result, review: {...result.review, damage: 99}},
      {...result, review: {...result.review, shots: 0}},
      {...result, review: {...result.review, score: NaN}},
      {...result, review: {...result.review, score: Infinity}},
      {...result, review: {...result.review, kills: 0}},
      {...result, opponents: [{id: '1', healthDamage: 1000, killed: true}]},
      {...result, opponents: [{id: 'missing', healthDamage: 100, killed: true}]},
      {...result, opponents: [...result.opponents, ...result.opponents]},
      {...result, opponents: [{id: '1', healthDamage: 100, killed: false}]},
      {...result, outcome: 'lost'},
      {...partial(), outcome: 'won'},
    ];
    for (const value of invalid) expect(evaluateDuelXp(setup(), value)).toEqual({xp: 0, reason: 'invalid-result'});
    expect(evaluateDuelXp(setup({bots: [bot(), bot()]}), win()).xp).toBe(0);
    expect(evaluateDuelXp(setup({bots: []}), win()).xp).toBe(0);
    expect(evaluateDuelXp(setup({bots: [bot({health: NaN})]}), win()).xp).toBe(0);
  });
});

describe('completed drill XP', () => {
  it('rewards quick, successful counterstrafes and reposition bursts without rewarding idle clicks', () => {
    expect(evaluateDrillXp('precision', drill({shots: 1, hits: 1, targetsHit: 1, activeSeconds: .4})).xp).toBeGreaterThan(0);
    expect(evaluateDrillXp('burst', drill({shots: 6, activeSeconds: .8})).xp).toBeGreaterThan(0);
    expect(evaluateDrillXp('precision', drill({activeSeconds: .1})).xp).toBe(0);
    expect(evaluateDrillXp('precision', drill({activeSeconds: .4, movementReps: 0})).xp).toBe(0);
  });
  it.each<DrillMode>(['guided', 'spray', 'transfer', 'peek', 'precision', 'burst'])('keeps %s modest compared with duels', mode => {
    const result = evaluateDrillXp(mode, drill());
    expect(result.xp).toBeGreaterThan(0);
    expect(result.xp).toBeLessThanOrEqual(16);
    expect(result.xp).toBeLessThan(evaluateDuelXp(setup(), win()).xp / 5);
  });
  it('requires the real objective, completed lifecycle, hits, and active time', () => {
    for (const patch of [{objectiveCompleted: false}, {completion: 'reset' as const}, {hits: 0, targetsHit: 0}, {activeSeconds: .1}, {targetsHit: 0}]) {
      expect(evaluateDrillXp('guided', drill(patch)).xp).toBe(0);
    }
  });
  it.each<DrillMode>(['burst', 'precision', 'peek'])('%s requires a legitimate movement repetition', mode => {
    expect(evaluateDrillXp(mode, drill({movementReps: 0})).xp).toBe(0);
  });
  it('requires both transfer targets and six shots for spray/burst attempts', () => {
    expect(evaluateDrillXp('transfer', drill({targetsHit: 1})).xp).toBe(0);
    for (const mode of ['guided', 'spray', 'burst'] as const) expect(evaluateDrillXp(mode, drill({shots: 5})).xp).toBe(0);
  });
  it('rejects malformed stats', () => {
    for (const patch of [{hits: 11}, {score: 101}, {score: NaN}, {shots: -1}, {movementReps: Infinity}, {activeSeconds: -1}, {targetsHit: 10}]) {
      expect(evaluateDrillXp('guided', drill(patch)).xp).toBe(0);
    }
  });
});

describe('persistent progression and equipment sanitation', () => {
  it('ignores malformed/unknown versions and invalid XP', () => {
    for (const raw of [null, [], 5, {}, {version: 99, xp: 10000}, {version: 1, xp: NaN}, {version: 1, xp: -1}, {version: 1, xp: MAX_XP + 1}]) {
      expect(sanitizeProgression(raw)).toEqual({...savedProfile(), equipped: {knife: STANDARD_KNIFE_ID}, owned: [STANDARD_KNIFE_ID]});
    }
  });
  it('rejects unowned, wrong-equipment and prototype equipment entries in v2', () => {
    const catalog = prepareCosmeticCatalog(definitions);
    const raw = JSON.parse(`{"version":2,"xp":0,"equipped":{"knife":"${BUTTERFLY_EMERALD_ID}","ak47":"test-finish","unknown":"test-stock","__proto__":"test-stock"}}`);
    expect(sanitizeProgression(raw, catalog).equipped).toEqual({knife: STANDARD_KNIFE_ID});
    const profile = sanitizeProgression({...raw, xp: xpForLevel(20), owned: ['test-finish', BUTTERFLY_EMERALD_ID]}, catalog);
    expect(profile.equipped).toEqual({knife: BUTTERFLY_EMERALD_ID, ak47: 'test-finish'});
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.equipped)).toBe(true);
  });
  it('persists actual rewards and equips, and restores them without replaying notices', () => {
    const {storage} = memory();
    const first = createProgressionController({storage, catalog: definitions});
    award(first); award(first);
    expect(first.purchase('test-finish').success).toBe(true);
    expect(first.equip('ak47', 'test-finish')).toBe(true);
    const second = createProgressionController({storage, catalog: definitions});
    expect(second.getSnapshot().profile).toEqual(first.getSnapshot().profile);
    expect(second.getSnapshot().notification).toBeNull();
    expect(equippedCosmetic(second.getSnapshot().profile, second.catalog, 'ak47')?.id).toBe('test-finish');
  });
  it('prevents locked equip, wrong slots, invalid IDs, and keeps default knife without assets', () => {
    const controller = createProgressionController({storage: null, catalog: definitions});
    expect(controller.equip('knife', BUTTERFLY_EMERALD_ID)).toBe(false);
    expect(controller.equip('ak47', STANDARD_KNIFE_ID)).toBe(false);
    expect(controller.equip('missing', 'unknown')).toBe(false);
    expect(controller.equip('__proto__', 'test-stock')).toBe(false);
    expect(equippedCosmetic(controller.getSnapshot().profile, controller.catalog, 'knife')?.id).toBe(STANDARD_KNIFE_ID);
    expect(equippedCosmetic(controller.getSnapshot().profile, controller.catalog, 'ak47')?.id).toBe('test-stock');
  });
  it('equips an earned knife and returns to stock without deleting XP', () => {
    const {storage} = memory({version: 1, xp: xpForLevel(20), equipped: {}});
    const controller = createProgressionController({storage, catalog: definitions});
    expect(controller.equip('knife', BUTTERFLY_EMERALD_ID)).toBe(true);
    expect(controller.equip('ak47', 'test-finish')).toBe(true);
    expect(controller.resetEquipment('knife')).toBe(true);
    expect(controller.resetEquipment('ak47')).toBe(true);
    expect(controller.getSnapshot().profile).toMatchObject({version: 2, xp: xpForLevel(20), balance: 0, equipped: {knife: STANDARD_KNIFE_ID}});
    expect(controller.getSnapshot().profile.owned).toContain(BUTTERFLY_EMERALD_ID);
  });
  it('falls back safely on corrupt JSON and blocked or full storage', () => {
    const {storage, data} = memory();
    data.set(PROGRESSION_KEY, '{');
    const corrupt = createProgressionController({storage});
    expect(corrupt.getSnapshot().profile.xp).toBe(0);
    expect(award(corrupt).awarded).toBe(true);
    expect(corrupt.getSnapshot().storageStatus).toBe('saved');
    const blocked = createProgressionController({storage: {getItem() {throw Error('blocked');}, setItem() {throw Error('quota');}}});
    expect(award(blocked).awarded).toBe(true);
    expect(blocked.getSnapshot().storageStatus).toBe('memory-only');
    expect(blocked.getSnapshot().profile.xp).toBeGreaterThan(0);
  });
  it('preserves an unsupported future save verbatim', () => {
    const {storage, data} = memory({version: 99, xp: 99, future: true});
    const original = data.get(PROGRESSION_KEY), controller = createProgressionController({storage});
    expect(award(controller).awarded).toBe(true);
    expect(controller.getSnapshot().storageStatus).toBe('unsupported-version');
    expect(data.get(PROGRESSION_KEY)).toBe(original);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('caps total XP and awards only the remaining amount', () => {
    const {storage} = memory({version: 1, xp: MAX_XP - 2, equipped: {}});
    const controller = createProgressionController({storage});
    expect(award(controller)).toMatchObject({awarded: true, xp: 2});
    expect(award(controller)).toMatchObject({awarded: true, xp: 0, credits: 90});
    expect(controller.getSnapshot().profile.xp).toBe(MAX_XP);
  });
});

describe('one-use lifecycle, notifications and React contracts', () => {
  it('is idempotent per issued round ID and rejects replay after reload', () => {
    const {storage} = memory(), config = setup(), controller = createProgressionController({storage});
    const id = controller.beginDuel(config, '0')!;
    expect(controller.completeDuel(id, win(config), config, '0').awarded).toBe(true);
    const xp = controller.getSnapshot().profile.xp;
    expect(controller.completeDuel(id, win(config), config, '0').reason).toBe('unknown-attempt');
    const reloaded = createProgressionController({storage});
    expect(reloaded.completeDuel(id, win(config), config, '0').reason).toBe('unknown-attempt');
    expect(reloaded.getSnapshot().profile.xp).toBe(xp);
  });
  it('does not restore an unfinished attempt after reload', () => {
    const {storage} = memory(), controller = createProgressionController({storage});
    const id = controller.beginDuel(setup(), '0')!;
    const reloaded = createProgressionController({storage});
    expect(reloaded.completeDuel(id, win(), setup(), '0').awarded).toBe(false);
  });
  it('cancels the previous attempt when a different round or mode starts', () => {
    const controller = createProgressionController({storage: null});
    const old = controller.beginDuel(setup(), '0')!;
    const next = controller.beginDrill('guided', '0')!;
    expect(controller.completeDuel(old, win(), setup(), '0').awarded).toBe(false);
    expect(controller.completeDrill(next, drill(), '0').awarded).toBe(true);
    expect(controller.completeDrill(next, drill(), '0').awarded).toBe(false);
  });
  it('cannot turn reset/invalid results into rewards by resubmitting later', () => {
    const controller = createProgressionController({storage: null});
    const id = controller.beginDuel(setup(), '0')!;
    expect(controller.completeDuel(id, {...win(), completion: 'reset'}, setup(), '0').awarded).toBe(false);
    expect(controller.completeDuel(id, win(), setup(), '0').awarded).toBe(false);
  });
  it('rejects changes to any reward-affecting setup or revision, even change-and-revert', () => {
    const controller = createProgressionController({storage: null});
    for (const finalSetup of [setup({playerHealth: 500}), setup({playerArmor: false}), setup({bots: [bot({skill: 10})]}),
      setup({bots: [bot({weapon: 'awp'})]}), setup({bots: [bot({armor: false})]}), setup({bots: [bot({accuracy: .5})]})]) {
      const id = controller.beginDuel(setup(), '0')!;
      expect(controller.completeDuel(id, win(), finalSetup, '0').reason).toBe('settings-changed');
    }
    const id = controller.beginDuel(setup(), '0')!;
    expect(controller.completeDuel(id, win(), setup(), '2').reason).toBe('settings-changed');
    const drillId = controller.beginDrill('guided', '0')!;
    expect(controller.completeDrill(drillId, drill(), '1').reason).toBe('settings-changed');
    expect(controller.getSnapshot().profile.xp).toBe(0);
  });
  it('copies setup so external mutation cannot rewrite an in-flight difficulty', () => {
    const controller = createProgressionController({storage: null});
    const live = {playerHealth: 100, playerArmor: true, bots: [{...bot()}]};
    const id = controller.beginDuel(live, '0')!;
    live.bots[0].skill = 10;
    expect(controller.completeDuel(id, win(live), live, '0').reason).toBe('settings-changed');
  });
  it('supports explicit cancellation without letting a stale callback cancel a newer attempt', () => {
    const controller = createProgressionController({storage: null});
    const old = controller.beginDuel(setup(), '0')!;
    const next = controller.beginDuel(setup(), '0')!;
    controller.cancelAttempt(old);
    expect(controller.completeDuel(next, win(), setup(), '0').awarded).toBe(true);
    const cancelled = controller.beginDuel(setup(), '0')!;
    controller.cancelAttempt();
    expect(controller.completeDuel(cancelled, win(), setup(), '0').awarded).toBe(false);
  });
  it('does not consume an active duel for a wrong-type completion callback', () => {
    const controller = createProgressionController({storage: null});
    const id = controller.beginDuel(setup(), '0')!;
    expect(controller.completeDrill(id, drill(), '0').awarded).toBe(false);
    expect(controller.completeDuel(id, win(), setup(), '0').awarded).toBe(true);
  });
  it('rejects invalid start state and revision', () => {
    const controller = createProgressionController({storage: null});
    expect(controller.beginDuel(setup({playerHealth: 0}), '0')).toBeNull();
    expect(controller.beginDuel(setup(), '')).toBeNull();
    expect(controller.beginDrill('guided', '')).toBeNull();
  });
  it('publishes immutable stable snapshots only on changes and unsubscribes', () => {
    const controller = createProgressionController({storage: null, catalog: definitions}), listener = vi.fn();
    const unsubscribe = controller.subscribe(listener), initial = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(initial);
    expect(Object.isFrozen(initial)).toBe(true);
    const id = controller.beginDuel(setup(), '0')!;
    expect(listener).not.toHaveBeenCalled();
    controller.completeDuel(id, win(), setup(), '0');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).not.toBe(initial);
    unsubscribe();
    controller.dismissNotification();
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('notifies on level gains/unlocks without automatically changing equipped cosmetics', () => {
    const {storage} = memory({version: 1, xp: xpForLevel(2) - 1, equipped: {}});
    const controller = createProgressionController({storage, catalog: definitions});
    award(controller);
    expect(controller.getSnapshot().notification).toMatchObject({xp: 151, source: 'duel', levelBefore: 1, levelAfter: 2, unlockedIds: ['test-finish']});
    expect(controller.getSnapshot().profile.equipped).toEqual({knife: STANDARD_KNIFE_ID});
    controller.dismissNotification();
    expect(controller.getSnapshot().notification).toBeNull();
  });
  it('stops accepting attempts and equips after disposal', () => {
    const controller = createProgressionController({storage: null}), listener = vi.fn();
    controller.subscribe(listener);
    const id = controller.beginDuel(setup(), '0')!;
    controller.dispose();
    expect(controller.completeDuel(id, win(), setup(), '0').awarded).toBe(false);
    expect(controller.beginDrill('guided', '0')).toBeNull();
    expect(controller.beginDuel(setup(), '0')).toBeNull();
    expect(controller.equip('knife', STANDARD_KNIFE_ID)).toBe(false);
    expect(controller.canPurchase('test-finish')).toBe(false);
    expect(controller.purchase('test-finish')).toMatchObject({success: false, reason: 'disposed'});
    expect(listener).not.toHaveBeenCalled();
  });
  it('server-renders a compact accessible armory trigger without browser globals', () => {
    const controller = createProgressionController({storage: null});
    const html = renderToStaticMarkup(createElement(ProgressionPanel, {controller}));
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Level 1, 185 XP to next level. Open armory');
    expect(html).not.toContain('<dialog');
  });
  it('renders XP notices in a live region below the center, with an accessible dismissal', () => {
    const controller = createProgressionController({storage: null});
    expect(renderToStaticMarkup(createElement(XpNotification, {controller}))).toContain('aria-live="polite"');
    award(controller);
    const html = renderToStaticMarkup(createElement(XpNotification, {controller}));
    expect(html).toContain('+151 XP');
    expect(html).toContain('+90 credits');
    expect(html).toContain('AI Duel complete');
    expect(html).toContain('Dismiss XP notification');
  });
});

describe('catalog purchase metadata', () => {
  it('normalizes free defaults, legacy prices, native thumbnail metadata, and equipment categories', () => {
    const catalog = prepareCosmeticCatalog([
      {...definitions[0], price: 999}, {...definitions[1], category: 'weapon', rarity: 'Covert'},
      {id: 'glove-stock', equipment: 'gloves', label: 'Stock gloves', unlockLevel: 1, isDefault: true, category: 'gloves', price: 0},
      {id: 'agent-stock', equipment: 'agent', label: 'Stock agent', unlockLevel: 1, isDefault: true, category: 'agent', price: 0},
      {id: 'agent-native', equipment: 'agent', label: 'Native agent', unlockLevel: 10, price: 4000, imageUrl: '/models/agent.png', assetKey: 'native-agent'},
      {...definitions[1], id: 'legacy-no-price', price: undefined},
    ]);
    expect(catalog.find(item => item.id === 'test-stock')).toMatchObject({category: 'weapon', price: 0});
    expect(catalog.find(item => item.id === 'test-finish')).toMatchObject({price: 180, rarity: 'Covert', imageUrl: '/test/finish.webp'});
    expect(catalog.find(item => item.id === 'agent-native')).toMatchObject({category: 'agent', assetKey: 'native-agent'});
    expect(catalog.find(item => item.id === 'glove-stock')).toMatchObject({category: 'gloves', price: 0});
    expect(catalog.find(item => item.id === 'agent-stock')).toMatchObject({category: 'agent', price: 0});
    expect(cosmeticPrice(catalog.find(item => item.id === 'legacy-no-price')!)).toBe(520);
    expect(cosmeticCategory(definitions[1])).toBe('weapon');
    expect(cosmeticCategory(definitions[2])).toBe('knife');
  });
  it.each([0, -1, .5, NaN, Infinity, MAX_CREDITS + 1])('rejects nondefault price outside exact integer caps: %s', price => {
    expect(prepareCosmeticCatalog([{...definitions[1], price}]).some(item => item.id === 'test-finish')).toBe(false);
  });
  it('accepts the exact maximum price and rejects category/slot mismatches', () => {
    expect(prepareCosmeticCatalog([{...definitions[1], price: MAX_CREDITS}])[1].price).toBe(MAX_CREDITS);
    expect(prepareCosmeticCatalog([{...definitions[1], category: 'agent'}, {...definitions[1], id: 'bad-slot', equipment: 'glove', category: 'gloves'}])).toHaveLength(1);
  });
});

describe('v1 migration without losing earned cosmetics', () => {
  it('migrates immediately on the same key, retaining XP, implicit unlocks and equipped items once', () => {
    const {storage, data} = memory({version: 1, xp: xpForLevel(20), equipped: {ak47: 'test-finish', knife: BUTTERFLY_EMERALD_ID}});
    const controller = createProgressionController({storage, catalog: definitions});
    expect(controller.getSnapshot().profile).toMatchObject({version: 2, xp: xpForLevel(20), balance: 0, creditsEarned: 0, creditsSpent: 0,
      owned: [STANDARD_KNIFE_ID, 'test-stock', 'test-finish', BUTTERFLY_EMERALD_ID], milestones: ['level-10', 'level-20'],
      equipped: {ak47: 'test-finish', knife: BUTTERFLY_EMERALD_ID}});
    expect(JSON.parse(data.get(PROGRESSION_KEY)!).version).toBe(2);
    const expanded = [...definitions, {...definitions[1], id: 'new-finish', unlockLevel: 1}];
    const reload = createProgressionController({storage, catalog: expanded});
    expect(reload.getSnapshot().profile.owned).not.toContain('new-finish');
    expect(reload.equip('ak47', 'new-finish')).toBe(false);
    expect(award(reload).credits).toBe(90);
  });
  it('retains equipped legacy items if the new catalog raises their unlock level', () => {
    const {storage} = memory({version: 1, xp: xpForLevel(2), equipped: {ak47: 'test-finish'}});
    const controller = createProgressionController({storage, catalog: [{...definitions[1], unlockLevel: 90}]});
    expect(equippedCosmetic(controller.getSnapshot().profile, controller.catalog, 'ak47')?.id).toBe('test-finish');
    expect(controller.resetEquipment('ak47')).toBe(true);
    expect(controller.equip('ak47', 'test-finish')).toBe(true);
  });
  it('retains retired owned IDs and equipped slots across catalog removal/reintroduction', () => {
    const profile = sanitizeProgression(savedProfile({owned: ['retired-finish'], equipped: {ak47: 'retired-finish'}}));
    expect(profile.owned).toContain('retired-finish');
    expect(profile.equipped.ak47).toBe('retired-finish');
    const catalog = prepareCosmeticCatalog([{...definitions[1], id: 'retired-finish'}]);
    expect(equippedCosmetic(sanitizeProgression(profile, catalog), catalog, 'ak47')?.id).toBe('retired-finish');
  });
  it('continues safely in memory when the migration write fails', () => {
    const {storage} = memory({version: 1, xp: xpForLevel(20), equipped: {knife: BUTTERFLY_EMERALD_ID}});
    storage.setItem = vi.fn(() => {throw Error('quota');});
    const controller = createProgressionController({storage, catalog: definitions});
    expect(controller.getSnapshot().storageStatus).toBe('memory-only');
    expect(controller.getSnapshot().profile.owned).toContain(BUTTERFLY_EMERALD_ID);
    expect(controller.equip('knife', BUTTERFLY_EMERALD_ID)).toBe(true);
  });
  it('never overwrites unreadable storage and never touches a future version', () => {
    const setItem = vi.fn();
    const unreadable = createProgressionController({storage: {getItem() {throw Error('read blocked');}, setItem}, catalog: definitions});
    award(unreadable); award(unreadable); unreadable.purchase('test-finish');
    expect(setItem).not.toHaveBeenCalled();
    const {storage, data} = memory({version: 999, balance: 8_000_000, xp: MAX_XP, owned: ['future'], unknown: {keep: true}});
    const original = data.get(PROGRESSION_KEY), future = createProgressionController({storage, catalog: definitions});
    award(future); award(future); future.purchase('test-finish'); future.equip('ak47', 'test-finish');
    expect(data.get(PROGRESSION_KEY)).toBe(original);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(future.getSnapshot().storageStatus).toBe('unsupported-version');
  });
});

describe('earned currency and deliberate purchases', () => {
  it('derives deterministic modest drill credits and preserves duel fairness weights', () => {
    expect(creditsForXp(151, 'duel')).toBe(90);
    expect(creditsForXp(12, 'guided')).toBe(4);
    for (const mode of ['guided', 'spray', 'transfer', 'peek', 'precision', 'burst'] as const) {
      expect(creditsForXp(evaluateDrillXp(mode, drill()).xp, mode)).toBeLessThan(creditsForXp(evaluateDuelXp(setup(), win()).xp, 'duel') / 10);
    }
    for (const config of [setup({bots: [bot({health: 20})]}), setup({bots: [bot({accuracy: .5})]}), setup({playerHealth: 500})]) {
      expect(creditsForXp(evaluateDuelXp(config, win(config)).xp, 'duel')).toBeLessThan(90);
    }
    for (const value of [-1, NaN, Infinity, .5, MAX_XP + 1]) expect(creditsForXp(value, 'duel')).toBe(0);
  });
  it('does not auto-own level-eligible skins, even at level 100, and prevents unowned equips', () => {
    const {storage} = memory(savedProfile({xp: xpForLevel(100), balance: 50_000}));
    const controller = createProgressionController({storage, catalog: definitions});
    expect(controller.getSnapshot().profile.owned).toEqual([STANDARD_KNIFE_ID, 'test-stock']);
    expect(controller.equip('ak47', 'test-finish')).toBe(false);
    expect(controller.equip('knife', BUTTERFLY_EMERALD_ID)).toBe(false);
    expect(controller.canPurchase(BUTTERFLY_EMERALD_ID)).toBe(true);
    expect(controller.purchase(BUTTERFLY_EMERALD_ID)).toMatchObject({success: true, reason: 'purchased', spent: 40_000});
    expect(controller.getSnapshot().profile.equipped.knife).toBe(STANDARD_KNIFE_ID);
    expect(controller.equip('knife', BUTTERFLY_EMERALD_ID)).toBe(true);
  });
  it('buys at the exact balance and level, preserves the ledger, and is spend-idempotent after reload', () => {
    const {storage} = memory(savedProfile({xp: xpForLevel(2), balance: 180}));
    const controller = createProgressionController({storage, catalog: definitions}), listener = vi.fn();
    controller.subscribe(listener);
    expect(controller.canPurchase('test-finish')).toBe(true);
    expect(controller.purchase('test-finish')).toEqual({success: true, reason: 'purchased', cosmeticId: 'test-finish', spent: 180});
    const purchased = controller.getSnapshot();
    expect(purchased.profile).toMatchObject({balance: 0, creditsEarned: 180, creditsSpent: 180});
    expect(ownsCosmetic(purchased.profile, definitions[1])).toBe(true);
    expect(controller.canPurchase('test-finish')).toBe(false);
    expect(controller.purchase('test-finish')).toMatchObject({success: true, reason: 'already-owned', spent: 0});
    expect(controller.getSnapshot()).toBe(purchased);
    expect(listener).toHaveBeenCalledTimes(1);
    const reloaded = createProgressionController({storage, catalog: definitions});
    expect(reloaded.purchase('test-finish')).toMatchObject({reason: 'already-owned', spent: 0});
    expect(reloaded.getSnapshot().profile).toEqual(purchased.profile);
  });
  it('denies unknown, locked, and unaffordable items with no mutation or write', () => {
    const {storage} = memory(savedProfile({balance: 179, xp: xpForLevel(2)}));
    const controller = createProgressionController({storage, catalog: definitions}), before = controller.getSnapshot();
    for (const [id, reason] of [['missing', 'unknown-cosmetic'], [BUTTERFLY_EMERALD_ID, 'level-locked'], ['test-finish', 'insufficient-credits']] as const) {
      expect(controller.canPurchase(id)).toBe(false);
      expect(controller.purchase(id)).toMatchObject({success: false, reason, spent: 0});
      expect(controller.getSnapshot()).toBe(before);
    }
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('owns and equips all stock categories for free without awarding or spending credits', () => {
    const extras: CosmeticDefinition[] = ['gloves', 'agent'].map(equipment => ({id: `${equipment}-stock`, equipment, label: 'Stock', unlockLevel: 1, isDefault: true}));
    const controller = createProgressionController({storage: null, catalog: [...definitions, ...extras]});
    for (const item of [...extras, definitions[0]]) {
      expect(controller.purchase(item.id)).toMatchObject({success: true, reason: 'already-owned', spent: 0});
      expect(controller.equip(item.equipment, item.id)).toBe(true);
    }
    expect(controller.getSnapshot().profile).toMatchObject({balance: 0, creditsEarned: 0, creditsSpent: 0});
  });
  it('keeps a purchase coherent and idempotent in memory on quota failure', () => {
    const {storage} = memory(savedProfile({balance: 180, xp: xpForLevel(2)}));
    storage.setItem = vi.fn(() => {throw Error('quota');});
    const controller = createProgressionController({storage, catalog: definitions});
    expect(controller.purchase('test-finish').success).toBe(true);
    expect(controller.getSnapshot().storageStatus).toBe('memory-only');
    expect(controller.purchase('test-finish')).toMatchObject({reason: 'already-owned', spent: 0});
    expect(controller.getSnapshot().profile).toMatchObject({balance: 0, creditsSpent: 180});
  });
  it('awards no credits, completions or milestones for AFK, reset, duplicate, cancelled or edited attempts', () => {
    const controller = createProgressionController({storage: null}), config = setup(), initial = controller.getSnapshot();
    const afk = controller.beginDuel(config, '0')!;
    expect(controller.completeDuel(afk, partial(config, 0), config, '0').credits).toBe(0);
    expect(controller.completeDuel(afk, win(), config, '0').credits).toBe(0);
    const reset = controller.beginDuel(config, '0')!;
    expect(controller.completeDuel(reset, {...win(), completion: 'reset'}, config, '0').credits).toBe(0);
    const changed = controller.beginDuel(config, '0')!;
    expect(controller.completeDuel(changed, win(), config, '1').credits).toBe(0);
    const cancelled = controller.beginDrill('guided', '0')!;
    controller.cancelAttempt(cancelled);
    expect(controller.completeDrill(cancelled, drill(), '0').credits).toBe(0);
    expect(controller.getSnapshot()).toBe(initial);
  });
  it('awards a level and activity milestone together once, survives reload, and labels eligibility not ownership', () => {
    const {storage} = memory(savedProfile({xp: xpForLevel(10) - 1, completedDuels: 24}));
    const controller = createProgressionController({storage, catalog: [{...definitions[1], unlockLevel: 10}]});
    expect(award(controller)).toMatchObject({xp: 151, credits: 1840});
    expect(controller.getSnapshot().notification).toMatchObject({milestoneCredits: 1750, milestoneIds: ['level-10', 'rounds-25'], unlockedIds: ['test-finish']});
    expect(controller.getSnapshot().profile).toMatchObject({completedDuels: 25, balance: 1840, creditsEarned: 1840});
    expect(controller.getSnapshot().profile.owned).not.toContain('test-finish');
    const html = renderToStaticMarkup(createElement(XpNotification, {controller}));
    expect(html).toContain('Purchase eligible: Test finish');
    expect(html).toContain('Milestones: +1,750 credits included');
    const reload = createProgressionController({storage, catalog: definitions});
    expect(award(reload).credits).toBe(90);
    expect(reload.getSnapshot().profile.balance).toBe(1930);
  });
  it('counts successful drills separately, including only one-use approved attempts', () => {
    const controller = createProgressionController({storage: null});
    const id = controller.beginDrill('guided', '0')!;
    expect(controller.completeDrill(id, drill(), '0')).toMatchObject({xp: 12, credits: 4});
    expect(controller.getSnapshot().profile).toMatchObject({completedDuels: 0, completedDrills: 1, balance: 4});
    expect(controller.completeDrill(id, drill(), '0').credits).toBe(0);
    expect(controller.getSnapshot().profile.completedDrills).toBe(1);
  });
});

describe('exact economy boundaries and long-horizon rewards', () => {
  it.each([xpForLevel(100), xpForLevel(100) + 1000, MAX_XP])('keeps repeated duel and drill credits spendable after level 100 at %s XP', initialXp => {
    const claimedLevels = PROGRESSION_MILESTONES.filter(item => item.kind === 'level').map(item => item.id);
    const {storage} = memory(savedProfile({xp: initialXp, completedDuels: 22, milestones: claimedLevels}));
    const controller = createProgressionController({storage, catalog: definitions});
    let expectedXp = initialXp, expectedCredits = 0;
    for (let round = 1; round <= 3; round++) {
      const duelXp = Math.min(151, MAX_XP - expectedXp), milestoneCredits = round === 2 ? 250 : 0;
      expect(award(controller)).toEqual({awarded: true, xp: duelXp, credits: 90 + milestoneCredits, reason: 'earned'});
      expectedXp += duelXp;
      expectedCredits += 90 + milestoneCredits;
      expect(controller.getSnapshot().notification).toMatchObject({source: 'duel', levelBefore: 100, levelAfter: 100,
        milestoneCredits, milestoneIds: round === 2 ? ['rounds-25'] : [], unlockedIds: []});
      const drillId = controller.beginDrill('guided', '0')!, drillXp = Math.min(12, MAX_XP - expectedXp);
      expect(controller.completeDrill(drillId, drill(), '0')).toEqual({awarded: true, xp: drillXp, credits: 4, reason: 'earned'});
      expectedXp += drillXp;
      expectedCredits += 4;
      expect(controller.getSnapshot().profile).toMatchObject({xp: expectedXp, balance: expectedCredits, creditsEarned: expectedCredits,
        completedDuels: 22 + round, completedDrills: round, milestones: round === 1 ? claimedLevels : [...claimedLevels, 'rounds-25']});
      expect(controller.getSnapshot().notification).toMatchObject({source: 'guided', levelBefore: 100, levelAfter: 100, milestoneCredits: 0, milestoneIds: []});
      const settled = controller.getSnapshot();
      expect(controller.completeDrill(drillId, drill(), '0')).toMatchObject({awarded: false, xp: 0, credits: 0, reason: 'unknown-attempt'});
      expect(controller.getSnapshot()).toBe(settled);
    }
    const reload = createProgressionController({storage, catalog: definitions});
    expect(reload.getSnapshot().profile).toEqual(controller.getSnapshot().profile);
    expect(reload.getSnapshot().notification).toBeNull();
    expect(reload.purchase('test-finish')).toMatchObject({success: true, reason: 'purchased', spent: 180});
    expectedCredits += 90;
    expect(award(reload)).toMatchObject({awarded: true, xp: Math.min(151, MAX_XP - expectedXp), credits: 90});
    const profile = reload.getSnapshot().profile;
    expect(profile).toMatchObject({balance: expectedCredits - 180, creditsEarned: expectedCredits, creditsSpent: 180, completedDuels: 26, completedDrills: 3});
    expect(profile.creditsEarned - profile.creditsSpent).toBe(profile.balance);
    expect(levelProgress(profile.xp).level).toBe(100);
  });
  it('caps wallet payouts exactly and never duplicates clipped milestone credits', () => {
    const {storage} = memory(savedProfile({xp: xpForLevel(10) - 1, balance: MAX_CREDITS - 2, completedDuels: 24}));
    const controller = createProgressionController({storage});
    expect(award(controller)).toMatchObject({xp: 151, credits: 2});
    expect(controller.getSnapshot().profile).toMatchObject({balance: MAX_CREDITS, creditsEarned: MAX_CREDITS, milestones: ['level-10', 'rounds-25']});
    expect(controller.getSnapshot().notification?.milestoneCredits).toBe(0);
    expect(award(controller).credits).toBe(0);
  });
  it('continues currency after XP cap and stops exactly at the lifetime earned counter cap', () => {
    const {storage} = memory(savedProfile({xp: MAX_XP, balance: 100, creditsSpent: MAX_CREDIT_COUNTER - 102,
      completedDuels: MAX_COMPLETIONS, milestones: PROGRESSION_MILESTONES.map(item => item.id)}));
    const controller = createProgressionController({storage});
    expect(award(controller)).toMatchObject({awarded: true, xp: 0, credits: 2});
    expect(controller.getSnapshot().profile).toMatchObject({balance: 102, creditsEarned: MAX_CREDIT_COUNTER, completedDuels: MAX_COMPLETIONS});
    expect(award(controller)).toMatchObject({awarded: false, xp: 0, credits: 0});
  });
  it.each([-1, .5, Infinity, NaN, MAX_CREDITS + 1])('rejects malformed wallet amounts without fractional or cap overflow: %s', balance => {
    expect(sanitizeProgression(savedProfile({balance})).balance).toBe(0);
  });
  it('sanitizes exact ledger limits, integer totals and immutable collections', () => {
    const profile = sanitizeProgression(savedProfile({xp: .5, balance: MAX_CREDITS, creditsSpent: MAX_CREDIT_COUNTER,
      creditsEarned: -100, completedDuels: .5, completedDrills: MAX_COMPLETIONS + 1, owned: ['safe', 'safe', '__proto__', 'a'.repeat(97)], milestones: ['rounds-25', '__proto__']}));
    expect(profile).toMatchObject({xp: 0, balance: MAX_CREDITS, creditsSpent: MAX_CREDIT_COUNTER - MAX_CREDITS, creditsEarned: MAX_CREDIT_COUNTER, completedDuels: 0, completedDrills: 0});
    expect(profile.owned).toEqual([STANDARD_KNIFE_ID, 'safe']);
    expect(profile.milestones).toEqual(['rounds-25']);
    expect(Object.isFrozen(profile.owned)).toBe(true);
    expect(Object.isFrozen(profile.milestones)).toBe(true);
    expect(profile.creditsEarned - profile.creditsSpent).toBe(profile.balance);
  });
  it('retains the exact 358k XP curve and bounded one-time milestone budget', () => {
    expect(xpForLevel(100)).toBe(357_885);
    expect(PROGRESSION_MILESTONES.reduce((sum, item) => sum + item.credits, 0)).toBe(162_750);
    expect(new Set(PROGRESSION_MILESTONES.map(item => item.id)).size).toBe(PROGRESSION_MILESTONES.length);
    const firstPrice = 350, ordinaryReward = creditsForXp(evaluateDuelXp(setup(), win()).xp, 'duel');
    expect(Math.ceil(firstPrice / ordinaryReward)).toBe(4);
    const prices = [350, 700, 1200, 1900, 2800, 4000, 5500, 7500, 10000, 13000];
    expect(prices.reduce((sum, price) => sum + price, 0) * 30).toBe(1_408_500);
    // The 2M planning budget, high-fair duel average 160 credits, 20-40 rounds/hour.
    const rounds = (2_000_000 - 162_750) / 160;
    expect(rounds / 40).toBeGreaterThan(280);
    expect(rounds / 20).toBeLessThan(600);
  });
});
