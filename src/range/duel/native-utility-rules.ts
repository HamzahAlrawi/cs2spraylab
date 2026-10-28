import data from './native-utility-rules.json';
import type {UtilityKind} from './utility-loadout';

export type NativeUtilityValue = null | boolean | number | string | readonly NativeUtilityValue[] |
  {readonly [key: string]: NativeUtilityValue};
export type NativeUtilitySource = Readonly<{path: string; sha256: string; bytes: number;
  archive?: string; extractedPath?: string; decodedPath?: string; decodedSha256?: string}>;
export type NativeUtilityCfgAssignment = Readonly<{key: string; args: readonly string[]; line: number}>;
export type NativeUtilityConvar = Readonly<{engineDefault: null; engineDefaultStatus: 'not-extracted';
  nameEvidence: readonly Readonly<{source: string; fileOffset: string; kind: 'ascii-name-only'}>[];
  configOverrides: readonly (NativeUtilityCfgAssignment & Readonly<{file: string; source: string}>)[]}>;
export type NativeUtilityRules = Readonly<{
  schema: number; build: string;
  extractor: Readonly<{version: string; sha256: string; method: string}>;
  sources: Readonly<Record<string, NativeUtilitySource>>;
  weapons: Readonly<Record<UtilityKind, Readonly<{source: string; key: string;
    fields: Readonly<Record<string, NativeUtilityValue>>}>>>;
  vdataBases: Readonly<Record<string, NativeUtilityValue>>;
  explosionTypes: Readonly<{source: string; entries: Readonly<Record<string, NativeUtilityValue>>}>;
  configs: Readonly<Record<string, Readonly<{source: string; assignments: readonly NativeUtilityCfgAssignment[]}>>>;
  modeExec: readonly Readonly<{scope: string; key: string; file: string; line: number}>[];
  gameInfoOverrides: readonly Readonly<{source: string; scope: string; key: string; value: string; line: number}>[];
  convars: Readonly<Record<string, NativeUtilityConvar>>;
  unresolved: Readonly<Record<string, string>>;
}>;

export const nativeUtilityRules = data as NativeUtilityRules;

/** Raw, exact weapon-data fields; no invented gameplay mapping or unit conversion. */
export function nativeUtilityWeaponField(kind: UtilityKind, field: string): NativeUtilityValue | undefined {
  const fields = nativeUtilityRules.weapons[kind].fields;
  return Object.prototype.hasOwnProperty.call(fields, field) ? fields[field] : undefined;
}

/** Last assignment in one named CFG only, not a claim about the full server environment. */
export function nativeUtilityCfgOverride(key: string, file = 'gamemode_competitive.cfg') {
  const cfg = nativeUtilityRules.configs[file];
  if (!cfg) return undefined;
  const assignment = [...cfg.assignments].reverse().find(a => a.key === key && a.args.length === 1);
  if (!assignment) return undefined;
  const raw = assignment.args[0];
  const value = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  return {scope: 'config-override' as const, file, source: cfg.source, key, line: assignment.line, raw, value};
}
