import {useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {Award, Check, Coins, LockKeyhole, Package, Paintbrush, Search, ShoppingCart, Sword, Target, Trophy, UserRound, X} from 'lucide-react';
import {ACHIEVEMENTS} from './achievements';
import {AchievementPanel} from './AchievementPanel';
import {cosmeticCategory, cosmeticPrice, cosmeticsForEquipment, equippedCosmetic, levelProgress, MAX_LEVEL, ownsCosmetic, PROGRESSION_MILESTONES,
  type CosmeticCategory, type CosmeticDefinition, type ProgressionController} from './progression';
import {DEFAULT_GLOVE_PREVIEW} from './cosmetics';
import './progression.css';

export function useProgression(controller: ProgressionController) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

function CosmeticPreview({item}: {item: CosmeticDefinition}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.imageUrl]);
  return <span className="progression-preview" style={{'--cosmetic-swatch': item.swatch ?? '#859b96'} as CSSProperties}>
    {item.imageUrl && !failed ? <img src={item.imageUrl} alt="" loading="lazy" onError={() => setFailed(true)}/> :
      cosmeticCategory(item) === 'knife' ? <Sword size={36} aria-hidden="true"/> : cosmeticCategory(item) === 'gloves' ? <Package size={32} aria-hidden="true"/> :
        cosmeticCategory(item) === 'agent' ? <UserRound size={32} aria-hidden="true"/> : <Paintbrush size={32} aria-hidden="true"/>}
    {item.swatch && <span className="progression-swatch" aria-hidden="true"/>}
  </span>;
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

const categories: readonly {id: CosmeticCategory; label: string; icon: typeof Sword}[] = [
  {id: 'weapon', label: 'Weapons', icon: Paintbrush}, {id: 'knife', label: 'Knives', icon: Sword},
  {id: 'gloves', label: 'Gloves', icon: Package}, {id: 'agent', label: 'Agents', icon: UserRound},
];
const number = (value: number) => value.toLocaleString('en-US');

