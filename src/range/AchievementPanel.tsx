import {useState} from 'react';
import {Award, Check, Crosshair, GraduationCap, Paintbrush, Swords, Trophy} from 'lucide-react';
import {ACHIEVEMENTS, achievementProgress, type AchievementCategory} from './achievements';
import {levelProgress, type CosmeticDefinition, type ProgressionProfile} from './progression';

const categories: readonly {id: AchievementCategory; label: string; icon: typeof Trophy}[] = [
  {id: 'combat', label: 'Combat', icon: Swords}, {id: 'technique', label: 'Technique', icon: Crosshair},
  {id: 'training', label: 'Training', icon: GraduationCap}, {id: 'collection', label: 'Collection', icon: Paintbrush},
  {id: 'career', label: 'Career', icon: Award},
];
const number = (value: number) => value.toLocaleString('en-US');

export function AchievementPanel({profile, catalog}: {profile: ProgressionProfile; catalog: readonly CosmeticDefinition[]}) {
  const [category, setCategory] = useState('all'), [status, setStatus] = useState('all'), [sort, setSort] = useState('default');
  const level = levelProgress(profile.xp).level;
  const achievements = ACHIEVEMENTS.map(item => ({...item, progress: achievementProgress(item, profile, catalog, level)}));
  const earned = achievements.filter(item => item.progress.earned).length;
  const items = achievements.filter(item => (category === 'all' || item.category === category) &&
    (status === 'all' || status === 'earned' && item.progress.earned || status === 'remaining' && !item.progress.earned))
    .sort((a, b) => sort === 'progress' ? +a.progress.earned - +b.progress.earned || b.progress.fraction - a.progress.fraction :
      sort === 'recent' ? +(b.progress.earnedAt ?? -1) - +(a.progress.earnedAt ?? -1) : 0);
  return <section className="progression-achievements" aria-label="Achievements">
    <header className="achievement-overview"><Trophy size={26} aria-hidden="true"/><div><h3>Achievements</h3>
      <span>{earned} / {ACHIEVEMENTS.length} earned</span><progress value={earned} max={ACHIEVEMENTS.length} aria-label="Achievements earned"/></div></header>
    <div className="progression-filter">
      <select aria-label="Achievement category" value={category} onChange={event => setCategory(event.target.value)}>
        <option value="all">All categories</option>{categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <select aria-label="Achievement status" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="all">All achievements</option><option value="remaining">In progress</option><option value="earned">Earned</option></select>
      <select aria-label="Sort achievements" value={sort} onChange={event => setSort(event.target.value)}>
        <option value="default">Category order</option><option value="progress">Closest to earning</option><option value="recent">Recently earned</option></select>
    </div>
    <ul className="achievement-list" aria-label="Achievement badges">{items.map(item => {
      const meta = categories.find(category => category.id === item.category)!, Icon = meta.icon;
      const {progress} = item;
      return <li key={item.id} className={`achievement-row${progress.earned ? ' is-earned' : ''}`} data-achievement={item.id}>
        <span className={`achievement-emblem achievement-${item.category}`}><Icon size={22} aria-hidden="true"/></span>
        <div className="achievement-detail"><div className="achievement-title"><h4>{item.title}</h4><span>{meta.label}</span></div>
          <p>{item.description}</p><div className="achievement-progress"><progress value={progress.current} max={progress.target} aria-label={item.title}/>
            <span>{progress.earned ? <><Check size={12} aria-hidden="true"/>Earned</> : `${number(progress.current)} / ${number(progress.target)}`}</span></div>
          {progress.earned && <time dateTime={progress.earnedAt ? new Date(progress.earnedAt).toISOString() : undefined}>
            {progress.earnedAt ? `Earned ${new Date(progress.earnedAt).toLocaleDateString('en-US', {year: 'numeric', month: 'short', day: 'numeric'})}` : 'Earned previously'}</time>}
        </div>
      </li>;
    })}</ul>
    {!items.length && <p className="progression-empty">No achievements match these filters.</p>}
  </section>;
}
