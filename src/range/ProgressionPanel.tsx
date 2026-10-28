import {useEffect, useId, useRef, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {Award, Check, Coins, Paintbrush, ShoppingCart, Target, Trophy, X} from 'lucide-react';
import {ACHIEVEMENTS} from './achievements';
import {AchievementPanel} from './AchievementPanel';
import {ArmoryInventory} from './ArmoryInventory';
import {ProgressionAccount} from './ProgressionAccount';
import {levelProgress, MAX_LEVEL, ownsCosmetic, PROGRESSION_MILESTONES, type ProgressionController} from './progression';
import './progression.css';

export function useProgression(controller: ProgressionController) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

export type ProgressionPanelProps = {
  controller: ProgressionController;
  equipmentLabels?: Readonly<Record<string, string>>;
  activeEquipment?: string;
  /** Main pauses the range and releases pointer lock before the armory opens. */
  onOpenChange?: (open: boolean) => void;
  /** Parent closes its loadout before requesting this equipment's unlock shop. */
  requestedEquipment?: string | null;
  requestedAchievements?: boolean;
  onRequestHandled?: () => void;
};

const number = (value: number) => value.toLocaleString('en-US');

export function ProgressionPanel({controller, equipmentLabels = {}, activeEquipment, onOpenChange, requestedEquipment, requestedAchievements, onRequestHandled}: ProgressionPanelProps) {
  const snapshot = useProgression(controller), profile = snapshot.profile;
  const progress = levelProgress(profile.xp);
  const [open, setOpen] = useState(false), [equipment, setEquipment] = useState(activeEquipment);
  const [view, setView] = useState<'collection' | 'unlocks' | 'milestones' | 'achievements'>('collection');
  const [actionNotice, setActionNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId(), noticeId = useId(), dialogId = useId();
  const openCallback = useRef(onOpenChange), requestCallback = useRef(onRequestHandled);
  const handledRequest = useRef<string | null>(null);
  openCallback.current = onOpenChange;
  requestCallback.current = onRequestHandled;
  const collection = controller.catalog.filter(item => !item.isDefault), ownedCount = collection.filter(item => ownsCosmetic(profile, item)).length;
  const completed = profile.completedDuels + profile.completedDrills;

  useEffect(() => {
    if (!requestedEquipment) {handledRequest.current = null; return;}
    if (handledRequest.current === requestedEquipment) return;
    handledRequest.current = requestedEquipment;
    setEquipment(requestedEquipment); setView('unlocks'); setActionNotice(''); setOpen(true);
    requestCallback.current?.();
  }, [requestedEquipment]);

  useEffect(() => {
    if (!requestedAchievements) return;
    setView('achievements'); setActionNotice(''); setOpen(true);
    requestCallback.current?.();
  }, [requestedAchievements]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger.current;
    openCallback.current?.(true);
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      openCallback.current?.(false);
      (previousFocus?.isConnected ? previousFocus : trigger.current)?.focus();
    };
  }, [open]);

  return <>
    <button type="button" ref={trigger} className="progression-summary" aria-label={`Level ${progress.level}, ${progress.level === MAX_LEVEL ? 'maximum level' : `${progress.remaining} XP to next level`}. Open armory. Wallet: ${number(profile.balance)} credits`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} title={`Armory | ${number(profile.balance)} credits`} onClick={() => {
        setView('collection'); setEquipment(activeEquipment); setActionNotice(''); setOpen(true);
      }}>
      <Award size={18} aria-hidden="true"/>
      <span className="progression-summary-text"><span><b>LVL {progress.level}</b><small>{progress.level === MAX_LEVEL ? 'MAX' : `${progress.current} / ${progress.needed} XP`}</small></span>
        <span className="progression-track" aria-hidden="true"><span style={{width: `${progress.fraction * 100}%`}}/></span>
      </span>
      <span className="progression-summary-wallet"><Coins size={13} aria-hidden="true"/>{number(profile.balance)}</span>
    </button>
    {open && typeof document !== 'undefined' && createPortal(<dialog ref={dialog} id={dialogId} className="progression-armory" aria-labelledby={titleId} aria-describedby={noticeId}
      onCancel={event => {event.preventDefault(); setOpen(false);}} onClose={() => setOpen(false)} onClick={event => {if (event.target === event.currentTarget) setOpen(false);}}>
      <div className="progression-armory-content">
        <header className="progression-armory-header"><div><h2 id={titleId}>Armory</h2><p id={noticeId}>Local cosmetics only. Not CS2 inventory items.</p></div>
          <button type="button" autoFocus className="progression-icon-button" aria-label="Close armory" title="Close armory" onClick={() => setOpen(false)}><X size={20}/></button></header>
        <section className="progression-account" aria-label="Progression account"><div className="progression-level" aria-label="Level progress"><Award size={24} aria-hidden="true"/><div>
          <div className="progression-level-label"><strong>Level {progress.level}</strong><span>{progress.level === MAX_LEVEL ? `${number(progress.total)} total XP` : `${number(progress.current)} / ${number(progress.needed)} XP`}</span></div>
          <progress value={progress.fraction} max="1" aria-label={progress.level === MAX_LEVEL ? 'Maximum level reached' : `Progress to level ${progress.level + 1}`}/>
          <small>{progress.level === MAX_LEVEL ? 'Maximum level reached' : `${number(progress.remaining)} XP to level ${progress.level + 1}`}</small>
        </div></div><div className="progression-wallet" aria-label={`Wallet: ${number(profile.balance)} credits`}><Coins size={22} aria-hidden="true"/><div><small>Wallet / credits</small><strong>{number(profile.balance)}</strong></div></div></section>
        <ProgressionAccount controller={controller}/>
        <details className="progression-account-history"><summary>Account totals<span>{ownedCount} / {collection.length} finishes owned</span></summary>
          <dl className="progression-stats"><div><dt>Finishes owned</dt><dd>{ownedCount} / {collection.length}</dd></div><div><dt>Credits earned</dt><dd>{number(profile.creditsEarned)}</dd></div>
            <div><dt>Credits spent</dt><dd>{number(profile.creditsSpent)}</dd></div><div><dt>Completed attempts</dt><dd>{number(completed)}</dd></div></dl></details>
        {snapshot.storageStatus !== 'saved' && <p className="progression-storage-warning" role="status">{snapshot.storageStatus === 'unsupported-version'
          ? 'A newer save was found and kept unchanged. This session will not be saved.' : snapshot.storageStatus === 'corrupt-save'
            ? 'The local save is damaged and was kept unchanged. Export this session or restore a valid backup in Save & gifts.'
            : 'Browser storage is unavailable. Progress is kept for this session only.'}</p>}
        <div className="progression-views" role="group" aria-label="Armory view"><button type="button" aria-pressed={view === 'collection'} onClick={() => setView('collection')}><Paintbrush size={16} aria-hidden="true"/>Collection</button>
          <button type="button" aria-pressed={view === 'unlocks'} onClick={() => setView('unlocks')}><ShoppingCart size={16} aria-hidden="true"/>Unlocks</button>
          <button type="button" aria-label="Milestones" title="Milestones" aria-pressed={view === 'milestones'} onClick={() => setView('milestones')}><Target size={16} aria-hidden="true"/><span className="progression-view-label">Milestones</span></button>
          <button type="button" aria-label={`Achievements ${Object.keys(profile.achievements.unlocked).length}/${ACHIEVEMENTS.length}`} title="Achievements" aria-pressed={view === 'achievements'} onClick={() => setView('achievements')}><Trophy size={16} aria-hidden="true"/><span className="progression-view-label">Achievements</span><span className="achievement-count">{Object.keys(profile.achievements.unlocked).length}/{ACHIEVEMENTS.length}</span></button></div>
        <p className="progression-action-notice" role="status" aria-live="polite" aria-atomic="true">{actionNotice}</p>
        {view === 'collection' || view === 'unlocks' ? <ArmoryInventory key={equipment ?? 'default'} controller={controller} profile={profile} initialEquipment={equipment}
          equipmentLabels={equipmentLabels} view={view} onViewChange={setView} onNotice={setActionNotice}/>
          : view === 'achievements' ? <AchievementPanel profile={profile} catalog={controller.catalog}/>
            : <section className="progression-milestones" aria-label="Progression milestones"><div className="progression-section-heading"><h3>Milestones</h3><span>{profile.milestones.length} completed</span></div><ul>{PROGRESSION_MILESTONES.map(item => {
              const claimed = profile.milestones.includes(item.id), current = item.kind === 'level' ? progress.level : completed;
              return <li key={item.id}><div><strong>{item.label}</strong><small>{claimed ? 'Completed' : `${number(Math.min(current, item.target))} / ${number(item.target)}`}</small>
                <progress value={Math.min(current, item.target)} max={item.target} aria-label={item.label}/></div><span>{claimed ? <Check size={15} aria-label="Completed"/> : <Coins size={15} aria-hidden="true"/>}{number(item.credits)} credits</span></li>;
            })}</ul></section>}
      </div>
    </dialog>, document.body)}
  </>;
}

