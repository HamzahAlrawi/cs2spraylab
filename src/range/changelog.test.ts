import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {Changelog} from './Changelog';
import {unreleasedChanges} from './changelog-data';

describe('unreleased changelog', () => {
  it('identifies the requested baseline without claiming a deployment', () => {
    expect(unreleasedChanges.status).toBe('Unreleased');
    expect(unreleasedChanges.baselineCommit).toBe('06774a9');
    const html = renderToStaticMarkup(createElement(Changelog));
    expect(html).toContain('Unreleased');
    expect(html).toContain('Since baseline <code>06774a9</code>');
    expect(html).not.toMatch(/<time|deployed on|released on/i);
  });

  it('covers the accumulated completed features', () => {
    expect(unreleasedChanges.sections.map(section => section.id)).toEqual([
      'duels', 'weapons', 'progression', 'collection', 'performance', 'hearing',
    ]);
    expect(new Set(unreleasedChanges.sections.map(section => section.id)).size).toBe(unreleasedChanges.sections.length);
    expect(unreleasedChanges.sections.find(section => section.id === 'hearing')!.items.join(' ')).toContain('HRTF');
    for (const section of unreleasedChanges.sections) {
      expect(section.items.length).toBeGreaterThan(0);
      expect(section.items.length).toBeLessThanOrEqual(3);
    }
  });

  it('renders labeled sections with lists and local-only accuracy boundaries', () => {
    const html = renderToStaticMarkup(createElement(Changelog));
    for (const section of unreleasedChanges.sections) {
      expect(html).toContain(`aria-labelledby="changelog-${section.id}"`);
      expect(html).toContain(`id="changelog-${section.id}"`);
    }
    expect(html.match(/<ul>/g)).toHaveLength(unreleasedChanges.sections.length);
    expect(html.match(/<li>/g)).toHaveLength(unreleasedChanges.sections.reduce((count, section) => count + section.items.length, 0));
    expect(html).toContain('Progress and cosmetics stay in this browser.');
    expect(html).toContain('Cosmetics are not CS2 inventory items.');
    expect(html).toContain('not make the trainer an exact CS2 reproduction.');
  });
});
