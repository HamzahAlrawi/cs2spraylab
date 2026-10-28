import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {utilityKinds} from './utility-loadout';
import {nativeUtilityRules, nativeUtilityWeaponField, nativeUtilityCfgOverride} from './native-utility-rules';

describe('fresh static utility evidence', () => {
  it('pins build, extractor and compiled/decompiled source hashes separately', () => {
    expect(nativeUtilityRules.build).toBe('2000935');
    expect(nativeUtilityRules.extractor.version).toMatch(/^20\.1\./);
    for (const source of Object.values(nativeUtilityRules.sources)) expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    const source = nativeUtilityRules.sources.weapons;
    expect(source.path).toBe('scripts/weapons.vdata_c');
    expect(source.decodedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.sha256).not.toBe(source.decodedSha256);
  });

  it.each(utilityKinds)('%s retains exact native weapon field keys and units', kind => {
    expect(nativeUtilityWeaponField(kind, 'm_flThrowVelocity')).toBe(750);
    expect(nativeUtilityWeaponField(kind, 'm_flDeployDuration')).toBe(1);
    expect(nativeUtilityWeaponField(kind, 'm_flMaxSpeed')).toEqual([245, 245]);
    expect(nativeUtilityWeaponField(kind, 'fuse')).toBeUndefined();
    expect(nativeUtilityWeaponField(kind, 'toString')).toBeUndefined();
  });

  it('records HE data without reinterpreting generic fields as a damage formula', () => {
    expect(nativeUtilityWeaponField('he', 'm_nDamage')).toBe(99);
    expect(nativeUtilityWeaponField('he', 'm_flRange')).toBe(350);
    expect(nativeUtilityWeaponField('he', 'm_flArmorRatio')).toBe(1.2);
    expect(nativeUtilityRules.unresolved.effects).toContain('not assumed');
  });

  it('uses 4 total/2 flash competitive overrides, not 3/1 engine defaults', () => {
    expect(nativeUtilityCfgOverride('ammo_grenade_limit_total')).toMatchObject({value: 4, scope: 'config-override', line: 89});
    expect(nativeUtilityCfgOverride('ammo_grenade_limit_flashbang')).toMatchObject({value: 2, line: 88});
    expect(nativeUtilityCfgOverride('ammo_grenade_limit_total', 'gamemode_casual.cfg')?.value).toBe(3);
    expect(nativeUtilityCfgOverride('ammo_grenade_limit_flashbang', 'gamemode_casual.cfg')?.value).toBe(1);
    expect(nativeUtilityCfgOverride('mp_molotovusedelay')).toBeUndefined();
    expect(nativeUtilityCfgOverride('ammo_grenade_limit_default')).toBeUndefined();
    expect(nativeUtilityCfgOverride('sv_gravity')).toBeUndefined();
    expect(nativeUtilityCfgOverride('ammo_grenade_limit_total', 'missing.cfg')).toBeUndefined();
  });

  it('does not promote ASCII identifiers or an older dump to registered defaults', () => {
    for (const entry of Object.values(nativeUtilityRules.convars)) {
      expect(entry.engineDefault).toBeNull();
      expect(entry.engineDefaultStatus).toBe('not-extracted');
    }
    for (const name of ['sv_gravity', 'inferno_damage', 'sv_hegrenade_damage_multiplier',
      'sv_hegrenade_radius_multiplier', 'molotov_throw_detonate_time', 'weapon_molotov_maxdetonateslope'])
      expect(nativeUtilityRules.convars[name].nameEvidence.length).toBeGreaterThan(0);
  });

  it('preserves declared competitive execution order and the conditional offline CFG', () => {
    const mode = nativeUtilityRules.modeExec.filter(e => e.scope === 'GameModes.txt/gameTypes/classic/gameModes/competitive/exec');
    expect(mode.map(e => [e.key, e.file])).toEqual([
      ['exec', 'gamemode_competitive.cfg'], ['exec_offline', 'gamemode_competitive_offline.cfg'],
      ['exec', 'gamemode_competitive_server.cfg'],
    ]);
  });

  it('matches persisted extraction artifacts when present locally', () => {
    for (const source of Object.values(nativeUtilityRules.sources)) {
      for (const [file, sha] of [[source.extractedPath, source.sha256], [source.decodedPath, source.decodedSha256]]) {
        if (!file || !existsSync(file)) continue;
        expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(sha);
      }
    }
  });
});
