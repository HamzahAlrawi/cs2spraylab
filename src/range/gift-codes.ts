import publicKeys from './gift-public-keys.json';
import aliases from './gift-code-aliases.json';

export type GiftReward = {kind: 'grant'; xp: number; credits: number} |
  {kind: 'restore-level'; level: number; duelShare: number};
export type GiftPayload = {v: 1; kid: string; id: string; label: string; reward: GiftReward; expiresAt?: number};
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const integer = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
export function validGiftPayload(raw: unknown): raw is GiftPayload {
  const value = raw as GiftPayload, reward = value?.reward;
  return !!value && value.v === 1 && identifier(value.kid) && identifier(value.id) && typeof value.label === 'string' &&
    value.label.trim().length > 0 && value.label.length <= 120 &&
    (value.expiresAt === undefined || integer(value.expiresAt, 8_640_000_000_000_000)) && !!reward &&
    (reward.kind === 'grant' ? integer(reward.xp, 100_000_000) && integer(reward.credits, 100_000_000) && reward.xp + reward.credits > 0 :
      reward.kind === 'restore-level' && integer(reward.level, 100) && reward.level >= 2 &&
      typeof reward.duelShare === 'number' && Number.isFinite(reward.duelShare) && reward.duelShare >= 0 && reward.duelShare <= 1);
}
function decode(value: string): Uint8Array {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Invalid gift encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}
export async function verifyGiftCode(code: string, now = Date.now(), keys: Readonly<Record<string, JsonWebKey>> = publicKeys.keys): Promise<
  {success: true; payload: GiftPayload} | {success: false; reason: 'invalid-code' | 'expired'}> {
  try {
    if (typeof code !== 'string' || code.length > 4096 || !globalThis.crypto?.subtle) return {success: false, reason: 'invalid-code'};
    let token = code.trim().replace(/\s/g, '');
    if (!token.startsWith('SLG1.')) {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.toUpperCase()));
      const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      token = (aliases.codes as Record<string, string>)[hash] ?? '';
    }
    const [prefix, body, signature, extra] = token.split('.');
    if (prefix !== 'SLG1' || !body || !signature || extra !== undefined) return {success: false, reason: 'invalid-code'};
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(decode(body)));
    if (!validGiftPayload(payload) || !Object.prototype.hasOwnProperty.call(keys, payload.kid)) return {success: false, reason: 'invalid-code'};
    const key = await crypto.subtle.importKey('jwk', keys[payload.kid], {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
    const valid = await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, decode(signature), new TextEncoder().encode(`SLG1.${body}`));
    if (!valid) return {success: false, reason: 'invalid-code'};
    if (payload.expiresAt !== undefined && now >= payload.expiresAt) return {success: false, reason: 'expired'};
    return {success: true, payload};
  } catch {return {success: false, reason: 'invalid-code'};}
}
