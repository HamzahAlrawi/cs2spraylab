import {Bomb, ChevronRight, Cloud, Flame, Radio, Sparkles, ArrowUpRight, CornerDownRight} from 'lucide-react';
import {utilityKinds, utilityNames, utilityInventory, type UtilityKind} from './utility-loadout';
import type {DuelConfig} from './config';

export {utilityKinds};
export const utilityLabels = utilityNames;
const utilityIcons = {he: Bomb, flash: Sparkles, smoke: Cloud, molotov: Flame, incendiary: Flame, decoy: Radio};
export const emptyUtilityInventory = Object.freeze(utilityInventory([]));

export function nextUtility(inventory: Readonly<Record<UtilityKind, number>>, selected?: UtilityKind | null): UtilityKind | null {
  const start = selected ? utilityKinds.indexOf(selected) : -1;
  for (let offset = 1; offset <= utilityKinds.length; offset++) {
    const kind = utilityKinds[(start + offset) % utilityKinds.length];
    if (inventory[kind] > 0) return kind;
  }
  return null;
}

export function utilityLoadoutCount(loadout: readonly UtilityKind[], kind: UtilityKind) {
  return loadout.reduce((count, item) => count + Number(item === kind), 0);
}

export function changeUtilityLoadout(loadout: readonly UtilityKind[], kind: UtilityKind, count: number): UtilityKind[] {
  const remaining = loadout.filter(item => item !== kind &&
    !(count > 0 && (kind === 'molotov' && item === 'incendiary' || kind === 'incendiary' && item === 'molotov')));
  const limit = kind === 'flash' ? 2 : 1;
  const desired = Number.isFinite(count) ? Math.max(0, Math.min(limit, Math.floor(count), 4 - remaining.length)) : 0;
  return [...remaining, ...Array.from({length: desired}, () => kind)];
}

export function UtilityLoadout({config, update}: {config: DuelConfig; update: (patch: Partial<DuelConfig>) => void}) {
  const loadout = config.utilityLoadout;
  return <details className="duel-setup-section duel-utility-setup">
    <summary><ChevronRight size={16} aria-hidden="true"/><span>Utility</span><output>{loadout.length} / 4</output></summary>
    <div className="duel-setup-fields">
      <label className="duel-check"><span>Enable utilities</span><input aria-label="Enable utilities" type="checkbox" checked={config.utilitiesEnabled}
        onChange={event => update({utilitiesEnabled: event.target.checked})}/></label>
      <label className="duel-check"><span>Bot utilities</span><input aria-label="Bot utilities" type="checkbox" checked={config.botUtilities} disabled={!config.utilitiesEnabled}
        onChange={event => update({botUtilities: event.target.checked})}/></label>
      <fieldset className="duel-setup-fieldset duel-setup-wide" disabled={!config.utilitiesEnabled}><legend>Grenade loadout</legend>
        <div className="duel-utility-loadout">{utilityKinds.map(kind => {
          const count = utilityLoadoutCount(loadout, kind), Icon = utilityIcons[kind];
          const replacesFire = kind === 'molotov' && loadout.includes('incendiary') || kind === 'incendiary' && loadout.includes('molotov');
          const full = loadout.length >= 4 && !count && !replacesFire;
          return <label className="duel-check" key={kind}><span><Icon size={14} aria-hidden="true"/>{utilityLabels[kind]}</span>
            {kind === 'flash' ? <select aria-label="Flashbang count" value={count} onChange={event => update({utilityLoadout: changeUtilityLoadout(loadout, kind, +event.target.value)})}>
              {[0, 1, 2].map(value => <option key={value} value={value} disabled={value > count + 4 - loadout.length}>{value}</option>)}</select> :
              <input aria-label={`Carry ${utilityLabels[kind]}`} type="checkbox" checked={count > 0} disabled={full}
                onChange={event => update({utilityLoadout: changeUtilityLoadout(loadout, kind, +event.target.checked)})}/>}
          </label>;
        })}</div>
      </fieldset>
    </div>
  </details>;
}

export function UtilityHud({inventory, selected, disabled, canThrow = !disabled, onSelect, onThrow}: {
  inventory: Readonly<Record<UtilityKind, number>>; selected?: UtilityKind; disabled: boolean;
  canThrow?: boolean;
  onSelect: (kind: UtilityKind) => void; onThrow: (lob: boolean) => void;
}) {
  return <div className="duel-utility-hud">
    <div className="duel-utility-slots" role="group" aria-label="Grenades">{utilityKinds.map(kind => {
      const Icon = utilityIcons[kind], count = inventory[kind];
      return <button type="button" key={kind} className={`duel-utility-slot utility-${kind}`} title={`${utilityLabels[kind]} (${count})`}
        aria-label={`Equip ${utilityLabels[kind]}, ${count} remaining`} aria-pressed={selected === kind} disabled={disabled || count <= 0}
        onClick={() => onSelect(kind)}><Icon size={17} aria-hidden="true"/><span>{count}</span></button>;
    })}</div>
    {selected && <div className="duel-utility-actions" role="group" aria-label={`${utilityLabels[selected]} throw`}>
      <span>{utilityLabels[selected]}</span>
      <button type="button" title="Throw (primary click)" aria-label="Throw grenade" disabled={disabled || !canThrow} onClick={() => onThrow(false)}><ArrowUpRight size={17}/>Throw</button>
      <button type="button" title="Lob (secondary click)" aria-label="Lob grenade" disabled={disabled || !canThrow} onClick={() => onThrow(true)}><CornerDownRight size={17}/>Lob</button>
    </div>}
  </div>;
}
