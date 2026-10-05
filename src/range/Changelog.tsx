import {changelogReleases} from './changelog-data';
import './changelog.css';

export function Changelog() {
  return <div className="drawer-content changelog-content">
    {changelogReleases.map(release => <section key={release.id} className="changelog-update" aria-labelledby={`changelog-${release.id}`}>
      <div className="changelog-release"><h2 id={`changelog-${release.id}`}>{release.title}</h2><span>Since baseline <code>{release.baselineCommit}</code></span></div>
      {release.sections.map(section => <section key={section.id} className="changelog-section" aria-labelledby={`changelog-${release.id}-${section.id}`}>
        <h3 id={`changelog-${release.id}-${section.id}`}>{section.title}</h3>
        <ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul>
      </section>)}
    </section>)}
    <p className="changelog-note">Progress and cosmetics stay in this browser. Cosmetics are not CS2 inventory items. Native data and assets do not make the trainer an exact CS2 reproduction.</p>
  </div>;
}
