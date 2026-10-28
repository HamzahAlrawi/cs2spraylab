# Dust 2 surroundings and round-start work

## Scope

This update changes distant presentation and round preparation, not combat
geometry, hitboxes, movement, sensitivity, recoil or impact coordinates.

## Distant surroundings

The previous position-only LOD discarded texture seams and sampled diffuse
images into sparse vertex colors. Walls outside the active chunk consequently
looked flat, patchy and broken. The new authoring path preserves UV seams,
uses attribute-aware simplification with a tighter visual-only error bound,
and packs native diffuse images into a padded, repeat-aware atlas.

| Resource | Previous | Current |
| --- | ---: | ---: |
| Context triangles | 65,877 | 142,668 |
| Context draw calls | 1 | 1 |
| Materials | 1 | 1 |
| Textures | 0 | 1 (2048 x 2048) |
| Compressed delivery | about 0.71 MB | 2.85 MB |

The larger download is shared across chunks and uses the existing verified,
quota-aware persistent asset cache. It is not redownloaded for every round.
Each active/retained/prepared map owns separate clipping materials; geometry
and image data are shared. The original full-resolution playable chunk stays
inside its padded render bounds. Context never contributes collision, shot
raycasts, radar geometry or shadows. It remains an intentionally simplified
backdrop, not complete playable Dust 2 geometry.

`tools/build-duel-context.mjs` rebuilds the context asset and manifest. The
modern meshoptimizer simplifier is an authoring-only package alias; runtime
mesh decoding remains unchanged. Build budgets enforce <= 3 MB compressed
delivery and <= 5 MB decoded GLB.

## Round preparation

Measured causes and corrections:

- AudioContext construction and graph setup ran on Enter. Silent allocation
  now happens before the ready screen; only a trusted gesture resumes audio.
- A temporary route was physically walked and immediately replaced by the
  chosen baked course. Constructors and chunk attachment now use an empty
  placeholder; only the actual round guide is built.
- Each actor cloned, filtered and converted the same animation clips again.
  Processed immutable clip data is cached by source, actual binding names,
  conversion mode and additive reference clip. Actions, mixers, poses and
  death physics remain actor-local.
- Actor rebuilding was one synchronous task. Round transitions now build one
  actor per animation frame while retaining the previous framebuffer. The
  simulation does not advance or render partial lineups during preparation.
- Shader compilation preceded the actual new actors and guide. Preparation
  now waits for bot weapon models, compiles the final retained scene, then
  issues a zero-area-scissor first-use render with the real lighting. Initial
  entry also warms the retained first-person model.
- Entry/resume resets frame timing instead of catching up the ready screen's
  lower frame rate. Escape and setup edits during preparation are preserved.

## Measurements

Local Chromium development server, 1440 x 1000, auto quality, five bots,
i7-13700K / RTX 4080, no CPU throttling. Other host activity is uncontrolled;
these are diagnostics, not a universal latency or FPS guarantee. CPU render
submission is not GPU elapsed time.

Before: Enter spent about 44.7 ms synchronously, including 43.6 ms allocating
audio. Actor rebuilding took about 36-39 ms in one task. Initial temporary
guide construction could add 40-53 ms; a previously cached guide was cheaper.
First-use shader work remained after combat resumed.

After staged preparation, repeated local profiles measured Enter around
1-2 ms synchronously; prepared chunk handoffs resumed in roughly 100-150 ms,
with first combat ticks around 4-7 ms and no shader links after those chunk
resumes. This interval includes preparation and is not a single blocked frame.
Later combat frames and background decoding can still spike; zero stutter on
all devices is not claimed.

The final `research/round-start-work-final.json` run, including the same-map
weapon-readiness fix, recorded:

| Transition | Resume delay | First combat tick | Shader links after resume |
| --- | ---: | ---: | ---: |
| Enter | 22.5 ms including click dispatch | 5.5 ms | 0 |
| Same chunk | 121.9 ms | 3.3 ms | 0 |
| Prepared Catwalk | 134.9 ms | 4.4 ms | 0 |
| Prepared B entry | 95.9 ms | 3.5 ms | 0 |

Enter's synchronous handler took 1.6 ms. None of the four bounded final captures
reported a >50 ms long task, although earlier runs did have isolated later
combat spikes. Preparing an uncached chunk still takes longer than activating
a fully prepared one; slow storage, constrained devices and an immediate
manual map change can exceed these handoff timings.

## Reproduction and tests

- `node tools/audit-map-context.mjs`: old/new images at Mid/CT, Catwalk and B
  doors; missing-resource and browser error checks; reports under
  `research/context-atlas-audit/`.
- `$env:REPORT='research/round-start-work-final'; node tools/audit-round-start-work.mjs`:
  bounded CPU profiles, Enter/restart/handoff timing and post-resume shader
  activity. Browser and GPU settings are included in the report.
- `src/range/duel/map-context.test.ts`: delivery hashes/budgets, shared resource
  lifetime, world-space clipping, atlas UVs/wrapping/material factors.
- `src/range/duel/animation.test.ts`: clip identity, binding/base isolation and
  actor-local mutable state.
- `src/range/audio.test.ts`: silent preparation does not resume or fetch.
- `src/range/shader-warmup.test.ts`: zero-scissor warm-up restores renderer and
  object state, including failures.
- `tests/real-map-duel.spec.ts`: staged actors, warm-before-start, no simulation
  advance while loading, pause, queued settings, capture/review and map reuse.
- `tests/next-map-preloading.spec.ts`: no temporary guide walk, bounded retained
  maps and disk-cache reuse with HTTP caching disabled.

Visual comparisons and timings remain local ignored research artifacts. The
site changelog is appended, not replaced. No deployment is part of this task.

Final validation: `npm run check` passed (217 files / 4,108 tests and production
build). The final focused run, including the added atlas fixture, passed all
86 tests. A fresh final build passed. Desktop/mobile browser validation passed
22 tests, with eight explicitly desktop-only scenarios skipped on mobile.
Old/new exterior rendering reported no browser or missing-resource errors.
The build retains existing large-bundle warnings; this update does not claim
to solve every initial application-download or steady-state performance cost.
