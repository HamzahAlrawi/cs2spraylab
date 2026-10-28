import {useEffect, useId, useRef, useState, type CSSProperties} from 'react';
import {ArrowLeft, ArrowRight, Check, Coins, Hand, ImageOff, LockKeyhole, Paintbrush, Search, ShoppingCart, Sword, UserRound} from 'lucide-react';
import {DEFAULT_GLOVE_PREVIEW} from './cosmetics';
import {cosmeticCategory, cosmeticPrice, cosmeticsForEquipment, equippedCosmetic, levelProgress, ownsCosmetic,
  type CosmeticCategory, type CosmeticDefinition, type ProgressionController, type ProgressionProfile} from './progression';

const PAGE_SIZE = 8;
const number = (value: number) => value.toLocaleString('en-US');
const categories: readonly {id: CosmeticCategory; label: string; icon: typeof Sword}[] = [
  {id: 'weapon', label: 'Weapons', icon: Paintbrush}, {id: 'knife', label: 'Knives', icon: Sword},
  {id: 'gloves', label: 'Gloves', icon: Hand}, {id: 'agent', label: 'Agents', icon: UserRound},
];

export function CosmeticPreview({item}: {item: CosmeticDefinition}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = item.imageUrl ?? (cosmeticCategory(item) === 'gloves' && item.isDefault ? DEFAULT_GLOVE_PREVIEW : undefined);
  return <span className="progression-preview" style={{'--cosmetic-swatch': item.swatch ?? '#b9c5c0'} as CSSProperties}>
    {url && failedUrl !== url ? <img src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)}/> :
      <span className="armory-missing-preview"><ImageOff size={30} aria-hidden="true"/><small>Preview unavailable</small></span>}
    {item.swatch && <span className="progression-swatch" aria-hidden="true"/>}
  </span>;
}

type DetailProps = {
  item: CosmeticDefinition; profile: ProgressionProfile; controller: ProgressionController; equipmentLabel: string;
  onPurchased: (id: string) => void; onNotice: (notice: string) => void; onBack?: () => void;
};

