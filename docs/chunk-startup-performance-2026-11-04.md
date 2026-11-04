# Chunk Startup Performance Audit

Date: 2026-11-04. Source baseline: `01c1376`.

## Reproduced Causes

Local Chromium on i7-13700K / RTX 4080, desktop 1440x1000, auto quality,
five bots, volume zero. The user confirmed no competing heavy application.
Measurements are development-browser samples, not old-CPU or universal guarantees.

The original profiler discarded the first 1.5 seconds. It now supports immediate
entry (`SETTLE_MS=0`), prepared destination activation (`HANDOFF_CHUNK`), explicit
background preparation (`PRELOAD_CHUNK`), per-frame simulation-step counts and
CPU parts, resource timings, optional CPU profiles and browser timeline traces.

The baseline trace attributed these main-thread tasks:

- About 96 ms: collision validation, Rapier snapshot restoration, synchronous
  solid-tree rebuilding, and beginning a local snapshot-cache write in one turn.
- About 39 ms: Meshopt decoding. The library's default asynchronous function
  schedules synchronous WASM work; it does not automatically create a worker.
- About 54-60 ms: streaming gzip unpacking and its read continuations.
- A separate runtime route query reached about 50 ms. It checked all twelve
  nearest endpoint candidates even though only the first four valid ones are used.

These were CPU traces, not evidence of a GPU shader problem. The Meshopt behavior
was also checked against the installed Three.js 0.170.0 decoder/GLTFLoader source
and the [upstream decoder API documentation](https://github.com/zeux/meshoptimizer/blob/master/js/README.md#decoder).

## Implemented

- `map-decoder.ts` and its module worker decode compressed sectors off-thread.
  One worker belongs to one map load and closes after parsing. Submission copies
  are paced at four buffers / 1 ms checkpoints rather than one unbounded burst.
  Cancellation, worker denial/failure/timeout, and malformed data have explicit paths.
- `asset-decode.ts` serializes large unpacking and decoded-content SHA checks on
  one worker, transferring results. It retains compressed cached originals,
  terminates idle/cancelled workers, and rejects corrupted bytes rather than
  silently substituting resources. Small resources use the original decoder.
- Prepared collision validation, ownership/column restoration and stable tree
  construction yield at a 2 ms cooperative budget. The tree's ordering, splitting
  and query results match the previous builder, including stable-sort ties.
- Rapier `restoreSnapshot` gets a separate preparation turn. Local cache cloning
  and writing start in a later idle turn, not the restoration callback.
- Opening bot navigation queries warm before entry/handoff, one actor per frame.
  This does not advance time, consume RNG, observe enemies or mutate combat state.
- Native path endpoints retain at most 128 connection results per installed graph.
  Searching stops after the same first four reachable links the old code returned.
  Replacing the graph replaces its connection cache.

Content-addressed downloads, local cache keys, physical map geometry, collision
masks, recoil, movement constants, damage and shot coordinates are unchanged.
No extracted assets are added to Git.

## Verification Results

Raw captures are ignored under `research/`, not committed native media:

- `preload-trace-baseline`: attributed original 54 / 96 / 50 ms tasks.
- `preload-final-10s`: next Catwalk chunk reached GPU readiness during live play;
  no >50 ms main-thread tasks during the ten-second active sample; no page errors.
- `chunk-handoffs-nov4`: continuous Catwalk and B-entry transitions took 187.9 ms
  and 138.6 ms from restart request to first ready frame. Their first-three-second
  maximum rendered CPU costs were 13.5 ms and 21.5 ms. No page errors.

Those are observed cases, not a statistical before/after FPS claim: the existing
engine chooses a random round seed, and transient CPU/driver costs vary. Profiling
was performed before the broad regression suite so those jobs did not compete.

Native browser tests also verify:

- GPU preparation preserves pixels, draw ranges and renderer state; retained
  geometry renders nonblank afterward.
- One geometry worker per load, closed when preparation finishes.
- Prepared scene identity reuse, cancellation cleanup and bounded map ownership.
- All eight previously visited chunks reload in a fresh page with HTTP caching
  disabled and all native map requests blocked: **zero map network requests**.

Unit fixtures verify prepared/unprepared collision query equality, tree ordering,
cooperative cancellation/disposal, content corruption rejection, worker failure
fallbacks, and identical seeded combat snapshots/events after navigation warmup.
Final `npm run check`: **287 files / 6,679 tests passed**, plus TypeScript and the
production build. Native/integration browser suites passed 21 applicable cases;
the production bundle passed all 18 desktop/mobile drill smoke checks. Source-only
asset policy and whitespace checks passed. Vite still reports existing large-bundle
warnings; a passing build is not evidence that bundle-size work is complete.

The first full check caught the stale source dependency fingerprint in the native
Prefire pool certificate. A complete strict rerun of
`node tools/build-prefire-pools.mjs --map=de_dust2 --save` revalidated all ten pools.
The generated diff changes only `native-collision.ts`'s dependency hash: accepted
positions, approaches, gates and selection weights remain unchanged.

A supplemental Guided Spray test exposed an unrelated development-server hazard:
the offline pool tool and running Vite server shared an optimizer cache, causing a
stale RoomEnvironment import to return HTTP 504 and surface as a misleading WebGL
startup message. `build-prefire-pools.mjs` now owns `.vite-prefire-authoring`, separate
from the live dev cache. Restarting the verified dev server and rerunning Guided
Spray/Duel switching while an isolated audit ran passed. No production range/aim
logic was changed to work around that tooling failure.

## Remaining Limits And Next Work

- A deliberately exposed first-entry five-bot stress capture still had a roughly
  37 ms first nonzero-dt combat frame. Literal dt-zero entry and subsequent combat
  work are separately recorded; this iteration does not promise no startup miss.
- Rapier snapshot restoration remains indivisible, around 26 ms in the traced
  chunk. Moving it to a timer alone cannot make it fit a 16.7 ms frame. A fully
  off-thread simulation/query world or different snapshot layout needs separate
  architecture work; don't approximate collision to hide the cost.
- Three.js scene construction, first pose/gesture binding, native route smoothing,
  texture uploads and shadow baking can still exceed an individual frame budget.
  The next useful step is a shared preparation/AI-planning admission budget with
  explicit cold-pose instrumentation, not weakening physics or hiding the FPS meter.
- Worker-denied browsers retain correct functionality but lose worker performance.
  Persistent caching still depends on browser quota/permissions; it cannot retain
  GPU objects across browser restarts. First-ever downloads and cold reconstruction
  still take time. No claim that every future map is instantly resident.
- The full AI follow-up plan is in `ai-repository-comparison-2026-11-04.md`.

Example local capture (PowerShell):

```powershell
$env:SETTLE_MS='0'
$env:SAMPLE_MS='10000'
$env:PRELOAD_CHUNK='dust2-a-short'
$env:REPORT='research/chunk-startup'
node tools/profile-real-map-duel.mjs
```

For a destination handoff, use `HANDOFF_CHUNK` instead of `PRELOAD_CHUNK`.
For attribution add `JS_PROFILE=1` and `TRACE_TIMELINE=1`. Trace/profiler overhead
must be reported separately from uninstrumented play.
