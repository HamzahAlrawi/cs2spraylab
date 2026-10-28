import {afterEach, expect, it, vi} from 'vitest';
import {defaults} from './config';
import {setupKey} from './setup-key';
import {loadRetention, saveRetention} from './practice-retention';

afterEach(() => vi.unstubAllGlobals());
it('retains the exact Duel setup fingerprint without trusting malformed storage', () => {
  let saved: string | null = null;
  vi.stubGlobal('localStorage', {getItem: () => saved, setItem: (_key: string, value: string) => {saved = value;}, removeItem: () => {saved = null;}});
  const check = {plan: {skill: 'Shot discipline', target: 95, baseline: 40, reps: 3 as const, lesson: 0 as const},
    settings: {...defaults, mode: 'duel' as const}, due: '2026-10-17T12:00:00.000Z', duelSetupKey: setupKey({skill: 3, bots: 2})};
  saveRetention(check); expect(loadRetention()?.duelSetupKey).toBe(check.duelSetupKey);
  saveRetention({...check, duelSetupKey: 'invalid'}); expect(loadRetention()?.duelSetupKey).toBeUndefined();
  saved = '{'; expect(loadRetention()).toBeUndefined();
  saveRetention(); expect(saved).toBeNull();
});
