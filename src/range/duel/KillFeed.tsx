import {Bomb, Crosshair, Flame} from 'lucide-react';
import {utilityNames} from './utility-loadout';
import {equipmentNames} from '../equipment';
import {KILL_FEED_LIMIT, type KillFeedEntry} from './kill-feed';
import './kill-feed.css';

export function KillFeed({entries, replaying = false}: {entries?: readonly KillFeedEntry[]; replaying?: boolean}) {
  if (replaying || !entries?.length) return null;
  return <div className="kill-feed" role="log" aria-label="Death feed" aria-live="polite" aria-relevant="additions" aria-atomic="false">
    <ol>{entries.slice(0, KILL_FEED_LIMIT).map(entry => {
      const weapon = entry.utility ? utilityNames[entry.utility] : equipmentNames[entry.equipment];
      const label = `${entry.shooterName} killed ${entry.victimName} with ${weapon}${entry.headshot ? ', headshot' : ''}${entry.local === 'kill' ? ', your kill' : entry.local === 'death' ? ', your death' : ''}`;
      return <li key={entry.id} className={`kill-feed-row kill-feed-${entry.local}`} aria-label={label} title={label}>
        <span className="kill-feed-shooter" aria-hidden="true">{entry.shooterName}</span>
        <span className="kill-feed-weapon" aria-hidden="true">{entry.utility ? entry.utility === 'molotov' || entry.utility === 'incendiary' ? <Flame size={17}/> : <Bomb size={17}/> : <img src={`/models/${entry.equipment}.png`} alt=""/>}<span>{weapon}</span></span>
        {entry.headshot && <Crosshair className="kill-feed-headshot" size={13} aria-hidden="true"/>}
        <span className="kill-feed-victim" aria-hidden="true">{entry.victimName}</span>
      </li>;
    })}</ol>
  </div>;
}