export function XpNotification({controller, durationMs = 5000, onOpenAchievements}: {controller: ProgressionController; durationMs?: number; onOpenAchievements?: () => void}) {
  const {notification} = useProgression(controller);
  useEffect(() => {
    if (!notification) return;
    const duration = Math.max(notification.achievementIds.length ? 8000 : 2000, Number.isFinite(durationMs) ? durationMs : 5000);
    const timer = window.setTimeout(() => controller.dismissNotification(), duration);
    return () => window.clearTimeout(timer);
  }, [controller, notification, durationMs]);
  const labels = notification?.unlockedIds.map(id => controller.catalog.find(item => item.id === id)?.label).filter(Boolean) ?? [];
  const achievements = notification?.achievementIds.map(id => ACHIEVEMENTS.find(item => item.id === id)?.title).filter(Boolean) ?? [];
  return <div className="progression-notification-region" role="status" aria-live="polite" aria-atomic="true">
    {notification && <div className="progression-notification" key={notification.id}>{achievements.length ? <Trophy size={20} aria-hidden="true"/> : <Award size={20} aria-hidden="true"/>}<div>
      <strong>{notification.source === 'recovery' ? `Progress restored | Level ${notification.levelAfter}` : notification.source === 'collection' ? 'Achievement earned' : `${notification.source === 'gift' ? 'Gift redeemed | ' : ''}+${notification.xp} XP | +${number(notification.credits)} credits${notification.levelAfter > notification.levelBefore ? ` | Level ${notification.levelAfter}` : ''}`}</strong>
      {achievements.length > 0 && <small className="achievement-toast-label">{notification.source === 'collection' ? '' : 'Achievement earned: '}{achievements.slice(0, 2).join(', ')}{achievements.length > 2 ? ` +${achievements.length - 2} more` : ''}</small>}
      {labels.length > 0 ? <small>Purchase eligible: {labels.slice(0, 2).join(', ')}{labels.length > 2 ? ` +${labels.length - 2} more` : ''}</small> : notification.source !== 'collection' && <small>{notification.source === 'gift' ? 'Gift added to your progress' : notification.source === 'recovery' ? 'Backup recovery complete' : notification.source === 'duel' ? 'AI Duel complete' : 'Drill complete'}</small>}
      {notification.milestoneCredits > 0 && <small>Milestones: +{number(notification.milestoneCredits)} credits included</small>}
      {achievements.length > 0 && onOpenAchievements && <button type="button" className="achievement-toast-action" onClick={() => {onOpenAchievements(); controller.dismissNotification();}}><Trophy size={13} aria-hidden="true"/>View achievements</button>}
    </div><button type="button" className="progression-icon-button" aria-label="Dismiss XP notification" title="Dismiss XP notification" onClick={() => controller.dismissNotification()}><X size={16}/></button></div>}
  </div>;
}
