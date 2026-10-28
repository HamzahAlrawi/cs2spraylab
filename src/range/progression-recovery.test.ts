import {afterEach, describe, expect, it, vi} from 'vitest';
import aliases from './gift-code-aliases.json';
import * as gifts from './gift-codes';
import {createProgressionController, levelGiftEntitlement, PROGRESSION_KEY, sanitizeProgression, xpForLevel, type ProgressionStorage} from './progression';
import {decodeProfileCopy, profileCopy, progressionBackupKeys, type ProfileCopy, type ProfileMirror} from './progression-persistence';

const token = Object.values(aliases.codes)[0];
function memory(raw?: unknown) {
  const data = new Map<string, string>();
  if (raw) data.set(PROGRESSION_KEY, JSON.stringify(raw));
  const storage: ProgressionStorage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => {data.set(key, value);}};
  return {data, storage};
}
const profile = (patch: Record<string, unknown> = {}) => sanitizeProgression({version: 2, xp: xpForLevel(10), balance: 500,
  owned: ['retired-finish'], creditsSpent: 300, equipped: {ak47: 'retired-finish'}, ...patch});
const catalog = [{id: 'test-finish', equipment: 'ak47', label: 'Test finish', unlockLevel: 1, price: 200}];
afterEach(() => vi.restoreAllMocks());

