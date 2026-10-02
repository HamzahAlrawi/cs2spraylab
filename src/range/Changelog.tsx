import {unreleasedChanges} from './changelog-data';
import './changelog.css';

export function Changelog() {
  return <div className="drawer-content changelog-content">
    <div className="changelog-release"><strong>{unreleasedChanges.status}</strong><span>Since baseline <code>{unreleasedChanges.baselineCommit}</code></span></div>
    {unreleasedChanges.sections.map(section => <section key={section.id} className="changelog-section" aria-labelledby={`changelog-${section.id}`}>
      <h2 id={`changelog-${section.id}`}>{section.title}</h2>
      <ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul>
    </section>)}
    <p className="changelog-note">Progress and cosmetics stay in this browser. Cosmetics are not CS2 inventory items. Native data and assets do not make the trainer an exact CS2 reproduction.</p>
  </div>;
}
