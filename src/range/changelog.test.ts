import {createElement} from 'react';
import {createHash} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {Changelog} from './Changelog';
import {changelogHistory, changelogReleases, latestChanges} from './changelog-data';

describe('append-only changelog', () => {
  it('identifies the requested baseline without claiming a deployment', () => {
    expect(latestChanges.id).toBe('update-2026-10-29-radar-utility-review');
    expect(latestChanges.title).toBe('Clearer radar, grenades & round review (October 29)');
    expect(latestChanges.baselineCommit).toBe('0a1ff64');
    const html = renderToStaticMarkup(createElement(Changelog));
    expect(html).toContain('Ready rounds &amp; more Dust 2 angles (October 23)');
    expect(html).toContain('Combat feedback &amp; map delivery (October 23)');
    expect(html).toContain('Smoother Dust 2 Duels (October 20)');
    expect(html).toContain('Training reliability (October 19)');
    expect(html).toContain('Dust 2 angle coverage (October 18)');
    expect(html).toContain('CS2 coaching update (October 17)');
    expect(html).toContain('Training quality update (October 16)');
    expect(html).toContain('Since baseline <code>0a1ff64</code>');
    expect(html).not.toMatch(/<time|deployed on|released on/i);
  });

  // Fingerprints captured from af175145e581bd4cc853440af1a529856f0a5057 before adding October 8.
  it.each([
    {id: 'update-2026-10-05', baseline: '49d8ea6',
      releaseHash: 'db3b7741349dbf1bbbddf75f3900cb2f36b72ed99221a92f3b9ef97da4fdb606',
      sectionsHash: '52aa42d09c3d428c82b2447e14e86ae7f7e1b68969829b1fc2ed7cdb02b00f5d'},
    {id: 'update-49d8ea6', baseline: '06774a9',
      releaseHash: '0837fa436da3b0e2cb9d95e51844a1be7c6e7a7556e8e8ff3f00e77e64debeb9',
      sectionsHash: '86193c4620fecd420ed914d753580dbfee5ac311e32031d5ec4b59375bfa03bf'},
  ])('keeps every field, section and item of $id unchanged', ({id, baseline, releaseHash, sectionsHash}) => {
    const previous = changelogHistory.find(release => release.id === id)!;
    expect(previous.baselineCommit).toBe(baseline);
    expect(createHash('sha256').update(JSON.stringify(previous)).digest('hex')).toBe(releaseHash);
    expect(createHash('sha256').update(JSON.stringify(previous.sections)).digest('hex'))
      .toBe(sectionsHash);
  });

  it('keeps all releases in newest-first order with no duplicate IDs', () => {
    expect(changelogReleases.map(release => release.id)).toEqual(['update-2026-10-29-radar-utility-review','update-2026-10-29-grenade-presentation','update-2026-10-29-bot-difficulty','update-2026-10-28-progress-recovery','update-2026-10-28-grenade-fidelity','update-2026-10-26-utilities','update-2026-10-23-preloading','update-2026-10-23','update-2026-10-20', 'update-2026-10-19', 'update-2026-10-18', 'update-2026-10-17', 'update-2026-10-16', 'update-2026-10-08', 'update-2026-10-05', 'update-49d8ea6']);
    expect(changelogReleases).toEqual([latestChanges, ...changelogHistory]);
    expect(new Set(changelogReleases.map(release => release.id)).size).toBe(changelogReleases.length);
    expect(changelogReleases.flatMap(release => release.sections)).toHaveLength(73);
  });

  it('covers Prefire, native-map limits and expanded Duel arenas', () => {
    expect(latestChanges.sections.map(section=>section.id)).toEqual(['readable-native-radar','post-round-grenades','compact-duel-review']);
    expect(changelogHistory.find(release=>release.id==='update-2026-10-29-grenade-presentation')!.sections.map(section=>section.id)).toEqual(['grenade-input-audio','smoke-fire-flash','authored-duel-lineups']);
    expect(changelogHistory.find(release=>release.id==='update-2026-10-29-bot-difficulty')!.sections.map(section=>section.id)).toEqual(['beginner-bot-assistance']);
    expect(changelogHistory.find(release=>release.id==='update-2026-10-28-progress-recovery')!.sections.map(section=>section.id)).toEqual(['safer-local-progress','signed-owner-gifts','equipment-key-layout']);
    expect(changelogHistory.find(release=>release.id==='update-2026-10-28-grenade-fidelity')!.sections.map(section=>section.id)).toEqual(['native-grenade-mechanics','grenade-evidence-boundaries']);
    expect(changelogHistory.find(release=>release.id==='update-2026-10-26-utilities')!.sections.map(section=>section.id)).toEqual(['bot-decisions-vision', 'playable-grenades', 'native-grenade-presentation',
      'complete-utility-loop','environmental-utility-actions','contextual-team-policies']);
    expect(changelogHistory.find(release=>release.id==='update-2026-10-23-preloading')!.sections.map(section=>section.id)).toEqual(['prepared-local-maps','sampled-shot-motion','source-audit-safety',
      'map-contact-presentation','visible-combat-results','armory-browsing','duel-evidence-coaching','aim-metrics-profile','articulated-deaths','textured-context-round-start','victory-freeplay-local-maps','beginner-duel-defaults']);
    expect(changelogHistory.find(release=>release.id==='update-2026-10-23')!.sections.map(section=>section.id)).toEqual(['verified-map-delivery','combat-timing','hit-death-feedback']);
    expect(changelogHistory.find(release=>release.id==='update-2026-10-20')!.sections.map(section => section.id)).toEqual(['native-map-performance','held-angle-awareness','teammate-hearing','dynamic-duel-rounds']);
    expect(changelogHistory.find(release=>release.id==='update-2026-10-19')!.sections.map(section=>section.id)).toEqual(['real-map-duels-empty-magazines', 'dust2-holds-wheel-reload', 'weapon-switch-route-guidance', 'fight-review-repair', 'practice-workflow-repairs']);
    const october18 = changelogHistory.find(release => release.id === 'update-2026-10-18')!;
    expect(october18.sections.map(section => section.id)).toEqual(['ct-site-holds-navigation', 'training-workspace-ux']);
    const october17 = changelogHistory.find(release => release.id === 'update-2026-10-17')!;
    expect(october17.sections[0].items.join(' ')).toContain('saved practice identifiers are unchanged');
    const october16 = changelogHistory.find(release => release.id === 'update-2026-10-16')!;
    expect(october16.sections.map(section => section.id)).toEqual(['prefire-navigation-input-trades', 'trade-execution', 'training-quality-roadmap', 'native-materials-performance']);
    const october8 = changelogHistory.find(release => release.id === 'update-2026-10-08')!;
    expect(october8.sections.map(section => section.id)).toEqual(['prefire-contact-quality', 'encounter-practice', 'purposeful-practice', 'prefire-evidence', 'prefire-expansion', 'aim-reliability', 'skill-coaching', 'prefire', 'native-map', 'duel-arenas']);
    const encounters = october8.sections.find(section => section.id === 'prefire-contact-quality')!.items.join(' ');
    expect(encounters).toContain('non-shooting defenders notice visible opponents');
    expect(encounters).toContain('Quick checks counterstrafe on contact');
    expect(encounters).toContain('no added shadow pass in Low/Performance');
    expect(october8.sections.find(section => section.id === 'skill-coaching')!.items.join(' ')).toContain('Physical shot and movement calculations are unchanged');
    const aiming = october8.sections.find(section => section.id === 'aim-reliability')!.items.join(' ');
    expect(aiming).toContain('19 extracted native SAS hit capsules');
    expect(aiming).toContain('without enlarged head zones or redirected shots');
    expect(aiming).toContain('Analytic shapes remain');
    const prefire = october8.sections.find(section => section.id === 'prefire')!.items.join(' ');
    expect(prefire).toContain('8 routes and 40 sourced common angles');
    expect(prefire).toContain('stationary holds or peeking bots');
    for (const feature of ['random occupancy', 'optional return fire', 'route guide', 'repeat', 'auto-advance', 'scorecard']) {
      expect(prefire).toContain(feature);
    }
    const nativeMap = october8.sections.find(section => section.id === 'native-map')!.items.join(' ');
    for (const boundary of ['installed game', '0.0254 m', 'higher-resolution textures', 'load lazily', 'opaque geometry',
      'wallbangs and material penetration are not reproduced', 'existing analytic model',
      'do not import a Dust2 navigation engine or reproduce the complete CS2 engine']) {
      expect(nativeMap).toContain(boundary);
    }
    const arenas = october8.sections.find(section => section.id === 'duel-arenas')!.items.join(' ');
    expect(arenas).toContain('asymmetric central-cover');
    expect(arenas).toContain('player and bot sides');
    expect(arenas).toContain('12 new cover clusters and 11 new prop assemblies');
  });

  it('retains the October 5 feature coverage and compact lists across history', () => {
    const october5 = changelogHistory.find(release => release.id === 'update-2026-10-05')!;
    expect(october5.sections.map(section => section.id)).toEqual([
      'combat', 'weapons', 'movement', 'arenas', 'bot-behavior', 'connection', 'presentation', 'performance',
    ]);
    for (const release of changelogReleases) {
      expect(new Set(release.sections.map(section => section.id)).size).toBe(release.sections.length);
    }
    expect(october5.sections.find(section => section.id === 'connection')!.items.join(' ')).toContain('Removed simulated network latency');
    expect(october5.sections.find(section => section.id === 'bot-behavior')!.items.join(' ')).toContain('shot-confirmed burst timing');
    expect(october5.sections.find(section => section.id === 'performance')!.items.join(' ')).toContain('toolbar FPS toggle');
    for (const section of changelogReleases.flatMap(release => release.sections)) {
      expect(section.items.length).toBeGreaterThan(0);
      expect(section.items.length).toBeLessThanOrEqual(3);
    }
  });

  it('renders labeled sections with lists and local-only accuracy boundaries', () => {
    const html = renderToStaticMarkup(createElement(Changelog));
    for (const release of changelogReleases) {
      expect(html).toContain(`aria-labelledby="changelog-${release.id}"`);
      for (const section of release.sections) {
        expect(html).toContain(`aria-labelledby="changelog-${release.id}-${section.id}"`);
        expect(html).toContain(`id="changelog-${release.id}-${section.id}"`);
      }
    }
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const sections = changelogReleases.flatMap(release => release.sections);
    expect(html.match(/<ul>/g)).toHaveLength(sections.length);
    expect(html.match(/<li>/g)).toHaveLength(sections.reduce((count, section) => count + section.items.length, 0));
    expect(html).toContain('Progress and cosmetics stay in this browser.');
    expect(html).toContain('Cosmetics are not CS2 inventory items.');
    expect(html).toContain('not make the trainer an exact CS2 reproduction.');
  });
});