describe('durable profile recovery', () => {
  it.each(['deleted', 'corrupt'])('recovers a %s primary without losing collection, wallet or gift receipts', async failure => {
    const {storage, data} = memory(profile());
    const first = createProgressionController({storage, catalog});
    await first.redeemCode(token); first.purchase('test-finish'); first.equip('ak47', 'test-finish');
    const expected = first.getSnapshot().profile;
    if (failure === 'deleted') data.delete(PROGRESSION_KEY); else data.set(PROGRESSION_KEY, '{bad');
    const restored = createProgressionController({storage, catalog});
    expect(restored.getSnapshot().profile).toEqual(expected);
    expect(restored.getSnapshot().storageStatus).toBe('saved');
    expect((await restored.redeemCode(token)).reason).toBe('already-redeemed');
    if (failure === 'corrupt') expect(data.get(`${PROGRESSION_KEY}.corrupt`)).toBe('{bad');
  });
  it('falls back to the older copy if the latest copy is damaged too', () => {
    const {storage, data} = memory(profile());
    const first = createProgressionController({storage, catalog}); first.purchase('test-finish');
    const [latest, previous] = progressionBackupKeys(PROGRESSION_KEY);
    const expected = decodeProfileCopy(JSON.parse(data.get(previous)!))!.profile;
    data.delete(PROGRESSION_KEY); data.set(latest, '{bad');
    expect(createProgressionController({storage, catalog}).getSnapshot().profile).toEqual(expected);
  });
  it('does not overwrite corrupt original bytes if quarantining them fails', () => {
    const {data, storage} = memory(); data.set(PROGRESSION_KEY, '{original');
    storage.setItem = () => {throw Error('quota');};
    const controller = createProgressionController({storage});
    expect(controller.getSnapshot().storageStatus).toBe('corrupt-save');
    controller.resetEquipment('knife');
    expect(data.get(PROGRESSION_KEY)).toBe('{original');
  });
  it('can save in the recovery slot when the main-key write fails', () => {
    const {data, storage} = memory(profile());
    const set = storage.setItem;
    storage.setItem = (key, value) => {if (key === PROGRESSION_KEY) throw Error('quota'); set(key, value);};
    const first = createProgressionController({storage, catalog}); first.purchase('test-finish');
    expect(first.getSnapshot().storageStatus).toBe('saved');
    const restored = createProgressionController({storage, catalog});
    expect(restored.getSnapshot().profile.owned).toContain('test-finish');
    expect(restored.getSnapshot().profile.balance).toBe(300);
    expect(JSON.parse(data.get(PROGRESSION_KEY)!).balance).toBe(500);
  });
  it('refreshes a stale tab before it spends credits or changes equipment', async () => {
    const {storage} = memory(profile());
    const first = createProgressionController({storage, catalog}), stale = createProgressionController({storage, catalog});
    await first.redeemCode(token);
    expect(stale.purchase('test-finish').success).toBe(true);
    first.equip('ak47', 'test-finish');
    expect(first.getSnapshot().profile).toEqual(stale.getSnapshot().profile.equipped.ak47 === 'test-finish' ? stale.getSnapshot().profile :
      {...stale.getSnapshot().profile, equipped: {...stale.getSnapshot().profile.equipped, ak47: 'test-finish'}});
    expect(first.getSnapshot().profile.xp).toBe(xpForLevel(50));
    expect(first.getSnapshot().profile.balance).toBe(72_261);
  });
  it('preserves unsupported saves in either slot', () => {
    for (const key of [PROGRESSION_KEY, ...progressionBackupKeys(PROGRESSION_KEY)]) {
      const {storage, data} = memory(profile());
      const future = {version: 999, xp: 20000, future: true};
      data.set(key, JSON.stringify(key === PROGRESSION_KEY ? future : {...profileCopy(profile(), 1), profile: future}));
      // Make the fixture a valid envelope with a future profile.
      if (key !== PROGRESSION_KEY) data.set(key, JSON.stringify(profileCopy(future as never, 1)));
      const before = [...data], controller = createProgressionController({storage});
      controller.resetEquipment('knife');
      expect(controller.getSnapshot().storageStatus).toBe('unsupported-version'); expect([...data]).toEqual(before);
    }
  });
  it('restores the independent mirror after localStorage-only clearing and waits before issuing attempts', async () => {
    const {storage} = memory(); let resolve!: (value: unknown) => void;
    const mirror: ProfileMirror = {read: () => new Promise(done => {resolve = done;}), write: vi.fn(async () => true)};
    const controller = createProgressionController({storage, mirror});
    expect(controller.beginDrill('guided', 'test')).toBeNull();
    resolve(profileCopy(profile(), 100)); await controller.ready;
    expect(controller.getSnapshot().profile).toEqual(profile());
    expect(controller.beginDrill('guided', 'test')).not.toBeNull();
  });
  it('compares mirror revision before reseeding local backups', async () => {
    const {storage} = memory({...profile({xp: 100}), saveRevision: 1});
    const better = profile({xp: xpForLevel(50)});
    const mirror = {read: async () => profileCopy(better, 100), write: vi.fn(async () => true)};
    const controller = createProgressionController({storage, mirror}); await controller.ready;
    expect(controller.getSnapshot().profile.xp).toBe(better.xp);
    expect(JSON.parse(storage.getItem(PROGRESSION_KEY)!).xp).toBe(better.xp);
  });
  it('does not roll back a newer local profile to an older independent copy', async () => {
    const {storage} = memory({...profile({xp: xpForLevel(60)}), saveRevision: 200});
    const mirror = {read: async () => profileCopy(profile(), 100), write: vi.fn(async () => true)};
    const controller = createProgressionController({storage, mirror}); await controller.ready;
    expect(controller.getSnapshot().profile.xp).toBe(xpForLevel(60));
  });
  it('rechecks local saves after a delayed mirror read instead of stamping a stale startup snapshot', async () => {
    const {storage} = memory({...profile({xp: 100}), saveRevision: 1});
    let resolve!: (copy: unknown) => void;
    const mirror = {read: () => new Promise(done => {resolve = done;}), write: vi.fn(async () => true)};
    const waiting = createProgressionController({storage, mirror});
    const second = createProgressionController({storage}); await second.redeemCode(token);
    const expected = second.getSnapshot().profile;
    resolve(profileCopy(profile({xp: 100}), 1)); await waiting.ready;
    expect(waiting.getSnapshot().profile).toEqual(expected);
    expect(JSON.parse(storage.getItem(PROGRESSION_KEY)!).xp).toBe(xpForLevel(50));
  });
  it('never repairs an old startup snapshot over a future primary written during hydration', async () => {
    const {storage, data} = memory({...profile(), saveRevision: 1});
    let resolve!: (copy: unknown) => void;
    const mirror = {read: () => new Promise(done => {resolve = done;}), write: vi.fn(async () => true)};
    const controller = createProgressionController({storage, mirror});
    const future = JSON.stringify({version: 999, xp: 999999, future: true}); data.set(PROGRESSION_KEY, future);
    resolve(undefined); await controller.ready;
    expect(data.get(PROGRESSION_KEY)).toBe(future);
    expect(controller.getSnapshot().storageStatus).toBe('unsupported-version'); expect(mirror.write).not.toHaveBeenCalled();
  });
  it('keeps uncommitted quota-failed progress exportable without labelling it saved or replacing the last durable mirror', async () => {
    const {storage} = memory(profile()); let copied: ProfileCopy | undefined;
    const mirror = {read: async () => undefined, write: vi.fn(async (copy: ProfileCopy) => {copied = copy; return true;})};
    const controller = createProgressionController({storage, mirror}); await controller.ready;
    await new Promise(resolve => setTimeout(resolve, 0)); mirror.write.mockClear();
    storage.setItem = () => {throw Error('quota');};
    const id = controller.beginDrill('guided', 'same')!;
    controller.completeDrill(id, {completion: 'completed', objectiveCompleted: true, score: 80, shots: 10, hits: 5,
      activeSeconds: 10, movementReps: 0, targetsHit: 1}, 'same');
    const xp = controller.getSnapshot().profile.xp;
    expect(xp).toBeGreaterThan(profile().xp);
    expect(controller.getSnapshot().storageStatus).toBe('memory-only');
    expect(JSON.parse(controller.exportBackup()).copy.profile.xp).toBe(xp);
    expect(mirror.write).not.toHaveBeenCalled();
    expect((copied?.profile as {xp: number}).xp).toBe(profile().xp);
  });
  it('protects future independent copies instead of writing an older schema over them', async () => {
    const {storage} = memory(profile());
    const mirror = {read: async () => profileCopy({version: 999} as never, 100), write: vi.fn(async () => true)};
    const controller = createProgressionController({storage, mirror}); await controller.ready;
    controller.resetEquipment('knife');
    expect(controller.getSnapshot().storageStatus).toBe('unsupported-version'); expect(mirror.write).not.toHaveBeenCalled();
  });
});

