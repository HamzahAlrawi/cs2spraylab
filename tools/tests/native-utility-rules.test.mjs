import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseUtilityCfg, parseValveKeyValues, scanUtilityConvarNames, selectUtilityWeapons} from '../import-native-utility-rules.mjs';

test('CFG lexer preserves quoted comments/semicolons and rejects commented assignments', () => {
  assert.deepEqual(parseUtilityCfg('// ignored 3\n"ammo_grenade_limit_total" 4 // shipped override\nfoo "a;b//c"; foo 2\n/* no 3 */ bar ""'), [
    {key: 'ammo_grenade_limit_total', args: ['4'], line: 2},
    {key: 'foo', args: ['a;b//c'], line: 3}, {key: 'foo', args: ['2'], line: 3},
    {key: 'bar', args: [''], line: 4},
  ]);
});

test('KV1 parser preserves duplicate exec directives and offline scope/order', () => {
  const [mode] = parseValveKeyValues('"competitive" { "exec" { "exec" "base.cfg" "exec_offline" "offline.cfg" "exec" "server.cfg" } }');
  assert.equal(mode.key, 'competitive');
  assert.deepEqual(mode.value[0].value.map(n => [n.key, n.value]),
    [['exec', 'base.cfg'], ['exec_offline', 'offline.cfg'], ['exec', 'server.cfg']]);
  assert.throws(() => parseValveKeyValues('a { b "c"'), /Unclosed/);
  assert.throws(() => parseValveKeyValues('a'), /Missing/);
});

test('binary inventory records exact name offsets only, never nearby numbers as defaults', () => {
  assert.deepEqual(scanUtilityConvarNames(Buffer.from('\0sv_gravity\0' + '800\0' + 'inferno_expire\0' + 'molotov_throw_detonate_time\0')),
    [{name: 'sv_gravity', fileOffset: '0x1'}, {name: 'molotov_throw_detonate_time', fileOffset: '0x1f'}]);
});

test('missing throw/deploy data fails closed instead of supplying defaults', () => {
  assert.throws(() => selectUtilityWeapons({}), /Missing native/);
});
