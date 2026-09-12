import { useEffect, useMemo, useState } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { RecentProgress } from './components/RecentProgress';
import { SupportBanner } from './components/SupportBanner';
import { ReplayPanel } from './components/ReplayPanel';
import { ResultsPanel } from './components/ResultsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { TrainerCanvas } from './components/TrainerCanvas';
import { getWeapon } from './data/weapons';
import { findWeakSegmentForWeapon } from './lib/scoring';
import { loadAttempts, loadSettings, resetLocalProgress, saveAttempts, saveSettings } from './lib/storage';
import { AttemptResult, SprayLength, TargetDistance, TrainingMode, UserSettings, WeaponId } from './types';

export default function App() {
  const [weaponId, setWeaponId] = useState<WeaponId>('ak47');
  const [mode, setMode] = useState<TrainingMode>('ghosthair');
  const [sprayLength, setSprayLength] = useState<SprayLength>('full');
  const [distance, setDistance] = useState<TargetDistance>('mid');
  const [attempts, setAttempts] = useState<AttemptResult[]>(() => loadAttempts());
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());
  const [selectedAttempt, setSelectedAttempt] = useState<AttemptResult | undefined>(attempts[0]);

  const weapon = useMemo(() => getWeapon(weaponId), [weaponId]);
  const weakSegment = useMemo(() => findWeakSegmentForWeapon(attempts, weaponId), [attempts, weaponId]);

  useEffect(() => saveAttempts(attempts), [attempts]);
  useEffect(() => saveSettings(settings), [settings]);

  const recordAttempt = (attempt: AttemptResult) => {
    setAttempts((existing) => [attempt, ...existing].slice(0, 500));
    setSelectedAttempt(attempt);
  };

  const selectWeakDrill = () => {
    setMode('weak-section');
    setSprayLength(10);
    window.scrollTo({ top: document.getElementById('trainer')?.offsetTop ?? 0, behavior: 'smooth' });
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-[2200px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-slate-950/80 px-4 py-3 shadow-2xl shadow-black/30">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-400 font-black text-slate-950 shadow-glow">SL</div>
            <div>
              <p className="font-semibold">SprayLab CS2</p>
              <p className="text-xs text-slate-400">3D recoil trainer · shoot first, stats below</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={() => document.getElementById('settings')?.scrollIntoView({ behavior: 'smooth' })}>Settings</button>
            <button
              className="secondary-button"
              onClick={() => {
                resetLocalProgress();
                setAttempts([]);
                setSelectedAttempt(undefined);
              }}
            >
              Reset progress
            </button>
          </div>
        </header>

        <SupportBanner />

        <section id="trainer" className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <ControlPanel
            weaponId={weaponId}
            mode={mode}
            sprayLength={sprayLength}
            distance={distance}
            onWeaponChange={setWeaponId}
            onModeChange={setMode}
            onLengthChange={setSprayLength}
            onDistanceChange={setDistance}
          />
          <TrainerCanvas
            weapon={weapon}
            mode={mode}
            sprayLength={sprayLength}
            distance={distance}
            settings={settings}
            previousAttempts={attempts}
            weakSegment={weakSegment}
            onComplete={recordAttempt}
          />
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_0.75fr]">
          <ResultsPanel attempt={selectedAttempt} onSelectWeakDrill={selectWeakDrill} />
          <ReplayPanel attempt={selectedAttempt} />
        </section>

        <section className="mt-5">
          <RecentProgress attempts={attempts} onSelectAttempt={setSelectedAttempt} />
        </section>

        <section id="settings" className="mt-5">
          <SettingsPanel settings={settings} onChange={setSettings} />
        </section>
      </div>
    </main>
  );
}