describe('gifts and portable recovery', () => {
  it('gives level 50 and a transparent Duel-heavy credit allowance without inventing games', async () => {
    expect(levelGiftEntitlement(50)).toMatchObject({xp: 91_385, playCredits: 50_261, milestoneCredits: 22_500, credits: 72_761});
    const {storage} = memory(), controller = createProgressionController({storage});
    expect(await controller.redeemCode(token)).toMatchObject({success: true, xp: 91_385, credits: 72_761, level: 50});
    const saved = controller.getSnapshot().profile;
    expect(saved).toMatchObject({xp: 91_385, balance: 72_761, creditsEarned: 72_761, completedDuels: 0, completedDrills: 0});
    expect(saved.milestones).toEqual(['level-10', 'level-20', 'level-30', 'level-40', 'level-50']);
    expect(saved.achievements.stats.duelWins).toBe(0); expect(saved.achievements.unlocked).not.toHaveProperty('wins-1');
    expect(saved.achievements.unlocked).toHaveProperty('career-50');
    expect((await controller.redeemCode('SPRAYLAB-L50-045794E5F92C1EAF')).reason).toBe('already-redeemed');
  });
  it('tops up lifetime earnings, preserving purchases rather than refunding spent credits', async () => {
    const {storage} = memory(profile()), controller = createProgressionController({storage});
    expect((await controller.redeemCode(token)).credits).toBe(71_961);
    expect(controller.getSnapshot().profile).toMatchObject({balance: 72_461, creditsSpent: 300, creditsEarned: 72_761});
    expect(controller.getSnapshot().profile.owned).toContain('retired-finish');
  });
  it('never reduces a higher-level player or adds the whole allowance a second time', async () => {
    const {storage} = memory(profile({xp: xpForLevel(70), balance: 80000})), controller = createProgressionController({storage});
    expect(await controller.redeemCode(token)).toMatchObject({success: true, xp: 0, credits: 0, level: 70});
    expect(controller.getSnapshot().profile.balance).toBe(80000);
  });
  it('does not consume the gift when every synchronous save write fails', async () => {
    const {storage} = memory(), controller = createProgressionController({storage});
    storage.setItem = () => {throw Error('quota');};
    expect((await controller.redeemCode(token)).reason).toBe('storage-unavailable');
    expect(controller.getSnapshot().profile.redeemedGifts).toEqual([]);
    expect(controller.getSnapshot().profile.xp).toBe(0);
    expect(controller.getSnapshot().storageStatus).toBe('memory-only');
  });
  it('applies signed XP/credit grants with earned level milestones once', async () => {
    vi.spyOn(gifts, 'verifyGiftCode').mockResolvedValue({success: true, payload: {v: 1, kid: 'test', id: 'grant-1', label: 'Test',
      reward: {kind: 'grant', xp: xpForLevel(10), credits: 20}}});
    const {storage} = memory(), controller = createProgressionController({storage});
    expect(await controller.redeemCode('test')).toMatchObject({success: true, credits: 1520, level: 10});
    expect((await controller.redeemCode('test')).reason).toBe('already-redeemed');
  });
  it('exports a complete profile and rejects tampering without changing the active save', async () => {
    const {storage} = memory(), controller = createProgressionController({storage, catalog});
    await controller.redeemCode(token); controller.purchase('test-finish');
    const text = controller.exportBackup(), exported = JSON.parse(text);
    exported.copy.profile.balance++;
    const before = controller.getSnapshot();
    expect(controller.restoreBackup(JSON.stringify(exported)).reason).toBe('invalid-backup');
    expect(controller.getSnapshot()).toBe(before);
    const second = createProgressionController({storage: memory().storage, catalog});
    expect(second.restoreBackup(text)).toMatchObject({success: true, level: 50});
    expect(second.getSnapshot().profile).toEqual(controller.getSnapshot().profile);
    expect((await second.redeemCode(token)).reason).toBe('already-redeemed');
  });
  it('restoring an older backup cannot remove already claimed gift receipts', async () => {
    const controller = createProgressionController({storage: memory().storage});
    const old = controller.exportBackup(); await controller.redeemCode(token);
    expect(controller.restoreBackup(old).success).toBe(true);
    expect((await controller.redeemCode(token)).reason).toBe('already-redeemed');
  });
  it('rejects malformed/oversize imports, unsupported versions, and session-only redemption', async () => {
    const controller = createProgressionController({storage: memory().storage});
    for (const text of ['{', '{}', ' '.repeat(1_000_001)]) expect(controller.restoreBackup(text).reason).toBe('invalid-backup');
    const unsupported = JSON.parse(controller.exportBackup()); unsupported.copy = profileCopy({version: 999} as never, 1);
    expect(controller.restoreBackup(JSON.stringify(unsupported)).reason).toBe('unsupported-version');
    const session = createProgressionController({storage: null});
    expect((await session.redeemCode(token)).reason).toBe('storage-unavailable');
  });
});
