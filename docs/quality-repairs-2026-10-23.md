# Map and combat presentation repair checkpoint

Final regression verification continued on October 24, 2026.

## Collision and ramp diagnosis

`node tools/audit-native-collision-source.mjs --export-grenade-clips` independently
reconstructs every retained native face and validates the complete typed arrays,
primitive identities, source materials and player/bullet masks. The installed
Dust 2 archive SHA-256 is
`51d6bb432b6553bfae6c38219a527c5de2464a2b107080f2b8be7d8427ebb885`.
It matches the imported archive. All 433,063 published gameplay faces match the
PHYS extraction. This establishes extraction fidelity, not Rubikon contact parity.

The source also has 2,320 grenade-only clip faces, now retained in the separate
`grenade-clips.json`/`.bin` archive. They deliberately do not block player or bullet
queries. A future utility implementation must combine native masks correctly and
validate radius sweeps, material response, dynamic props and bounce trajectories
against recorded CS2 results. This work does not certify native grenade physics.

`node tools/audit-dust2-movement.mjs --motor-routes` passed its native supported
route checks and 125,184 stationary ticks without a false airborne tick.
`node tools/audit-dust2-landing.mjs --assert` found no repeated contacts across
120 accepted starts/four movement directions in its Mid-ramp grid. These are
finite fixtures, not an assertion that every map contact has been measured.

Both simulations previously played a loud landing for any support reacquisition.
They now require a fresh impact at the locally captured
`sv_min_jump_landing_sound=260` units/s. Normal running steps retain their existing
distance clock; this is not an arbitrary sound debounce or a movement retune.

## Visual gaps and lighting

The B tunnel exit audit is `node tools/audit-b-tunnel-visuals.mjs`. Fixed map-local
shadow bounds remove the previous 12-metre player-following shadow rebake/pop.
Only exact nearby geometry casts/receives those shadows. Distant context is a
separate visual-only approximation clipped out of each padded native chunk.
It cannot receive shots or change collision, navigation, radar or combat scale.

Prepared shadow maps have explicit ownership: one retained next map, transferred
once on activation, released on cancellation/eviction. Background uploads and
shadow baking restore the live framebuffer, viewport, scissor and render counters.
The same renderer survives manual chunk selection.

## Combat presentation and armory

Resolved hit events drive a six-entry/five-second death feed and bounded pooled
character particles. World contacts never follow the camera or a moving victim.
Blood/helmet particles are authored fallbacks; native animation-derived death
guidance and constrained corpse physics do not reproduce the entire Source 2
animation/ragdoll system. Player death camera timing is a presentation estimate.

Armory browsing separates owned collection from unlock shopping, pages results,
shows one selected-item preview, confirms purchases and keeps equip explicit.
Progression economics and save schema are unchanged. Desktop/mobile keyboard,
focus, pagination, purchase, persistence and lock tests cover the new workflow.

## Transition verification

`node tools/audit-chunk-handoffs.mjs` measures the engine handoff, not just
`RealMapSession.prepareRound()`. It includes actor reconstruction and the first
rendered frames, and asserts the requested 500-ms prepared-transition budget.
Use `--cpu-rate=4` for a throttled witness. Reports live under ignored `research/`.

Completed recordings now transfer owned buffers when the old simulation is
discarded. Public/live `export()` still deep-copies data. Geometry-only leg probe
metadata is cached across clones; poses and IK/contact state remain actor-local.
Cold downloads or a round ending before preparation completes cannot be promised
the same transition budget. Constrained/data-saving devices intentionally preload
less to avoid memory pressure.

Final sampled five-bot prepared handoffs (Catwalk and B entry): 76.5/64.9 ms
normally and 364.7/333.2 ms with Chromium 4x CPU throttling. First-frame CPU peaks
were 26.1/28.4 ms normally and 166.7/97.6 ms throttled: the half-second handoff
budget passes, but this is not a claim of uninterrupted 60 FPS on weak CPUs.
The distant backdrop is 792,708 bytes decoded / 709,985 compressed, one mesh and
material, zero textures and one additional draw call. It remains a deliberately
lossy backdrop outside exact playable geometry, not a replacement for native map
surfaces. New selected chunks reuse the renderer, and rapid changes queue the
latest selection instead of leaving the wrong chunk active.

Validation: `npm run check` passed 4,046 tests across 213 files and the production
build. Native assets passed `npm run assets:check`. Chromium browser checks cover
map selection/reuse, round capture/restart/review, resolved-hit effects and feed,
visited-map disk reuse with HTTP caching disabled, and pixel-preserving desktop/
mobile background GPU preparation. Armory workflows also passed 24 targeted
desktop/mobile checks. Exhaustive native-route tests keep all geometric asserts;
their two large cover/stance sweeps allow 60 seconds rather than a machine-sensitive
30-second timeout. Changelog history was preserved and new sections appended.
The final production smoke passed all nine modes in both desktop/mobile layouts:
18 checks, no browser or asset errors, nonblank canvases and no horizontal overflow.
No deployment or Git commit was performed in this repair pass.
