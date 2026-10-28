# Dynamic Duel Rounds

October 20, 2026. Training heuristics, not a reproduction of CS2's closed AI or measured FACEIT populations.

## Rounds And Cover

- Eight exact-coordinate Dust 2 subsets now cover the ten admitted Prefire approaches: Long doors, Long-to-A, Catwalk, B tunnels, B retake, Mid/CT, lower tunnels, A retake, CT-to-Top-Mid and upper tunnels.
- The offline catalog contains 13 chunk/approach combinations, 89 covered-start variants and 160 distinct sourced/native-validated holding identities. These are available options, not simultaneous enemies; the actor budget remains five.
- Holds are drawn from the full compatible in-bounds Prefire inventory, not only a chunk's original five-bot lineup. Existing source IDs, physical-family exclusions and disclosed coverage/density policy remain intact. No encounter-probability claim is made.
- Starts hide the crown/shoulders/upper body of eligible defenders and stay at least five metres away. Source and sheltered spawn alternatives are checked; native integration verifies actual spawned silhouettes remain hidden.
- Reversible standing-hull movement certifies shelter-to-firing endpoints with the actual Duel navigation solver. Crouch-only pockets are not repurposed as standing Duel paths. A failed excursion stays static, rather than inventing a wall-crossing peek.
- Normal rounds favor active certified peek holds (85% active-pool preference where the roster can fit); static positions remain available. Nearby paired defenders are favored in 75% of eligible multi-bot trade-enabled setups. These are authored training policies, not match statistics.
- Up to 32 useful lanes are supplied independently of occupied spawn slots. All relevant supported paths are baked into the per-chunk graph. Round creation does no LOS authoring, excursion search or graph generation in the browser.

## Bot Policy

- Default `mixed` behavior now presents as **Defensive mix**. Its population favors holders/patient defenders, without forcing an aggressive player into every roster. Explicit behavior overrides are retained.
- Covered defenders recheck and return instead of indefinitely holding a firing endpoint. Static certified native positions do not invent a movement lane. Ordinary advanced-peek eligibility remains skill-dependent.
- Living recognized visual contact can release a partner's peek, before the first shot/death. Every skill level can follow up; novice partner delays vary more. Personal recognition, alignment, movement accuracy and current LOS remain necessary to fire.
- Partner staging uses authored endpoints, not an unchecked offset that can land inside a native wall. Death-trade chance increases modestly at low/mid levels; elite probability remains capped at 98%.
- Lower/mid motor/recognition/pre-aim settings are more forgiving. Level 10/10+ trait endpoints are unchanged. These are configurable approximations, not empirical FACEIT equivalence.

## Radar And Sound

- Native radar was blank because the renderer only considered procedural solids, which native chunks do not use. It now accepts native world-coordinate maps and spotted-only contact memory.
- Each Duel chunk loads a small hashed floor atlas baked from native terrain occupancy (160 pixels per floor). Selecting a floor is a bitmap blit, not a million-triangle scan. It is a readable training overview, not Valve's official radar art or exact pixel-resolution collision geometry.
- Scene-derived radar remains a cached fallback for other map providers; it never includes animated actors or marks possible holding slots as enemies.
- Footstep extraction now resolves the installed game's surface inheritance and CT overrides independently of bullet-penetration material families. Sand, tile, dirt, grates, wood variants and silent surfaces no longer collapse to generic concrete/metal/wood.
- Local import from game build **2000933** produced 94 step/landing banks and 213 actual WAV samples. Source hashes and fallback/right-foot exceptions are in `src/range/native-footsteps-data.json`; `node tools/import-audio.mjs --footsteps-only` reproduces the import.
- Rendering and AI use the native bank's event volume/distance curve and full acoustic path once. Uncommon banks load lazily with an on-time conservative fallback; they never queue a late footstep. Ally-noise filtering remains unchanged.
- Native wall occlusion is retained when the procedural acoustic scene has no boxes; its clear-path fallback no longer overwrites confirmed native obstruction. This uses the existing approximate attenuation/filter policy, not exact Source 2 acoustic portals.
- Footstep cadence, Source 2's complete HRTF/acoustic mixer, dynamic portals and exact live engine timing have not been measured or reproduced by this change. Landing-bank fallbacks are explicitly recorded.

## Asset Build Order

After the ordinary full-map native import:

```powershell
node tools/build-duel-map-chunks.mjs
node tools/build-duel-rounds.mjs
node tools/build-duel-navigation.mjs
node tools/optimize-duel-visuals.mjs --apply
node tools/build-duel-overviews.mjs
node tools/check-duel-map-chunks.mjs
npm run check
```

Run asset-writing stages serially; manifests are guarded against concurrent writes. Radar files are retained by subsequent visual optimization. Native assets remain local under the existing Git exclusions and are included in production builds.

## Verification

- `npm run check`: 191 test files / 3,880 tests passed, followed by successful TypeScript and production Vite build. Existing large-chunk build warnings remain.
- Independent full/subset audit passed all eight chunks: 1,273,439 exact collision triangles, 30,813 complete convex hulls, 3,909 shot rays, 1,976 sweeps and 1,482 support/hull checks.
- Offline graph installation/no-rebuild roundtrips passed for all eight chunks. Seeded roster tests cover variety, repeatability, incompatible-position exclusion, bounded lanes and zero round-time geometry authoring.
- Behavior regressions cover living-contact followups at all skill levels, recognition/no-blind-fire boundaries, physical return/repeek cycles, copied lane isolation and cached geometry budgets.
- Browser checks include nonblank radar pixels, baked-atlas use without runtime mesh scanning, first-visit entry, arrows, random rounds, replay/map retention, opponent-setting edits and phone layout.
- Fifteen desktop/phone workflow checks passed (three desktop-only lifecycle cases intentionally skip phone), plus two explicit radar pixel/atlas checks. Twenty offline importer/exporter/optimizer tests passed.
- Native combat fixtures fired in all eight chunks. Catwalk and Top Mid need a full covered peek cycle; extended 12-second fixtures also dealt damage there, rather than assuming every covered defender must shoot within three seconds of round start.
- Local five-bot browser sample: 359 frames over six seconds, 6.5 ms median / 10.7 ms P95 frame CPU, about 24.5 MB of map resources. Cold development ready time was about 10.2 seconds with competing validation work. This is not controlled old-PC or production-CDN validation, nor evidence that the broader AI is free of performance cost.
- Detailed local outputs: `research/duel-dynamic-*`, `research/duel-diversity-*`, `research/duel-round-pools-final.txt` and `research/duel-radar-browser.txt`.
