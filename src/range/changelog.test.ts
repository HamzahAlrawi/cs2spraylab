import {createElement} from 'react';
import {createHash} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {Changelog} from './Changelog';
import {changelogHistory, changelogReleases, latestChanges} from './changelog-data';

describe('append-only changelog', () => {
  it('identifies the requested baseline without claiming a deployment', () => {
    expect(latestChanges.title).toBe('Latest update');
    expect(latestChanges.baselineCommit).toBe('49d8ea6');
    const html = renderToStaticMarkup(createElement(Changelog));
    expect(html).toContain('Latest update');
    expect(html).toContain('Since baseline <code>49d8ea6</code>');
    expect(html).not.toMatch(/<time|deployed on|released on/i);
  });

  it('keeps every section and item from the previously published update unchanged', () => {
    const previous = changelogHistory.find(release => release.id === 'update-49d8ea6')!;
    expect(previous.baselineCommit).toBe('06774a9');
    // Fingerprint of the sections in commit 49d8ea6, not a copy of the current data.
    expect(createHash('sha256').update(JSON.stringify(previous.sections)).digest('hex'))
      .toBe('86193c4620fecd420ed914d753580dbfee5ac311e32031d5ec4b59375bfa03bf');
    expect(changelogReleases).toEqual([latestChanges, ...changelogHistory]);
    expect(new Set(changelogReleases.map(release => release.id)).size).toBe(changelogReleases.length);
  });

  it('covers the accumulated completed features', () => {
    expect(latestChanges.sections.map(section => section.id)).toEqual([
      'combat', 'weapons', 'movement', 'arenas', 'bot-behavior', 'connection', 'presentation', 'performance',
    ]);
    expect(new Set(latestChanges.sections.map(section => section.id)).size).toBe(latestChanges.sections.length);
    expect(latestChanges.sections.find(section => section.id === 'connection')!.items.join(' ')).toContain('Removed simulated network latency');
    expect(latestChanges.sections.find(section => section.id === 'bot-behavior')!.items.join(' ')).toContain('shot-confirmed burst timing');
    expect(latestChanges.sections.find(section => section.id === 'performance')!.items.join(' ')).toContain('toolbar FPS toggle');
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
