export type ChangelogSection = {
  id: string;
  title: string;
  items: readonly string[];
};

export type ChangelogRelease = {
  id: string;
  title: string;
  baselineCommit: string;
  sections: readonly ChangelogSection[];
};

export const latestChanges = {
  id: 'update-2026-10-05',
  title: 'Latest update',
  baselineCommit: '49d8ea6',
  sections: [
    {id: 'combat', title: 'Penetration & collaterals', items: [
      'Material-aware entry/exit rays carry damage through penetrable cover and multiple opponents. Range collaterals preserve physical target-mesh scoring.',
      'Shotgun pellets share discharge-level feedback and scoring; armor is consumed across pellets rather than reused for each hit.',
      'Installed-build recoil tables, shotgun patterns, spread transforms and penetration arithmetic have new offline verification fixtures.',
    ]},
    {id: 'weapons', title: 'Weapons & actions', items: [
      'Nova, XM1014, MAG-7, Sawed-Off and Zeus x27, with extracted cadence, accuracy, recoil, range and reserve data. Zeus is also available on slot 4.',
      'Finite reserves, magazine and interruptible shell reload states, slower silent reloads while holding R, and Zeus recharge.',
      'Knife slash/stab, hit/miss cooldowns and backstabs in Duel. Shotguns have ten native finishes each; Zeus has its seven available native finishes.',
    ]},
    {id: 'movement', title: 'Movement & traversal', items: [
      'Shared player/bot hull contacts, step-up, ramp, ladder, shallow-water and partner-support handling.',
      'Current native landing-factor arithmetic, centered bunnyhop window, jump-spam rejection and crouch/contact regressions.',
      'Experienced bots can quietly climb authored routes and coordinate partner boosts through the same physics as the player.',
    ]},
    {id: 'arenas', title: 'Arenas & team tactics', items: [
      'Fifteen new traversal/environment POIs add stairs, ramps, lofts, ladders, vents, glass, sliding gates and movable cargo to the existing cover catalog.',
      'Doors, breakable panels and displaced props update combat, movement, rendering and acoustics together.',
      'Evidence-led trades, synchronized entries, crossfires, shadow cues and knife-equipped opponents. Hidden enemy positions do not grant firing permission.',
    ]},
    {id: 'bot-behavior', title: 'Duel behavior', items: [
      'Committed weapon/range-aware exchanges and shot-confirmed burst timing replace repeated empty peek loops.',
      'Counterstrafe re-engagements, nearby-cover resets and changing firing lines keep open fights active while preserving deliberate escapes.',
      'Steadier uncertain sound bearings and fresh-audio priority improve contact expectations without revealing hidden targets.',
    ]},
    {id: 'connection', title: 'Responsive combat, radar & armor', items: [
      'Removed simulated network latency, delayed input and hit feedback, prediction replay and shot rewind. Old saved ping settings are ignored.',
      'A compact rotating radar shows visible contacts and expiring last-known positions, with zoom and visibility controls.',
      'Independent Kevlar, helmet and armor-condition controls for both sides and individual opponents, with armor-aware XP weighting.',
    ]},
    {id: 'presentation', title: 'Animation, audio & performance', items: [
      'Lazy native weapon gestures with stable anchors, phase-matched reloads and event-timed native weapon foley.',
      'Cover-aware directional audio, immediate hit-frame skeletal death physics and pooled Zeus electrical wires instead of a firearm flame.',
      'Fewer duplicate skeleton updates, compatible mesh batching, bounded caches, cached terrain routing and radar sizing fixes; shot math is unchanged.',
    ]},
    {id: 'performance', title: 'Frame rate & monitoring', items: [
      'Allocation-light cover rays, contributing-animation scheduling and memoized Duel setup reduce repeated CPU work.',
      'Fixed untracked dropped weapons accumulating across rounds; allocation-light corpse contacts and sleeping-pose reuse reduce post-kill CPU work.',
      'A toolbar FPS toggle and CPU-aware automatic pose sampling make performance easier to monitor and adapt without changing gameplay timing.',
    ]},
  ] satisfies readonly ChangelogSection[],
} as const satisfies ChangelogRelease;

// Append new releases without rewriting the previously published entries.
export const changelogHistory = [
  {
    id: 'update-49d8ea6',
    title: 'Previous update (49d8ea6)',
    baselineCommit: '06774a9',
    sections: [
      {id: 'duels', title: 'AI Duel & arenas', items: [
        'Bots remember recent sightings and nearby re-peeks without tracking you through walls. Hit feedback updates on the damage frame; player and AI share armor-aware aim punch and new constrained death falls.',
        'Authored points of interest create coherent cover, routes and props, with corrected top surfaces. One- and two-bot arenas can be made smaller.',
        'Bots vary holds, hear weapon-specific sound ranges and approach quietly in small duels. Beginner peeks and mid-level difficulty are rebalanced without weakening level 10/10+.',
      ]},
      {id: 'weapons', title: 'Weapons & actions', items: [
        'Expanded firearm data and loadouts, including sidearm-only practice, scopes, burst modes and R8 alternate fire.',
        'Native draw, reload, inspect and supported firing animations; knife choices, weapon-specific bot grips and dropped-weapon pickups.',
        'Native muzzle flames and pooled, instant-hit cosmetic tracers. Suppressed guns leave no tracer.',
      ]},
      {id: 'progression', title: 'XP, credits & achievements', items: [
        'Local XP, levels, a credit wallet and one-time milestones; eligible cosmetics are purchased rather than automatically owned.',
        'Permanent achievements track combat, technique, training, collection and career goals.',
        'Bot difficulty has twice its previous XP weighting. Credits keep paying after level 100.',
      ]},
      {id: 'collection', title: 'Cosmetics & owned collection', items: [
        'All 20 special knife families, both stock knives, 557 knife finishes, native inventory previews, gloves and bot agents.',
        'Owned-only collections are scoped to the selected gun, with a separate Unlocks shop. Selecting a gun with owned finishes keeps Loadout open at its finishes.',
      ]},
      {id: 'performance', title: 'Performance & browser play', items: [
        'Batched impacts and scenery, bounded asset caches, and less work for idle or hidden ranges.',
        'Adaptive and performance quality, frame limits, an optional FPS counter and supported-browser shortcut protection.',
        'Confirmed mouse capture prevents accidental drag-only aiming after switching drills. Animated barrel anchors and bounded effects avoid per-shot GPU allocations.',
      ]},
      {id: 'hearing', title: 'Hearing practice', items: [
        'Locate hidden native footsteps and shots on an overhead board, with direction/distance feedback, replay and session history.',
        'Headphone, stereo and mono profiles, HRTF/equal-power spatialization, surface choices, muffling and level calibration.',
      ]},
    ],
  },
] as const satisfies readonly ChangelogRelease[];

export const changelogReleases: readonly ChangelogRelease[] = [latestChanges, ...changelogHistory];
