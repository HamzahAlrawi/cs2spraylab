import {generateKeyPairSync, sign} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import aliases from './gift-code-aliases.json';
import {validGiftPayload, verifyGiftCode, type GiftPayload} from './gift-codes';

const pair = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
const keys = {test: pair.publicKey.export({format: 'jwk'})};
const payload: GiftPayload = {v: 1, kid: 'test', id: 'test-gift', label: 'Test gift', reward: {kind: 'grant', xp: 250, credits: 100}};
function code(value: unknown) {
  const signed = `SLG1.${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
  return `${signed}.${sign('sha256', Buffer.from(signed), {key: pair.privateKey, dsaEncoding: 'ieee-p1363'}).toString('base64url')}`;
}
describe('public-key verified owner gifts', () => {
  it('verifies a signed grant, not an unsigned reward encoded as JSON', async () => {
    expect(await verifyGiftCode(code(payload), 100, keys)).toEqual({success: true, payload});
    const token = code(payload), parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify({...payload, reward: {kind: 'grant', xp: 1000000, credits: 1000000}})).toString('base64url');
    expect(await verifyGiftCode(parts.join('.'), 100, keys)).toEqual({success: false, reason: 'invalid-code'});
    expect(await verifyGiftCode(token.slice(0, -10), 100, keys)).toMatchObject({success: false});
    expect(await verifyGiftCode(code({...payload, kid: 'unknown'}), 100, keys)).toMatchObject({success: false});
  });
  it('enforces signed expiration at the boundary', async () => {
    const token = code({...payload, expiresAt: 1000});
    expect(await verifyGiftCode(token, 999, keys)).toMatchObject({success: true});
    expect(await verifyGiftCode(token, 1000, keys)).toEqual({success: false, reason: 'expired'});
  });
  it.each([null, {}, {...payload, id: '__proto__'}, {...payload, id: 'constructor'}, {...payload, id: 'prototype'}, {...payload, reward: {kind: 'grant', xp: -1, credits: 0}},
    {...payload, reward: {kind: 'grant', xp: 0, credits: 0}}, {...payload, reward: {kind: 'restore-level', level: 101, duelShare: .8}},
    {...payload, reward: {kind: 'restore-level', level: 50, duelShare: 2}}])('rejects malformed signed claims %#', async value => {
    expect(validGiftPayload(value)).toBe(false);
    expect(await verifyGiftCode(code(value), 100, keys)).toMatchObject({success: false});
  });
  it('validates the shipped level-50 campaign with only the public issuer key', async () => {
    const token = Object.values(aliases.codes)[0];
    const result = await verifyGiftCode(token);
    expect(result).toMatchObject({success: true, payload: {id: 'recovery-level50-20261028', reward: {kind: 'restore-level', level: 50, duelShare: .8}}});
    expect(await verifyGiftCode('  spraylab-l50-045794e5f92c1eaf  ')).toEqual(result);
  });
});
