import { UserSettings } from '../types';

type Props = {
  settings: UserSettings;
  onChange: (settings: UserSettings) => void;
};

export function SettingsPanel({ settings, onChange }: Props) {
  const update = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <section id="settings" className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 shadow-2xl shadow-black/30">
      <p className="text-sm uppercase tracking-[0.28em] text-amber-300">Settings</p>
      <h2 className="mt-1 text-2xl font-semibold text-white">Sensitivity and calibration</h2>
      <p className="mt-2 text-sm text-slate-400">
        Browsers do not expose the same raw input model as CS2, so this panel approximates your pull-down distance rather than perfectly matching the game.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <label className="field">
          <span>CS2 sensitivity</span>
          <input type="number" step="0.01" value={settings.cs2Sensitivity} onChange={(event) => update('cs2Sensitivity', Number(event.target.value))} />
        </label>
        <label className="field">
          <span>Mouse DPI</span>
          <input type="number" step="50" value={settings.dpi} onChange={(event) => update('dpi', Number(event.target.value))} />
        </label>
        <label className="field">
          <span>cm / 360</span>
          <input type="number" step="0.1" value={settings.cm360} onChange={(event) => update('cm360', Number(event.target.value))} />
        </label>
        <label className="field">
          <span>Resolution</span>
          <input value={settings.resolution} onChange={(event) => update('resolution', event.target.value)} />
        </label>
        <label className="field">
          <span>Aspect ratio</span>
          <select value={settings.aspectRatio} onChange={(event) => update('aspectRatio', event.target.value)}>
            <option>16:9</option>
            <option>16:10</option>
            <option>4:3</option>
            <option>5:4</option>
          </select>
        </label>
        <label className="field">
          <span>Crosshair</span>
          <select value={settings.crosshair} onChange={(event) => update('crosshair', event.target.value as UserSettings['crosshair'])}>
            <option value="classic">Classic</option>
            <option value="small">Small</option>
            <option value="dot">Dot</option>
          </select>
        </label>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium text-white">Calibration scale</p>
            <p className="text-sm text-slate-400">Increase if browser movement feels too small compared to CS2; decrease if it feels too large.</p>
          </div>
          <span className="rounded-full bg-amber-400/10 px-3 py-1 text-amber-200">{settings.calibrationScale.toFixed(2)}×</span>
        </div>
        <input
          className="mt-4 w-full accent-amber-400"
          type="range"
          min="0.5"
          max="1.8"
          step="0.01"
          value={settings.calibrationScale}
          onChange={(event) => update('calibrationScale', Number(event.target.value))}
        />
      </div>
    </section>
  );
}