export function ProgressionPanel({controller, equipmentLabels = {}, activeEquipment, onOpenChange, requestedEquipment, requestedAchievements, onRequestHandled}: ProgressionPanelProps) {
  const snapshot = useProgression(controller);
  const progress = levelProgress(snapshot.profile.xp);
  const firstEquipment = (id: CosmeticCategory) => (id === 'weapon' && controller.catalog.some(item => item.equipment === activeEquipment && cosmeticCategory(item) === id)
    ? activeEquipment : controller.catalog.find(item => cosmeticCategory(item) === id)?.equipment) ?? '';
  const [open, setOpen] = useState(false), [equipment, setEquipment] = useState(() => firstEquipment('weapon'));
  const [category, setCategory] = useState<CosmeticCategory>('weapon'), [view, setView] = useState<'collection' | 'unlocks' | 'milestones' | 'achievements'>('collection');
  const [availability, setAvailability] = useState('all'), [query, setQuery] = useState(''), [sort, setSort] = useState('level');
  const [actionNotice, setActionNotice] = useState('');
  const [knifeType, setKnifeType] = useState('all-owned');
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId(), noticeId = useId(), filterId = useId(), dialogId = useId(), itemsId = useId(), searchId = useId();
  const openCallback = useRef(onOpenChange);
  openCallback.current = onOpenChange;
  const handledRequest = useRef<string | null>(null), requestCallback = useRef(onRequestHandled);
  requestCallback.current = onRequestHandled;
  const profile = snapshot.profile;
  const knifeTypes = [...new Map(controller.catalog.filter(item => item.equipment === 'knife').map(item =>
    [item.assetKey ?? 'knife', (item.assetKey ?? 'knife') === 'knife' ? 'Default CT knife' : item.label.split(' | ')[0]])).entries()];
  const equipmentLabel = (id: string) => equipmentLabels[id] ?? ({knife: 'Knife', gloves: 'Gloves', agent: 'Bot agent'}[id] ?? id);
  const equipmentIds = [...new Set(controller.catalog.filter(item => cosmeticCategory(item) === category).map(item => item.equipment))];
  const collection = controller.catalog.filter(item => !item.isDefault), ownedCount = collection.filter(item => ownsCosmetic(profile, item)).length;
  const completed = profile.completedDuels + profile.completedDrills;
  const items = (open ? cosmeticsForEquipment(profile, controller.catalog, equipment, view === 'unlocks' ? 'unowned' : 'owned') : []).filter(item => cosmeticCategory(item) === category &&
    (category !== 'knife' || view === 'collection' && knifeType === 'all-owned' || (item.assetKey ?? 'knife') === knifeType) &&
    `${item.label} ${equipmentLabel(item.equipment)} ${item.rarity ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (view !== 'unlocks' || availability === 'all' || item.unlockLevel <= progress.level && cosmeticPrice(item) <= profile.balance))
    .sort((a, b) => (sort === 'price' ? cosmeticPrice(a) - cosmeticPrice(b) : sort === 'name' ? 0 : a.unlockLevel - b.unlockLevel) || a.label.localeCompare(b.label));
  const selectCategory = (id: CosmeticCategory) => {if (id !== category) {setCategory(id); setEquipment(firstEquipment(id)); setQuery('');
    if (id === 'knife') setKnifeType(view === 'collection' ? 'all-owned' : knifeTypes.find(([key]) => key !== 'knife')?.[0] ?? 'knife');}};

  useEffect(() => {
    if (!requestedEquipment) {handledRequest.current = null; return;}
    if (handledRequest.current === requestedEquipment) return;
    handledRequest.current = requestedEquipment;
    const item = controller.catalog.find(candidate => candidate.equipment === requestedEquipment);
    setCategory(item ? cosmeticCategory(item) : 'weapon');
    setEquipment(item ? requestedEquipment : firstEquipment('weapon'));
    if (requestedEquipment === 'knife') setKnifeType(knifeTypes.find(([key]) => key !== 'knife')?.[0] ?? 'knife');
    setView('unlocks'); setAvailability('all'); setQuery(''); setActionNotice(''); setOpen(true);
    requestCallback.current?.();
  }, [controller, requestedEquipment]);

  useEffect(() => {
    if (!requestedAchievements) return;
    setView('achievements'); setActionNotice(''); setOpen(true);
    requestCallback.current?.();
  }, [requestedAchievements]);

  useEffect(() => {
    if (!open) return;
    openCallback.current?.(true);
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      openCallback.current?.(false);
      if (trigger.current?.isConnected) trigger.current.focus();
    };
  }, [open]);

  return <>
    <button type="button" ref={trigger} className="progression-summary" aria-label={`Level ${progress.level}, ${progress.remaining} XP to next level. Open armory. Wallet: ${number(profile.balance)} credits`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} title={`Armory | ${number(profile.balance)} credits`} onClick={() => {
        setView('collection'); setCategory('weapon'); setEquipment(firstEquipment('weapon')); setQuery(''); setActionNotice(''); setOpen(true);
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
        <section className="progression-account" aria-label="Progression account"><div className="progression-level" aria-label="Level progress"><Award size={26} aria-hidden="true"/><div>
          <div className="progression-level-label"><strong>Level {progress.level}</strong><span>{number(progress.total)} XP</span></div>
          <progress value={progress.fraction} max="1" aria-label={progress.level === MAX_LEVEL ? 'Maximum level reached' : `Progress to level ${progress.level + 1}`}/>
          <small>{progress.level === MAX_LEVEL ? 'All level gates open' : `${number(progress.remaining)} XP to level ${progress.level + 1}`}</small>
        </div></div><div className="progression-wallet" aria-label={`Wallet: ${number(profile.balance)} credits`}><Coins size={24} aria-hidden="true"/><div><small>Credits</small><strong>{number(profile.balance)}</strong></div></div></section>
        <dl className="progression-stats"><div><dt>Collection</dt><dd>{ownedCount} / {collection.length}</dd></div><div><dt>Earned</dt><dd>{number(profile.creditsEarned)}</dd></div>
          <div><dt>Spent</dt><dd>{number(profile.creditsSpent)}</dd></div><div><dt>Completed</dt><dd>{number(completed)}</dd></div></dl>
        {snapshot.storageStatus !== 'saved' && <p className="progression-storage-warning" role="status">{snapshot.storageStatus === 'unsupported-version'
          ? 'A newer save was found and kept unchanged. This session will not be saved.' : 'Browser storage is unavailable. Progress is kept for this session only.'}</p>}
        <div className="progression-views" role="group" aria-label="Armory view"><button type="button" aria-pressed={view === 'collection'} onClick={() => setView('collection')}><Paintbrush size={15} aria-hidden="true"/>Collection</button>
          <button type="button" aria-pressed={view === 'unlocks'} onClick={() => {setView('unlocks'); setAvailability('all'); if (category === 'knife' && knifeType === 'all-owned') setKnifeType(knifeTypes.find(([key]) => key !== 'knife')?.[0] ?? 'knife');}}><ShoppingCart size={15} aria-hidden="true"/>Unlocks</button>
          <button type="button" aria-pressed={view === 'milestones'} onClick={() => setView('milestones')}><Target size={15} aria-hidden="true"/>Milestones</button>
          <button type="button" aria-pressed={view === 'achievements'} onClick={() => setView('achievements')}><Trophy size={15} aria-hidden="true"/>Achievements <span className="achievement-count">{Object.keys(profile.achievements.unlocked).length}/{ACHIEVEMENTS.length}</span></button></div>
        <p className="progression-action-notice" role="status" aria-live="polite">{actionNotice}</p>
        {view === 'collection' || view === 'unlocks' ? <><div className="progression-tabs" role="tablist" aria-label="Cosmetic category">{categories.map(({id, label, icon: Icon}, index) =>
          <button key={id} id={`${itemsId}-${id}`} type="button" role="tab" aria-selected={category === id} aria-controls={itemsId} tabIndex={category === id ? 0 : -1}
            onClick={() => selectCategory(id)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % categories.length : event.key === 'ArrowLeft' ? (index + categories.length - 1) % categories.length :
                event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault(); selectCategory(categories[next].id);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}>{id === 'gloves' ? <img className="progression-gloves-icon" src={DEFAULT_GLOVE_PREVIEW} alt=""/> : <Icon size={16} aria-hidden="true"/>}{label}</button>)}</div>
        <div role="tabpanel" id={itemsId} aria-labelledby={`${itemsId}-${category}`}>
        <div className="progression-filter">{equipmentIds.length > 1 && <><label htmlFor={filterId}>Equipment</label><select id={filterId} value={equipment} onChange={event => {setEquipment(event.target.value); setQuery('');}}>
          {equipmentIds.map(id => <option key={id} value={id}>{equipmentLabel(id)}</option>)}
        </select></>}{category === 'knife' && <select aria-label="Knife type" value={knifeType} onChange={event => {setKnifeType(event.target.value); setQuery('');}}>
          {view === 'collection' && <option value="all-owned">All owned knives</option>}{knifeTypes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>}{view === 'unlocks' && <select aria-label="Availability" value={availability} onChange={event => setAvailability(event.target.value)}><option value="all">All unlocks</option><option value="affordable">Affordable now</option></select>}
          <select aria-label="Sort cosmetics" value={sort} onChange={event => setSort(event.target.value)}><option value="level">Level</option><option value="price">Price</option><option value="name">Name</option></select>
          <div className="progression-search"><Search size={15} aria-hidden="true"/><input id={searchId} aria-label="Search cosmetics" type="search" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)}/></div>
        </div>
        <div className="progression-catalog-title"><h3>{equipmentLabel(equipment)}</h3><span>{items.length} {view === 'collection' ? 'owned' : 'unlocks'}</span></div>
        <ul className={`progression-items${view === 'collection' ? ' is-collection' : ''}`} aria-label="Cosmetic choices">{items.map(item => {
          const owned = ownsCosmetic(profile, item), locked = !owned && item.unlockLevel > progress.level, price = cosmeticPrice(item);
          const insufficient = !owned && price > profile.balance;
          const selected = equippedCosmetic(snapshot.profile, controller.catalog, item.equipment)?.id === item.id;
          return <li key={item.id}><article className={`progression-choice${selected ? ' is-equipped' : ''}${locked ? ' is-locked' : ''}`}>
            <CosmeticPreview item={item}/><span className="progression-choice-name">{item.label}<small>{equipmentLabel(item.equipment)}</small></span>
            <div className="progression-item-meta"><span>{item.rarity ?? (item.isDefault ? 'Standard' : 'Finish')}</span>{view === 'unlocks' && <span>LVL {item.unlockLevel}</span>}</div>
            <span className={`progression-choice-state${locked ? ' locked' : ''}`}>{locked ? <><LockKeyhole size={13} aria-hidden="true"/>Level {item.unlockLevel}</> : selected ? <><Check size={14} aria-hidden="true"/>Equipped</> : owned ? 'Owned' : 'Available'}</span>
            {view === 'unlocks' && <span className="progression-price"><Coins size={13} aria-hidden="true"/>{number(price)} credits</span>}
            <button type="button" className="progression-item-action" disabled={locked || insufficient || selected} aria-disabled={locked || insufficient || selected} aria-pressed={owned ? selected : undefined}
              aria-label={`${item.label}, ${equipmentLabel(item.equipment)}, ${locked ? `locked until level ${item.unlockLevel}` : selected ? 'equipped' : owned ? 'equip' : `buy for ${number(price)} credits${insufficient ? ', insufficient credits' : ''}`}`}
              title={locked ? `Requires level ${item.unlockLevel}` : insufficient ? `${number(price - profile.balance)} more credits needed` : selected ? 'Equipped' : owned ? `Equip ${item.label}` : `Buy ${item.label}`}
              onClick={() => {
                if (owned) {if (controller.equip(item.equipment, item.id)) setActionNotice(`${item.label} equipped.`); return;}
                const result = controller.purchase(item.id);
                if (result.success) {setView('collection'); setQuery('');}
                setActionNotice(result.success ? result.reason === 'purchased' ? `${item.label} purchased for ${number(result.spent)} credits.` : `${item.label} is already owned.` :
                  result.reason === 'insufficient-credits' ? 'Not enough credits.' : result.reason === 'level-locked' ? `Requires level ${item.unlockLevel}.` : 'Purchase unavailable.');
              }}>{locked ? <LockKeyhole size={14} aria-hidden="true"/> : owned ? <Check size={14} aria-hidden="true"/> : <ShoppingCart size={14} aria-hidden="true"/>}
              {locked ? 'Locked' : selected ? 'Equipped' : owned ? 'Equip' : insufficient ? 'Need credits' : 'Buy'}</button>
          </article></li>;
        })}</ul>
        {!items.length && <p className="progression-empty">No items match these filters.</p>}</div></> : view === 'achievements' ? <AchievementPanel profile={profile} catalog={controller.catalog}/> : <section className="progression-milestones" aria-label="Progression milestones"><ul>{PROGRESSION_MILESTONES.map(item => {
          const claimed = profile.milestones.includes(item.id), current = item.kind === 'level' ? progress.level : completed;
          return <li key={item.id}><div><strong>{item.label}</strong><small>{claimed ? 'Completed' : `${number(Math.min(current, item.target))} / ${number(item.target)}`}</small>
            <progress value={Math.min(current, item.target)} max={item.target} aria-label={item.label}/></div><span>{claimed ? <Check size={15} aria-label="Completed"/> : <Coins size={15} aria-hidden="true"/>}{number(item.credits)}</span></li>;
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
      <strong>{notification.source === 'collection' ? 'Achievement earned' : `+${notification.xp} XP | +${number(notification.credits)} credits${notification.levelAfter > notification.levelBefore ? ` | Level ${notification.levelAfter}` : ''}`}</strong>
      {achievements.length > 0 && <small className="achievement-toast-label">{notification.source === 'collection' ? '' : 'Achievement earned: '}{achievements.slice(0, 2).join(', ')}{achievements.length > 2 ? ` +${achievements.length - 2} more` : ''}</small>}
      {labels.length > 0 ? <small>Purchase eligible: {labels.slice(0, 2).join(', ')}{labels.length > 2 ? ` +${labels.length - 2} more` : ''}</small> : notification.source !== 'collection' && <small>{notification.source === 'duel' ? 'AI Duel complete' : 'Drill complete'}</small>}
      {notification.milestoneCredits > 0 && <small>Milestones: +{number(notification.milestoneCredits)} credits included</small>}
      {achievements.length > 0 && onOpenAchievements && <button type="button" className="achievement-toast-action" onClick={() => {onOpenAchievements(); controller.dismissNotification();}}><Trophy size={13} aria-hidden="true"/>View achievements</button>}
    </div><button type="button" className="progression-icon-button" aria-label="Dismiss XP notification" title="Dismiss XP notification" onClick={() => controller.dismissNotification()}><X size={16}/></button></div>}
  </div>;
}
