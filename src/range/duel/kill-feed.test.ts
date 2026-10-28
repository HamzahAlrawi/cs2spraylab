import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {KillFeedModel, KILL_FEED_LIMIT, type KillFeedEvent} from './kill-feed';
import {KillFeed} from './KillFeed';

const kill = (patch: Partial<KillFeedEvent> = {}): KillFeedEvent => ({
  shooter: 0, victim: 1, shotId: 10, equipment: 'ak47', headshot: false, ...patch,
});

describe('live combat kill feed', () => {
  it('keeps the lethal shot equipment, names, headshot and local kill identity', () => {
    const feed = new KillFeedModel();
    const event = kill({shooterName: '  Player  ', victimName: 'SAS', headshot: true});
    feed.push(event, 1.5);
    event.equipment = 'knife';
    expect(feed.entries(1.5)).toEqual([expect.objectContaining({shooter: 0, victim: 1,
      shooterName: 'Player', victimName: 'SAS', equipment: 'ak47', headshot: true,
      local: 'kill', time: 1.5, expiresAt: 6.5})]);
  });

  it('expires at exactly five seconds without an incoming event', () => {
    const feed = new KillFeedModel();
    feed.push(kill(), 2);
    expect(feed.entries(6.999)).toHaveLength(1);
    expect(feed.entries(7)).toEqual([]);
    expect(feed.entries(20)).toEqual([]);
  });

  it('deduplicates repeated pellets for the same shooter/shot/victim without extending expiry', () => {
    const feed = new KillFeedModel();
    feed.push(kill({equipment: 'nova', headshot: true}), 0);
    feed.push(kill({equipment: 'nova', headshot: false}), .2);
    expect(feed.entries(.2)).toHaveLength(1);
    expect(feed.entries(.2)[0].headshot).toBe(true);
    expect(feed.entries(5)).toEqual([]);
  });

  it('retains distinct victims of a penetration or shotgun shot and independent shooters/shots', () => {
    const feed = new KillFeedModel();
    feed.push(kill(), 0);
    feed.push(kill({victim: 2}), 0);
    feed.push(kill({shotId: 11}), .1);
    feed.push(kill({shooter: 3}), .1);
    expect(feed.entries(.1)).toHaveLength(4);
    expect(new Set(feed.entries(.1).map(row => row.id)).size).toBe(4);
  });

  it('bounds rows, orders newest first and remembers duplicates even after capacity eviction', () => {
    const feed = new KillFeedModel();
    for (let shotId = 0; shotId < 12; shotId++) feed.push(kill({shotId}), shotId * .1);
    feed.push(kill({shotId: 0}), 2);
    expect(feed.entries(2)).toHaveLength(KILL_FEED_LIMIT);
    expect(feed.entries(2).map(row => row.shotId)).toEqual([11, 10, 9, 8, 7, 6]);
  });

  it('prunes each row independently on push as well as read', () => {
    const feed = new KillFeedModel();
    feed.push(kill(), 0);
    feed.push(kill({victim: 2}), 3);
    feed.push(kill({victim: 3}), 5);
    expect(feed.entries(5).map(row => row.victim)).toEqual([3, 2]);
    expect(feed.entries(8).map(row => row.victim)).toEqual([3]);
  });

  it('distinguishes local deaths, bot trades and an alternate local actor', () => {
    const feed = new KillFeedModel(4);
    feed.push(kill({shooter: 2, victim: 4}), 0);
    feed.push(kill({shooter: 3, victim: 2}), 0);
    feed.push(kill({shooter: 4, victim: 3, shooterName: ' '}), 0);
    expect(feed.entries(0).map(row => row.local)).toEqual(['kill', 'other', 'death']);
    expect(feed.entries(0)[0].shooterName).toBe('You');
    expect(feed.entries(0)[2].victimName).toBe('You');
    expect(feed.entries(0)[1].shooterName).toBe('Bot 3');
  });

  it('clears deduplication and clock state for a new round without reusing render keys', () => {
    const feed = new KillFeedModel();
    feed.push(kill(), 20);
    const previous = feed.entries(20);
    feed.clear();
    expect(feed.entries(0)).toEqual([]);
    feed.push(kill(), 0);
    expect(feed.entries(0)).toHaveLength(1);
    expect(feed.entries(0)[0].id).not.toBe(previous[0].id);
    expect(previous).toHaveLength(1);
    expect(Object.isFrozen(previous[0])).toBe(true);
    expect(feed.entries(0)).not.toBe(feed.entries(0));
  });

  it('rejects non-finite times without poisoning the model', () => {
    const feed = new KillFeedModel();
    for (const time of [NaN, Infinity, -Infinity]) {
      expect(() => feed.push(kill(), time)).toThrow(RangeError);
      expect(() => feed.entries(time)).toThrow(RangeError);
    }
    feed.push(kill(), 0);
    expect(feed.entries(0)).toHaveLength(1);
  });
});

describe('KillFeed presentation', () => {
  const render = (feed: KillFeedModel, replaying = false) =>
    renderToStaticMarkup(createElement(KillFeed, {entries: feed.entries(0), replaying}));

  it('labels utility kills without showing the shooter held firearm', () => {
    const feed = new KillFeedModel();
    feed.push(kill({utility: 'molotov'}), 0);
    const html = render(feed);
    expect(html).toContain('You killed Bot 1 with Molotov, your kill');
    expect(html).not.toContain('/models/ak47.png');
    expect(html).not.toContain('AK-47');
  });

  it('renders native equipment preview/name, headshot, local identity and accessible event text', () => {
    const feed = new KillFeedModel();
    feed.push(kill({headshot: true}), 0);
    feed.push(kill({shooter: 2, victim: 0, equipment: 'knife'}), 0);
    const html = render(feed);
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-relevant="additions"');
    expect(html).toContain('kill-feed-kill');
    expect(html).toContain('kill-feed-death');
    expect(html).toContain('/models/ak47.png');
    expect(html).toContain('/models/knife.png');
    expect(html).toContain('You killed Bot 1 with AK-47, headshot, your kill');
    expect(html).toContain('your death');
    expect(html).toContain('kill-feed-headshot');
  });

  it('omits the headshot marker on body kills and escapes actor names', () => {
    const feed = new KillFeedModel();
    feed.push(kill({victimName: '<script>alert(1)</script>'}), 0);
    const html = render(feed);
    expect(html).not.toContain('kill-feed-headshot');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders no feed during replay, before any kill or after expiry/clear', () => {
    const feed = new KillFeedModel();
    expect(render(feed)).toBe('');
    expect(renderToStaticMarkup(createElement(KillFeed, {}))).toBe('');
    feed.push(kill(), 0);
    expect(render(feed, true)).toBe('');
    expect(renderToStaticMarkup(createElement(KillFeed, {entries: feed.entries(5)}))).toBe('');
    feed.clear();
    expect(render(feed)).toBe('');
  });
});
