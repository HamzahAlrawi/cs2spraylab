export type ChangelogSection = {
  id: string;
  title: string;
  items: readonly string[];
};

export const unreleasedChanges = {
  status: 'Unreleased',
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
  ] satisfies readonly ChangelogSection[],
} as const;
