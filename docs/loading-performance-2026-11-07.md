# Initial Map Loading: November 7

## Measured Bottleneck

Initial loading used the same small frame-paced budgets as background preparation
during play. Off-thread Meshopt decoding still dispatched only four jobs per
turn. The measured maps submitted 1,995 (Dust 2 Mid), 3,521 (Mirage Mid), and
8,084 (whole Mirage Prefire) geometry jobs. Cached compressed bytes did not remove
these waits. GPU texture and retained-buffer preparation then used similarly small
background batches before the Enter button became available.

## Changes

- Foreground geometry dispatch yields after 128 jobs or 6 ms, instead of four
  jobs or 1 ms. Actual decoding stays in the disposable worker. Upcoming-round
  preparation retains the original small background budget.
- Worker-denied/error fallback decodes use a serial, time-budgeted queue rather
  than waking every queued decode in the same frame. Cancelled/disabled worker
  submissions skip their no-longer-needed checkpoints.
- Initial map GPU preparation uploads up to 16 MiB / 8 ms of textures per turn
  and up to 64 geometries / 8 ms per turn. Background preparation keeps its
  4 MiB / 2 ms and eight-geometry limits. A single large upload cannot itself be
  preempted; these are cooperative budgets, not hard frame-time guarantees.
- Retained shader compilation, texture uploads, zero-count geometry/VAO draws,
  GPU fences, lighting preparation and renderer-state restoration remain active.
  Faster entry does not defer those tasks into the first combat frames.

No assets, collision geometry, movement, aiming, grenade arithmetic, cache keys,
cache budgets or progression storage changed. Existing assets remain reusable
without a cache reset or forced redownload.

## Browser Measurements

Headless desktop Chromium, 1440 x 1000, Performance graphics, 60 FPS cap, muted,
three level-1 bots for Duel, same local development server. Each cold case uses
a fresh browser context; warm means reloading the page in that context after
asset-cache writes settle. Elapsed time is navigation to the enabled Enter
button, not only the map-loader promise. One before/after sample per case:

| Case | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Dust 2 Mid Duel, cold | 7.89 s | 4.51 s | 43% |
| Dust 2 Mid Duel, cached reload | 7.37 s | 4.42 s | 40% |
| Mirage Mid Duel, cold | 8.96 s | 3.98 s | 56% |
| Mirage Mid Duel, cached reload | 8.95 s | 4.75 s | 47% |
| Mirage A Ramp Prefire, cold | 10.32 s | 5.98 s | 42% |
| Mirage A Ramp Prefire, cached reload | 9.83 s | 7.19 s | 27% |

Raw local profiles: `research/loading-before.json` and
`research/loading-after-pacing.json` (ignored). Both implementations transferred
the same cold map resources: 36.11 MB, 25.93 MB and 45.83 MB respectively. Duel
cached reloads transferred zero map bytes. Mirage Prefire transferred 0.46 MB
of development metadata on reload, not its cached content-addressed payloads.

These are local samples, not production, broad-device or bandwidth-controlled
benchmarks. Cold web downloads still depend on network throughput. Browser
storage eviction, private browsing and disabled storage can require downloads.
Cached bytes still need decoding and GPU preparation after a full page reload;
localStorage is not used for map binaries. Existing background preparation can
retain a complete upcoming chunk within its bounded memory policy.

## Regression Checks

Unit checks distinguish foreground/background dispatch and GPU batching while
requiring identical decoded bytes, complete uploads and restored draw ranges.
Native-map browser tests exercise both upload budgets on desktop/mobile,
nonblank map pixels, untouched framebuffer pixels during warmup, disposal,
cancelled image decodes, next-round preparation and fresh-page cache reuse with
HTTP caching disabled. Mirage's source-pinned Beta proof is refreshed separately;
its existing gameplay and broad-device acceptance gaps remain open.

Validation: 6,994 tests in 307 files, 17 focused loading/changelog tests rerun
after final test-fixture type fixes, five map-admission tooling tests, 212 native
Mirage admission cases, and the production build passed. Sixteen applicable
browser cases passed across desktop/mobile; eight desktop-only duplicates were
intentionally skipped. The first browser pass exposed an old shader-test stub
using a plain object instead of a Three.js scene; the corrected loader tests
passed on both viewports.

Remaining work should be profiled separately: actor/model initialization,
individual large synchronous uploads, whole-map image decoding and cold-network
transfer time. Avoid replacing exact combat geometry with simplified colliders
or skipping warmup to hide the remaining loading cost.
