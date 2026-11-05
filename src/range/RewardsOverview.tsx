import {ArrowRight, Check, Coins, Flag, Trophy} from 'lucide-react';
import {ACHIEVEMENTS, achievementProgress} from './achievements';
import {CosmeticPreview} from './ArmoryInventory';
import {cosmeticPrice, levelProgress, ownsCosmetic, PROGRESSION_MILESTONES, type CosmeticDefinition, type ProgressionProfile} from './progression';

export function RewardsOverview({profile, catalog, activeEquipment, onFinish, onAchievements, onMilestones}: {
  profile: ProgressionProfile; catalog: readonly CosmeticDefinition[]; activeEquipment?: string;
  onFinish: (item: CosmeticDefinition) => void; onAchievements: () => void; onMilestones: () => void;
}) {
  const level = levelProgress(profile.xp).level;
  const goals = ACHIEVEMENTS.map(item => ({item, progress: achievementProgress(item, profile, catalog, level)}))
    .filter(row => !row.progress.earned).sort((a, b) => b.progress.fraction - a.progress.fraction || a.item.target - b.item.target).slice(0, 3);
  const unowned = catalog.filter(item => !item.isDefault && !ownsCosmetic(profile, item));
  const available = unowned.filter(item => item.unlockLevel <= level).sort((a,b) =>
    +(b.equipment === activeEquipment) - +(a.equipment === activeEquipment) ||
    +(cosmeticPrice(b) <= profile.balance) - +(cosmeticPrice(a) <= profile.balance) || cosmeticPrice(a) - cosmeticPrice(b)).slice(0, 3);
  const next = unowned.filter(item => item.unlockLevel > level).sort((a,b) => a.unlockLevel-b.unlockLevel || cosmeticPrice(a)-cosmeticPrice(b))[0];
  const milestone = PROGRESSION_MILESTONES.find(item => !profile.milestones.includes(item.id) &&
    (item.kind === 'level' ? level : profile.completedDuels + profile.completedDrills) < item.target);
  const milestoneCurrent = milestone?.kind === 'level' ? level : profile.completedDuels + profile.completedDrills;
  return <section className="rewards-overview" aria-label="Rewards overview">
    <div className="rewards-section-title"><div><small>YOUR NEXT GOALS</small><h3>Make the next session count</h3></div><span><Trophy size={15}/>{Object.keys(profile.achievements.unlocked).length} / {ACHIEVEMENTS.length} badges</span></div>
    <div className="rewards-journey"><Flag size={28} aria-hidden="true"/><div><strong>{milestone?.label ?? 'All milestones completed'}</strong>
      {milestone && <><span>{Math.min(milestoneCurrent,milestone.target).toLocaleString('en-US')} / {milestone.target.toLocaleString('en-US')}</span>
        <progress value={milestoneCurrent} max={milestone.target} aria-label={`Milestone: ${milestone.label}`}/></>}</div>
      <button type="button" className="armory-secondary" onClick={onMilestones}>{milestone ? <><Coins size={15}/>{milestone.credits.toLocaleString('en-US')} credits</> : <><Check size={15}/>Milestones</>}<ArrowRight size={14}/></button></div>
    <section className="rewards-goals" aria-label="Next achievements"><div className="rewards-section-title"><h3>Within reach</h3><button type="button" onClick={onAchievements}>All achievements <ArrowRight size={14}/></button></div>
      <ul>{goals.map(({item,progress}) => <li key={item.id}><Trophy size={19} aria-hidden="true"/><div><strong>{item.title}</strong><p>{item.description}</p><progress value={progress.current} max={progress.target} aria-label={`Next: ${item.title}`}/><small>{progress.current.toLocaleString('en-US')} / {progress.target.toLocaleString('en-US')}</small></div></li>)}</ul>
      {!goals.length && <p className="rewards-complete">Every badge earned. Your record speaks for itself.</p>}</section>
    <section className="rewards-eligible" aria-label="Available finishes"><div className="rewards-section-title"><div><h3>Choose your next finish</h3><small>{unowned.filter(item=>item.unlockLevel<=level).length} eligible to purchase</small></div></div>
      <ul>{available.map(item => <li key={item.id}><button type="button" onClick={() => onFinish(item)} aria-label={`View unlock ${item.label}`}>
        <CosmeticPreview item={item}/><strong>{item.label}</strong><span><Coins size={13}/>{cosmeticPrice(item).toLocaleString('en-US')}<small>{cosmeticPrice(item)<=profile.balance ? 'Affordable now' : `${(cosmeticPrice(item)-profile.balance).toLocaleString('en-US')} to save`}</small></span></button></li>)}</ul>
      {!available.length && <p className="rewards-complete">{next ? `More finishes open at level ${next.unlockLevel}.` : 'All currently eligible finishes are in your collection.'}</p>}
      {next && <button type="button" className="rewards-next-finish" onClick={() => onFinish(next)}><span>ON THE HORIZON</span><strong>{next.label}</strong><small>Level {next.unlockLevel}</small><ArrowRight size={16}/></button>}</section>
  </section>;
}
