import {useEffect, useState, type CSSProperties} from 'react';
import {ArrowRight, Award, Coins, Sparkles} from 'lucide-react';
import {CosmeticPreview} from './ArmoryInventory';
import type {CosmeticDefinition, XpNotice} from './progression';
import './reward-reveal.css';

export const REWARD_SKIP_DELAY_MS = 500;
export const REWARD_REVEAL_MS = 4400;
export const canSkipReward = (started: number, now: number) => Number.isFinite(started) && Number.isFinite(now) && now - started >= REWARD_SKIP_DELAY_MS;

export function LevelUpReveal({notice, catalog, onDismiss}: {
  notice: XpNotice; catalog: readonly CosmeticDefinition[]; onDismiss: () => void;
}) {
  const [skippable, setSkippable] = useState(false);
  useEffect(() => {
    const started = performance.now(); setSkippable(false);
    const ready = window.setTimeout(() => setSkippable(true), REWARD_SKIP_DELAY_MS);
    const end = window.setTimeout(onDismiss, REWARD_REVEAL_MS);
    const click = (event: PointerEvent) => {
      if (event.button !== 0 || !canSkipReward(started, performance.now())) return;
      if (event.target instanceof Element && event.target.closest('button,a,input,select,textarea')) return;
      // Do not consume gameplay input or release pointer lock for a cosmetic reveal.
      onDismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && canSkipReward(started, performance.now())) onDismiss();
    };
    window.addEventListener('pointerdown', click, true); window.addEventListener('keydown', key);
    return () => {clearTimeout(ready); clearTimeout(end); window.removeEventListener('pointerdown', click, true); window.removeEventListener('keydown', key);};
  }, [notice.id, onDismiss]);
  const available = notice.unlockedIds.map(id => catalog.find(item => item.id === id)).filter((item): item is CosmeticDefinition => !!item).slice(0, 3);
  const ranks = Array.from({length: 5}, (_, i) => Math.max(1, notice.levelAfter - 4 + i));
  return <section className="level-reveal" aria-label={`Level up to ${notice.levelAfter}`} role="status" aria-live="polite" data-skippable={skippable}>
    <div className="reward-confetti" aria-hidden="true">{Array.from({length: 24}, (_, i) => <i key={i} style={{
      '--drift': `${(i % 2 ? 1 : -1) * (45 + (i * 31) % 240)}px`, '--lift': `${100 + (i * 23) % 120}px`,
      '--turn': `${(i * 53) % 360}deg`, '--delay': `${(i % 6) * 25}ms`, '--color': ['#f1cd75','#75ddd0','#f19cab'][i % 3],
    } as CSSProperties}/> )}</div>
    <header><span><Sparkles size={15} aria-hidden="true"/>RANK ADVANCED</span><span>LVL {notice.levelBefore} <ArrowRight size={12}/> {notice.levelAfter}</span></header>
    <div className="reward-rank"><Award size={40} aria-hidden="true"/><div><span>Level up</span><strong>{notice.levelAfter}</strong></div>
      <div className="reward-rank-reel" aria-hidden="true"><div>{ranks.map((rank,i) => <span key={i}>{rank}</span>)}</div></div></div>
    <div className="reward-payout"><strong>+{notice.xp.toLocaleString('en-US')} XP</strong><span><Coins size={17} aria-hidden="true"/>+{notice.credits.toLocaleString('en-US')} credits</span></div>
    {available.length > 0 && <div className="reward-new-finishes"><small>Newly available to purchase</small><div>{available.map(item => <div key={item.id}><CosmeticPreview item={item}/><span>{item.label}</span></div>)}</div></div>}
    <footer><span>{notice.milestoneCredits > 0 ? `Includes ${notice.milestoneCredits.toLocaleString('en-US')} milestone credits` : 'Rewards added to your wallet'}</span>
      <button type="button" disabled={!skippable} aria-label="Skip level-up reveal" title="Skip level-up reveal" onClick={onDismiss}><ArrowRight size={17}/><span>Continue</span></button></footer>
  </section>;
}
