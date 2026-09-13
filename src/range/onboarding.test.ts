import { afterEach, describe, expect, it, vi } from 'vitest';
import { markSetupHintSeen, needsSetupHint } from './onboarding';
afterEach(() => vi.unstubAllGlobals());
describe('first-visit Settings hint', () => {
  it('shows once for a fresh visitor, not on a later visit', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (k: string) => values.get(k), setItem: (k: string, v: string) => values.set(k, v)});
    expect(needsSetupHint()).toBe(true); markSetupHintSeen(); expect(needsSetupHint()).toBe(false);
  });
  it.each(['spraylab.range.v2', 'spraylab.settings.v1'])('does not interrupt an existing %s user', key => {
    vi.stubGlobal('localStorage', {getItem: (k: string) => k === key ? '{}' : null});
    expect(needsSetupHint()).toBe(false);
  });
  it('does not fail the app when storage is blocked', () => {
    vi.stubGlobal('localStorage', {getItem: () => {throw Error('Blocked');}, setItem: () => {throw Error('Blocked');}});
    expect(needsSetupHint()).toBe(true); expect(markSetupHintSeen).not.toThrow();
  });
});
