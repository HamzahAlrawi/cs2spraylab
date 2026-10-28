# Angle Holding And Awareness

October 20, 2026. Browser-only opponent heuristics, not native CS2 bot AI or a measured FACEIT human model.

## Corrected Causes

- Native-map Duel has no procedural `arena.solids`. Sighting memory previously derived exits only from those solids, leaving native opponents focused on an occluded sighting instead of an opening beside cover.
- Primary pre-aim could be replaced by the nearest route waypoint or walking direction. Authored approach watches now remain the primary context; blocked watches select a visible opening within that sector. Separate occasional secondary checks still run.
- A common holding position could not qualify as useful until a player had already been seen. Useful common angles now qualify from static map geometry: clear firing line, nearby reachable shelter, sufficient range and appropriate health/context. Holding/patient role preferences increase modestly; aggressive role weights are unchanged. A brief gaze check no longer invalidates physical cover quality.
- Sound/shadow and shelter/lane evaluation mixed local eye heights with absolute native-map heights. Native reports and candidate eye positions now retain their correct world elevation.
- Precise contact memory expires as before. Duel separately retains the observed approach area for 6-10 seconds depending on skill, rather than immediately returning to the original spawn entrance. This is an old observed location/static map prior, not tracking or firing permission.
- Prefire previously held exact occluded contacts/sounds or returned to the original entrance. It now ranks LOS-valid static course openings near the current evidence and retains its choice through small noisy variations. Fresh sight gets a brief 0.75-second priority; reaction-ready rear/flank sound or trade reports can subsequently redirect the sector. Unobserved movement cannot do so.

## Budgets And Boundaries

- Duel primary approach checks: at most 12 alternative rays per refresh, normally 4 Hz; materially changed approach/observer position invalidates the cache.
- Native sight-loss hypotheses: up to three physical graph-root connections, 384 installed-graph nodes, 48 candidate visibility rays and 16 resulting hypotheses. Travel is measured along certified graph links, not straight through walls. Near-identical sight losses reuse geometry for 0.4 seconds. No native graph/support means conservative fallback, not invented navigation.
- Prefire opening selection: at most eight candidate rays every 0.2 seconds. Cached visibility can be 200 ms old; eventual firing still requires fresh perception/LOS, reaction, alignment, stance and weapon readiness.
- Geometry, player movement, recoil, spread, damage, bullet paths, animation playback and hearing propagation are unchanged. Native graph data is unchanged; it is reused as public map knowledge. Standing-only graph coverage can limit hypotheses around crouch-only passages.
- A covered hold is not unlimited camping: existing search, damage, trade, reload and reset decisions remain. The population test still requires all seeds to engage, at least ten of twelve to use multiple cover roles and at least four to use combat counterstrafes. Combat-variety opportunities are measured after six seconds of attack time, with variety required in at least two thirds of those sustained fights; one late spray is not incorrectly counted as a failed variation opportunity.

## Verification

- `npm run check`: 188 files / 3,773 tests passed, followed by successful TypeScript and production Vite build.
- New Duel regressions cover useful/common holds versus exposed camp labels, approach-facing while traveling elsewhere, native sound/shadow/report heights, general area memory without firing permission, valid opening selection, rear-point rejection and ray budgets.
- New native-memory fixtures cover native geometry absent from `solids`, elevated floors, actual graph travel, repeated sight-loss caching and missing support/graph fallback.
- Fourteen Prefire awareness regressions cover fresh-sight priority, occluded contact and sound, delayed supported rear cues versus identical silent hidden movement, translated/elevated and stacked-floor geometry, cache invalidation, bounded work and unchanged shot gates.
- Browser checks cover native Duel on desktop/phone, pointer-lock/map/replay lifecycle, appended changelog/layout, and responsive non-shooting Prefire defenders during a physically driven course approach.
- Offline imported-rig audit passed 6,144 standing/crouching/strafing frames across rifle and pistol assemblies, including head/hand/weapon aim compensation, grip, unchanged feet and authoritative hit-pose consistency.
- Local five-bot Mid/CT profile: 358 rendered frames over six seconds, 5.3 ms median / 7.9 ms P95 frame CPU. Native map transfer remains eight requests / 24,475,316 bytes. This uncontrolled machine sample is not an FPS guarantee, nor a controlled comparison against earlier samples. The earlier sample had lower frame CPU; no zero-cost-awareness claim is made.

Detailed local outputs are under ignored `research/angle-*`. No deployment is implied by this audit.
