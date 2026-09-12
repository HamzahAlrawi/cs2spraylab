import { TooltipInfo } from './TooltipInfo';
import { getWeapon, weapons } from '../data/weapons';
import { SprayLength, TargetDistance, TrainingMode, WeaponId } from '../types';

const modes: Array<{ id: TrainingMode; label: string; description: string; mvp?: boolean }> = [
  { id: 'learn', label: 'Learn', description: 'Shows the full compensation path, bullet numbers, current bullet, and next bullet. Best for learning a weapon from scratch.' },
  { id: 'ghosthair', label: 'Ghosthair', description: 'A moving marker advances at the weapon fire cadence. Follow it with your crosshair while the weapon recoil pushes your view.', mvp: true },
  { id: 'trace', label: 'Trace', description: 'Keeps the compensation path visible while you spray. Use it to build muscle memory before testing with no guide.', mvp: true },
  { id: 'fade-assist', label: 'Fade assist', description: 'The guide stays visible but fades as your local attempt history grows, nudging you toward memory-based control.' },
  { id: 'no-guide', label: 'No-guide', description: 'Hides the compensation path during the attempt. Your result is scored afterward against the timed ideal pattern.', mvp: true },
  { id: 'weak-section', label: 'Weak section', description: 'Focuses only on the bullets where your recent attempts had the largest error.' }
];

const lengths: SprayLength[] = [5, 10, 15, 'full'];

type Props = {
  weaponId: WeaponId;
  mode: TrainingMode;
  sprayLength: SprayLength;
  distance: TargetDistance;
  onWeaponChange: (weaponId: WeaponId) => void;
  onModeChange: (mode: TrainingMode) => void;
  onLengthChange: (length: SprayLength) => void;
  onDistanceChange: (distance: TargetDistance) => void;
};

export function ControlPanel(props: Props) {
  const weapon = getWeapon(props.weaponId);

  return (
    <aside className="rounded-3xl border border-white/10 bg-slate-950/80 p-4 shadow-2xl shadow-black/30">
      <div className="mb-4">
        <p className="text-[11px] uppercase tracking-[0.28em] text-amber-300">Trainer setup</p>
        <h2 className="mt-1 text-lg font-semibold text-white">{weapon.name}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-400">Compact setup panel. Hover the help icons for quick explanations.</p>
      </div>

      <label className="label">Weapon</label>
      <div className="grid grid-cols-2 gap-2">
        {weapons.map((item) => (
          <button
            key={item.id}
            className={item.id === props.weaponId ? 'chip chip-active min-h-[38px] text-sm' : 'chip min-h-[38px] text-sm'}
            onClick={() => props.onWeaponChange(item.id)}
            title={`${item.name} spray trainer`}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-2">
        <label className="label mb-0">Mode</label>
        <TooltipInfo text="Training modes change how much visual assistance you get while spraying." />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {modes.map((item) => (
          <button
            key={item.id}
            className={item.id === props.mode ? 'chip chip-active min-h-[42px] justify-between px-3 py-2 text-sm' : 'chip min-h-[42px] justify-between px-3 py-2 text-sm'}
            onClick={() => props.onModeChange(item.id)}
          >
            <span className="truncate">{item.label}</span>
            <TooltipInfo text={item.description} />
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-2">
        <label className="label mb-0">Spray length</label>
        <TooltipInfo text="Pick a short opening burst or the full magazine. Full-mag is the default." />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {lengths.map((length) => (
          <button
            key={String(length)}
            className={length === props.sprayLength ? 'chip chip-active min-h-[38px] px-2 py-2 text-sm' : 'chip min-h-[38px] px-2 py-2 text-sm'}
            onClick={() => props.onLengthChange(length)}
            title={length === 'full' ? 'Use the full weapon magazine.' : `Practice the first ${length} bullets only.`}
          >
            {length === 'full' ? 'Full' : length}
          </button>
        ))}
      </div>
    </aside>
  );
}