export function ArmoryItemDetails({item, profile, controller, equipmentLabel, onPurchased, onNotice, onBack}: DetailProps) {
  const [confirming, setConfirming] = useState(false);
  const action = useRef<HTMLButtonElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const summaryId = useId(), titleId = useId();
  const owned = ownsCosmetic(profile, item), level = levelProgress(profile.xp).level;
  const equipped = equippedCosmetic(profile, controller.catalog, item.equipment)?.id === item.id;
  const price = cosmeticPrice(item), locked = !owned && item.unlockLevel > level, shortfall = Math.max(0, price - profile.balance);
  const unavailable = locked || !owned && shortfall > 0;
  useEffect(() => {
    if (confirming) cancel.current?.focus();
    else if (wasConfirming.current) action.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const dismiss = () => setConfirming(false);
  const purchase = () => {
    const result = controller.purchase(item.id);
    setConfirming(false);
    if (result.success) {
      onNotice(result.reason === 'purchased' ? `${item.label} purchased for ${number(result.spent)} credits. Ready to equip.` : `${item.label} is already owned.`);
      onPurchased(item.id);
    } else {
      onNotice(result.reason === 'insufficient-credits' ? 'Not enough credits. Your wallet has changed.' : result.reason === 'level-locked' ? `Requires level ${item.unlockLevel}.` : 'Purchase unavailable. No credits were spent.');
    }
    action.current?.focus();
  };
  return <section className="armory-detail" aria-labelledby={titleId} onKeyDown={event => {
    if (confirming && event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); dismiss();}
  }}>
    {onBack && <button type="button" className="armory-back armory-secondary" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/>Back to finishes</button>}
    <CosmeticPreview item={item}/>
    <div className="armory-detail-heading"><span>{equipmentLabel}</span><h3 id={titleId}>{item.label}</h3>
      <span className={`armory-status${locked ? ' is-locked' : ''}`}>
        {equipped ? <><Check size={14} aria-hidden="true"/>Equipped</> : owned ? <><Check size={14} aria-hidden="true"/>Owned</> : locked ? <><LockKeyhole size={14} aria-hidden="true"/>Level locked</> : 'Not owned'}
      </span></div>
    <dl className="armory-detail-facts"><div><dt>Rarity</dt><dd>{item.rarity ?? (item.isDefault ? 'Standard' : 'Finish')}</dd></div>
      <div><dt>Required level</dt><dd>{item.unlockLevel}{locked ? ` (you are ${level})` : item.unlockLevel <= level ? ' / reached' : ' / already owned'}</dd></div>
      <div><dt>{owned ? 'Ownership' : 'Price'}</dt><dd>{owned ? item.isDefault ? 'Included' : 'In your collection' : <><Coins size={14} aria-hidden="true"/>{number(price)} credits</>}</dd></div></dl>
    {locked ? <p className="armory-requirement">Reach level {item.unlockLevel} to purchase.</p> : !owned && shortfall > 0 ?
      <p className="armory-requirement">{number(shortfall)} more credits needed.</p> : null}
    {confirming && !owned ? <div className="armory-confirmation" role="group" aria-label="Purchase confirmation" aria-describedby={summaryId}>
      <p id={summaryId}>Buy <strong>{item.label}</strong> for <strong>{number(price)} credits</strong>?</p>
      <dl><div><dt>Wallet</dt><dd>{number(profile.balance)}</dd></div><div><dt>After purchase</dt><dd>{number(Math.max(0, profile.balance - price))} credits</dd></div></dl>
      <div className="armory-confirm-actions"><button type="button" ref={cancel} className="armory-secondary" onClick={dismiss}>Cancel</button>
        <button type="button" className="progression-item-action" disabled={unavailable} onClick={purchase}><ShoppingCart size={15} aria-hidden="true"/>Confirm purchase</button></div>
    </div> : <button type="button" ref={action} className="progression-item-action" disabled={equipped || unavailable}
      aria-label={equipped ? `${item.label}, equipped` : owned ? `Equip ${item.label}` : locked ? `${item.label}, locked until level ${item.unlockLevel}` : `Buy ${item.label} for ${number(price)} credits${shortfall ? ', insufficient credits' : ''}`}
      onClick={() => {
        if (owned) {
          onNotice(controller.equip(item.equipment, item.id) ? `${item.label} equipped.` : 'Unable to equip this item.');
        } else {setConfirming(true);}
      }}>{equipped || owned ? <Check size={15} aria-hidden="true"/> : locked ? <LockKeyhole size={15} aria-hidden="true"/> : <ShoppingCart size={15} aria-hidden="true"/>}
      {equipped ? 'Equipped' : owned ? 'Equip' : locked ? `Requires level ${item.unlockLevel}` : shortfall ? 'Insufficient credits' : `Buy for ${number(price)} credits`}</button>}
  </section>;
}

type InventoryProps = {
  controller: ProgressionController; profile: ProgressionProfile; initialEquipment?: string;
  equipmentLabels: Readonly<Record<string, string>>; view: 'collection' | 'unlocks';
  onViewChange: (view: 'collection' | 'unlocks') => void; onNotice: (notice: string) => void;
};

export function ArmoryInventory({controller, profile, initialEquipment, equipmentLabels, view, onViewChange, onNotice}: InventoryProps) {
  const initial = controller.catalog.find(item => item.equipment === initialEquipment) ?? controller.catalog.find(item => cosmeticCategory(item) === 'weapon') ?? controller.catalog[0];
  const [category, setCategory] = useState<CosmeticCategory>(initial ? cosmeticCategory(initial) : 'weapon');
  const [equipment, setEquipment] = useState(initial?.equipment ?? '');
  const [knifeType, setKnifeType] = useState('all'), [availability, setAvailability] = useState('all');
  const [query, setQuery] = useState(''), [sort, setSort] = useState('level'), [selectedId, setSelectedId] = useState('');
  const [pageState, setPageState] = useState({key: '', page: 0});
  const [focusPurchased, setFocusPurchased] = useState(false);
  const [inspecting, setInspecting] = useState(false), [returnToResults, setReturnToResults] = useState(false);
  const previousView = useRef(view);
  const inventory = useRef<HTMLDivElement>(null);
  const panelId = useId(), headingId = useId();
  const equipmentLabel = (id: string) => equipmentLabels[id] ?? ({knife: 'Knife', gloves: 'Gloves', agent: 'Bot agent'}[id] ?? id);
  const level = levelProgress(profile.xp).level;
  const equipmentIds = [...new Set(controller.catalog.filter(item => cosmeticCategory(item) === category).map(item => item.equipment))];
  const knifeTypes = [...new Map(controller.catalog.filter(item => cosmeticCategory(item) === 'knife').map(item =>
    [item.assetKey ?? 'knife', item.isDefault ? 'Default CT knife' : item.label.split(' | ')[0]])).entries()];
  const items = cosmeticsForEquipment(profile, controller.catalog, equipment, view === 'unlocks' ? 'unowned' : 'owned')
    .filter(item => cosmeticCategory(item) === category && (category !== 'knife' || knifeType === 'all' || (item.assetKey ?? 'knife') === knifeType) &&
      `${item.label} ${equipmentLabel(item.equipment)} ${item.rarity ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()) &&
      (view !== 'unlocks' || availability === 'all' || item.unlockLevel <= level && cosmeticPrice(item) <= profile.balance))
    .sort((a, b) => (sort === 'price' ? cosmeticPrice(a) - cosmeticPrice(b) : sort === 'name' ? 0 : a.unlockLevel - b.unlockLevel) || a.label.localeCompare(b.label));
  const filterKey = JSON.stringify([view, category, equipment, knifeType, availability, query, sort]);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(pageCount - 1, pageState.key === filterKey ? pageState.page : Math.floor(Math.max(0, items.findIndex(item => item.id === selectedId)) / PAGE_SIZE));
  const visible = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const selected = visible.find(item => item.id === selectedId) ?? visible[0];
  useEffect(() => {
    if (!focusPurchased || view !== 'collection') return;
    inventory.current?.querySelector<HTMLButtonElement>('.armory-detail .progression-item-action')?.focus();
    setFocusPurchased(false);
  }, [focusPurchased, view, selected?.id]);
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    setInspecting(focusPurchased);
  }, [view, focusPurchased]);
  useEffect(() => {
    if (inspecting && window.matchMedia('(max-width: 720px)').matches) inventory.current?.querySelector<HTMLButtonElement>('.armory-back')?.focus();
  }, [inspecting]);
  useEffect(() => {
    if (!returnToResults) return;
    inventory.current?.querySelector<HTMLButtonElement>('.progression-choice[aria-pressed=true]')?.focus();
    setReturnToResults(false);
  }, [returnToResults]);
  const resetSelection = () => {setSelectedId(''); setInspecting(false); setPageState({key: '', page: 0}); onNotice('');};
  const selectCategory = (id: CosmeticCategory) => {
    if (id === category) return;
    setCategory(id); setEquipment(controller.catalog.find(item => cosmeticCategory(item) === id)?.equipment ?? '');
    setKnifeType('all'); setQuery(''); setAvailability('all'); resetSelection();
  };
  return <div className="armory-inventory" ref={inventory}>
    <div className="progression-tabs" role="tablist" aria-label="Cosmetic category">{categories.map(({id, label, icon: Icon}, index) =>
      <button key={id} id={`${panelId}-${id}`} type="button" role="tab" aria-selected={category === id} aria-controls={panelId} tabIndex={category === id ? 0 : -1}
        onClick={() => selectCategory(id)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % categories.length : event.key === 'ArrowLeft' ? (index + categories.length - 1) % categories.length :
            event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); selectCategory(categories[next].id);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{id === 'gloves' ? <img className="progression-gloves-icon" src={DEFAULT_GLOVE_PREVIEW} alt=""/> : <Icon size={16} aria-hidden="true"/>}{label}</button>)}</div>
    <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${category}`}>
      <div className="progression-filter">
        {equipmentIds.length > 1 && <label>Weapon<select aria-label="Equipment" value={equipment} onChange={event => {setEquipment(event.target.value); setQuery(''); resetSelection();}}>
          {equipmentIds.map(id => <option key={id} value={id}>{equipmentLabel(id)}</option>)}</select></label>}
        {category === 'knife' && <label>Model<select aria-label="Knife type" value={knifeType} onChange={event => {setKnifeType(event.target.value); resetSelection();}}>
          <option value="all">{view === 'collection' ? 'All owned knives' : 'All knife models'}</option>{knifeTypes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
        {view === 'unlocks' && <label>Availability<select aria-label="Availability" value={availability} onChange={event => {setAvailability(event.target.value); resetSelection();}}>
          <option value="all">All unlocks</option><option value="affordable">Affordable now</option></select></label>}
        <label>Sort<select aria-label="Sort cosmetics" value={sort} onChange={event => {setSort(event.target.value); resetSelection();}}>
          <option value="level">Required level</option><option value="price">Price: low to high</option><option value="name">Name</option></select></label>
        <label className="armory-search-label">Search<div className="progression-search"><Search size={16} aria-hidden="true"/><input aria-label="Search cosmetics" type="search" placeholder="Search finishes" value={query} onChange={event => {setQuery(event.target.value); resetSelection();}}/></div></label>
      </div>
      <div className={`armory-browser${inspecting ? ' is-inspecting' : ''}`}><section className="armory-results" aria-labelledby={headingId}>
        <div className="progression-catalog-title"><h3 id={headingId}>{equipmentLabel(equipment)}</h3><span>{items.length} {view === 'collection' ? 'owned' : 'not owned'}</span></div>
        <ul className="progression-items" aria-label="Cosmetic choices">{visible.map(item => {
          const owned = ownsCosmetic(profile, item), locked = !owned && item.unlockLevel > level;
          const equipped = equippedCosmetic(profile, controller.catalog, item.equipment)?.id === item.id;
          const state = equipped ? 'Equipped' : owned ? 'Owned' : locked ? `Level ${item.unlockLevel}` : cosmeticPrice(item) > profile.balance ? 'Need credits' : 'Available';
          return <li key={item.id}><button type="button" className={`progression-choice${equipped ? ' is-equipped' : ''}${locked ? ' is-locked' : ''}`}
            aria-pressed={selected?.id === item.id} aria-label={`Preview ${item.label}, ${equipmentLabel(item.equipment)}, ${state}`} onClick={() => {setSelectedId(item.id); setInspecting(true);}}>
            <CosmeticPreview item={item}/><span className="progression-choice-name">{item.label}<small>{equipmentLabel(item.equipment)}</small></span>
            <span className="armory-item-footer"><span className="progression-choice-state">{equipped ? <Check size={13} aria-hidden="true"/> : locked ? <LockKeyhole size={13} aria-hidden="true"/> : null}{state}</span>
              {!owned && <span className="progression-price"><Coins size={12} aria-hidden="true"/>{number(cosmeticPrice(item))}</span>}</span>
          </button></li>;
        })}</ul>
        {!items.length && <div className="progression-empty"><p>{query || availability !== 'all' ? 'No finishes match your filters.' : view === 'collection' ? 'No owned finishes for this selection.' : 'All finishes in this selection are owned.'}</p>
          {query || availability !== 'all' ? <button type="button" className="armory-secondary" onClick={() => {setQuery(''); setAvailability('all'); resetSelection();}}>Clear filters</button> :
            <button type="button" className="armory-secondary" onClick={() => onViewChange(view === 'collection' ? 'unlocks' : 'collection')}>{view === 'collection' ? 'Browse unlocks' : 'View collection'}</button>}</div>}
        {items.length > PAGE_SIZE && <nav className="armory-pagination" aria-label="Cosmetic pages"><button type="button" className="progression-icon-button" aria-label="Previous page" title="Previous page" disabled={page === 0}
          onClick={() => {setPageState({key: filterKey, page: page - 1}); setSelectedId('');}}><ArrowLeft size={17}/></button>
          <span aria-live="polite">{page * PAGE_SIZE + 1}-{Math.min(items.length, (page + 1) * PAGE_SIZE)} of {items.length}</span>
          <button type="button" className="progression-icon-button" aria-label="Next page" title="Next page" disabled={page === pageCount - 1}
            onClick={() => {setPageState({key: filterKey, page: page + 1}); setSelectedId('');}}><ArrowRight size={17}/></button></nav>}
      </section>
      {selected && <ArmoryItemDetails key={`${view}-${selected.id}`} item={selected} profile={profile} controller={controller} equipmentLabel={equipmentLabel(selected.equipment)} onNotice={onNotice}
        onBack={() => {setInspecting(false); setReturnToResults(true);}}
        onPurchased={id => {setSelectedId(id); setQuery(''); setAvailability('all'); setPageState({key: '', page: 0}); setFocusPurchased(true); onViewChange('collection');}}/>}
      </div>
    </div>
  </div>;
}
