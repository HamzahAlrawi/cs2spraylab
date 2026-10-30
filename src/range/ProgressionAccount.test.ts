import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ProgressionAccount, backupRestoreFeedback, downloadProgressionBackup, giftCodeFeedback, readProgressionBackup} from './ProgressionAccount';
import {XpNotification} from './ProgressionPanel';
import {createProgressionController, type ProgressionController, type XpNotice} from './progression';

const account = () => ({
  ...createProgressionController({storage: null}),
  ready: Promise.resolve(),
  redeemCode: vi.fn(async () => ({success: true, reason: 'redeemed' as const, xp: 100, credits: 50, level: 2})),
  exportBackup: vi.fn(() => '{"test":"backup"}'),
  restoreBackup: vi.fn(async () => ({success: true, reason: 'restored' as const, level: 2})),
});

afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers();});

describe('Save & gifts presentation', () => {
  it('is a collapsed, labelled section with accessible gift and backup inputs', () => {
    const controller = account();
    const html = renderToStaticMarkup(createElement(ProgressionAccount, {controller}));
    expect(html).toContain('<details class="progression-save-gifts" open="">');
    expect(html).toContain('<summary>Save &amp; gifts</summary>');
    expect(html).toMatch(/<label for="([^"]+)-gift">Gift code<\/label>/);
    expect(html).toMatch(/<textarea[^>]+id="[^"]+-gift"/);
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('spellcheck="false"');
    expect(html).toContain('Redeem</button>');
    expect(html).toContain('Export backup</button>');
    expect(html).toContain('Import backup</button>');
    expect(html).toMatch(/<label[^>]+for="[^"]+-file">Backup JSON file<\/label>/);
    expect(html).toContain('accept="application/json,.json"');
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(html).not.toContain('Replace progress</button>');
    expect(controller.redeemCode).not.toHaveBeenCalled();
    expect(controller.restoreBackup).not.toHaveBeenCalled();
    expect(controller.exportBackup).not.toHaveBeenCalled();
  });

  it('starts safely disabled while readiness and persistence are pending, without storage guarantees', () => {
    const html = renderToStaticMarkup(createElement(ProgressionAccount, {controller: account()}));
    expect(html).toContain('Loading progress...');
    expect(html).toContain('Checking persistent storage...');
    expect(html).toContain('Request persistent storage</button>');
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(5);
    expect(html).toContain('Retry saving progress</button>');
    expect(html).toContain('Progress is local to this browser. Clearing site data removes local copies. Export a backup to keep them.');
    expect(html).not.toMatch(/guaranteed|cloud sync|map cache/i);
  });
});

describe('account result feedback', () => {
  it('shows granted gift amounts and recovery level without leaking input', () => {
    expect(giftCodeFeedback({success: true, reason: 'redeemed', xp: 1234, credits: 5678, level: 9}))
      .toBe('Gift redeemed: +1,234 XP, +5,678 credits. Level 9.');
    expect(backupRestoreFeedback({success: true, reason: 'restored', level: 12})).toBe('Progress restored. Level 12.');
  });

  it.each([
    ['already-redeemed', 'already been redeemed'], ['invalid-code', 'invalid'], ['expired', 'expired'],
    ['storage-unavailable', 'Gift not redeemed: browser storage is unavailable'],
    ['unsupported-version', 'newer version'], ['disposed', 'no longer active'], ['busy', 'in progress'],
  ] as const)('explains gift failure %s', (reason, message) => {
    expect(giftCodeFeedback({success: false, reason, xp: 0, credits: 0, level: 1})).toContain(message);
  });

  it.each([
    ['invalid-backup', 'invalid or damaged'], ['unsupported-version', 'newer version'],
    ['storage-unavailable', 'browser storage is unavailable'], ['disposed', 'no longer active'],
  ] as const)('explains recovery failure %s', (reason, message) => {
    expect(backupRestoreFeedback({success: false, reason, level: 1})).toContain(message);
  });
});

describe('backup files', () => {
  it('preserves original JSON bytes for controller checksum validation', async () => {
    const text = '  {"metadata":{"checksum":"original"},"profile":{}}\n';
    await expect(readProgressionBackup({size: text.length, text: async () => text})).resolves.toBe(text);
  });

  it('rejects oversized files before reading them and accepts the exact limit', async () => {
    const text = vi.fn(async () => '{}');
    await expect(readProgressionBackup({size: 1024 * 1024 + 1, text})).rejects.toThrow('1 MB or smaller');
    expect(text).not.toHaveBeenCalled();
    await expect(readProgressionBackup({size: 1024 * 1024, text})).resolves.toBe('{}');
  });

  it('rejects malformed JSON and keeps raw parser/file errors out of feedback', async () => {
    await expect(readProgressionBackup({size: 5, text: async () => 'secret-invalid-json'})).rejects.toThrow('This file is not a valid JSON backup.');
    await expect(readProgressionBackup({size: 5, text: async () => {throw Error('secret-path');}})).rejects.toThrow('Could not read this backup. Choose the file again.');
  });

  it.each([false, true])('downloads real JSON and revokes its URL even when clicking fails (%s)', async failClick => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:test-backup'), revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {createObjectURL, revokeObjectURL});
    vi.stubGlobal('window', {setTimeout});
    const link = {href: '', download: '', hidden: false, click: vi.fn(() => {if (failClick) throw Error('blocked');}), remove: vi.fn()};
    const appendChild = vi.fn();
    vi.stubGlobal('document', {createElement: vi.fn(() => link), body: {appendChild}});
    const run = () => downloadProgressionBackup('{"profile":{"xp":123}}', new Date('2026-10-28T12:34:56.789Z'));
    if (failClick) expect(run).toThrow('blocked'); else run();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe('{"profile":{"xp":123}}');
    expect(link.download).toBe('spraylab-progress-2026-10-28T12-34-56-789Z.json');
    expect(link.href).toBe('blob:test-backup');
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-backup');
  });
});

describe('account XP notifications', () => {
  const renderNotice = (source: XpNotice['source'], unlockedIds: readonly string[] = []) => {
    const controller = account();
    const notification: XpNotice = {id: 'notice', source, xp: 100, credits: 50, levelBefore: 1, levelAfter: 2,
      unlockedIds, milestoneCredits: 0, milestoneIds: [], achievementIds: []};
    const snapshot = {...controller.getSnapshot(), notification};
    const fixture: ProgressionController = {...controller, getSnapshot: () => snapshot};
    return renderToStaticMarkup(createElement(XpNotification, {controller: fixture}));
  };

  it('identifies gift rewards without calling them drill completions', () => {
    const html = renderNotice('gift');
    expect(html).toContain('Gift redeemed | +100 XP | +50 credits | Level 2');
    expect(html).not.toContain('Drill complete');
  });

  it('identifies recovery without suggesting recovered XP was newly earned', () => {
    const html = renderNotice('recovery');
    expect(html).toContain('Progress restored | Level 2');
    expect(html).toContain('Backup recovery complete');
    expect(html).not.toContain('Drill complete');
    expect(html).not.toContain('+100 XP');
  });

  it('preserves drill and duel completion wording', () => {
    expect(renderNotice('guided')).toContain('Drill complete');
    expect(renderNotice('duel')).toContain('AI Duel complete');
  });
});
