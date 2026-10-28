import {useState} from 'react';
import {ArrowRight, Check, Crosshair, Ear, Footprints, Map, Search, Shield, Target, Users, X} from 'lucide-react';
import {modeNames, type Mode} from './config';
import {modeInfo} from './mode-info';
import {drillGroups, drillSkills, matchesDrill} from './training-ui';

const icons = {duel: Users, prefire: Map, peek: Shield, precision: Footprints, burst: Footprints,
  guided: Crosshair, spray: Target, transfer: Users, hearing: Ear};

export function DrillChooser({mode, choose}: {mode: Mode; choose: (mode: Mode) => void}) {
  const [query, setQuery] = useState('');
  const groups = drillGroups.map(group => ({...group, modes: group.modes.filter(id => matchesDrill(id, query, modeNames[id], modeInfo[id].benefit))}));
  return <div className="drawer-content drill-library">
    <div className="search-field"><Search size={18} aria-hidden="true"/><input data-panel-autofocus type="search" aria-label="Find a drill" placeholder="Search drills or skills" value={query} onChange={event => setQuery(event.target.value)}/>
      {query && <button className="icon-button" aria-label="Clear drill search" onClick={() => setQuery('')}><X size={16}/></button>}</div>
    {groups.map(group => !!group.modes.length && <section key={group.name} aria-label={group.name}>
      <h2>{group.name}</h2>
      {group.modes.map(id => {const Icon = icons[id]; return <button key={id} className={`drill-choice${mode === id ? ' current' : ''}`} aria-label={`Choose ${modeNames[id]}`} aria-pressed={mode === id} onClick={() => choose(id)}>
        <Icon className="drill-choice-icon" size={22} aria-hidden="true"/>
        <span><b>{modeNames[id]}</b><span>{modeInfo[id].benefit}</span><small>{drillSkills[id]}</small></span>
        {mode === id ? <Check size={19} aria-label="Current drill"/> : <ArrowRight size={18} aria-hidden="true"/>}
      </button>;})}
    </section>)}
    {!groups.some(group => group.modes.length) && <div className="search-empty" role="status"><strong>No matching drills</strong><button className="secondary" onClick={() => setQuery('')}>Clear search</button></div>}
  </div>;
}
