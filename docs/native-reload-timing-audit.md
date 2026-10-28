# Native Reload Timing Audit

2026-10-19. Static files only: no game process, memory, hooks, input automation,
DLL execution, deployment, or weapon-list changes.

## Evidence

Installed game: `C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive`.
`game/csgo/steam.inf` reports **2000933**, SourceRevision **11133601**.
The existing assemblies generally report build **2000922**. Older timing notes
and audio definitions also mention **2000924**; these are not the installed build.

Fresh exports are in `research/reload-timing-audit/`:

- `weapons.vdata`: `scripts/weapons.vdata_c` from `game/csgo/pak01_dir.vpk`.
- `compiled/animation/anims/viewmodel/`: original compiled reload resources.
- `definitions/animation/anims/viewmodel/`: authored frame/event definitions.
- `graphs/animation/graphs/viewmodel/`: fresh graph references and clip rates.
- `source.json`: cached build/archive signature, checked before reuse.

`src/range/native-reload-timing.json` is the checked-in, reproducible numeric
evidence for 34 firearms. It includes individual compiled SHA256s, graph hashes,
source frame rates, authored events, normalized compiled markers, exported clip
durations/builds, and the attack-lock values. Local tools are in
`.local-tools/vrf/Source2Viewer-CLI.exe`; existing snapshots include
`research/reload_ak.vnmclip`, `research/weapon-actions/ak47.json`, and
`docs/weapon-animation-inventory.json`.

Decompiled vdata SHA256:
`46e7a84b46c620e8daf11c403ee9152a5faa1a033407748b527862aa3147236b`.
Archive-directory SHA256:
`f0943b4d5a86fe8f4891ab98983b9d132b4450b9b7401a03a530bcd63f293f99`.

## Three Clocks

The old controller committed magazine ammo only at attack-lock completion.
This lost already-inserted ammo on holster. The old first-person player also
mapped the entire clip to the attack lock. Neither mapping follows the native
`WPN_RELOAD_ADD_AMMO` event. A Clipin/AddAmmo **sound** is not used as evidence
for gameplay commitment; the explicit ID event is used.

Times below are normal-speed authored seconds, not live-engine measurements.
The gate comes from `m_flDisallowAttackAfterReloadStartDuration`.

| Weapon | Tactical Ammo | Empty Ammo | Attack Gate | Clip End |
| --- | ---: | ---: | ---: | ---: |
| AK-47 | 1.100000 | same | 2.466667 | 2.433333 |
| M4A4 / M4A1-S | 1.366667 | same | 3.066667 | 3.066667 |
| Galil | 1.166667 | same | 3.033333 | 3.033333 |
| FAMAS | 1.666667 | same | 3.300000 | 3.300000 |
| SG 553 | 1.033333 | same | 2.766667 | 2.766667 |
| USP-S | 0.900000 | 1.000000 | 2.200000 | 2.166667 |
| Glock | 0.933333 | 1.266667 | 2.266667 | 2.266667 |
| P2000 / P250 | 0.933333 | 1.200000 | 2.266667 | 2.266667 |
| Deagle | 0.766667 | 1.033333 | 2.200000 | 2.200000 |
| Five-SeveN | 0.966667 | 1.200000 | 2.266667 | 2.266667 |
| CZ75 | 1.566667 | 1.666667 | 2.733333 | 2.733333 |
| SCAR-20 | 1.533333 | 1.466667 | 3.066667 | 3.066667 |
| M249 | 3.733333 | same | 5.700000 | 5.700000 |

AK path: `animation/anims/viewmodel/rifle/rifle_ak/reload_ak.vnmclip_c`.
The compiled marker is normalized 0.452055; 74 frames cover 73 intervals at
30 Hz, so this is authored frame **33**, or **1.10 s**, not 45.2% of the attack
gate. Both native graph branches (`partial_mag_reload`, `empty_mag_reload`)
reference this same clip at speed 1. Pistol branches reference distinct empty
clips where present. They can have different insert markers but equal total
durations; no universal extra empty-reload delay is invented.

M249 is **60 Hz** (343 frames over 5.7 s): its marker is frame 224 / 60,
not frame 224 / 30. The extractor derives and checks source sample rate before
converting events. Negev's optional empty clip is not referenced by the graph
or exported assembly; gameplay correctly reuses the referenced ordinary clip.

## Implemented Contract

- `NativeReloadState` commits a magazine once at its selected native marker,
  subtracts only available reserves, and stays active until the attack gate.
- `empty` is latched at start, so refill cannot switch the empty animation to
  a tactical animation halfway through playback.
- Cancel before commit preserves the old ammo/reserve. Cancel after commit
  preserves the inserted ammo/reserve; later updates cannot insert again.
- `ammoCommitAt` is the prospective, rate-aware commit deadline (zero once
  committed). `ammoCommitted` reports that milestone for the current reload.
- `until` remains the active phase deadline and becomes zero on cancel.
  `fireReadyAt` additionally retains a committed magazine's attack deadline
  across cancellation. It is a floor, not a replacement for draw/cycle gates.
- `reload-end` still means attack-gate completion, not ammo commitment. Existing
  event kinds stay compatible. Long updates timestamp phase events at the
  crossed boundary instead of at the end of the whole update.
- Identified magazine clips sample `progress * phaseDuration` source seconds,
  clamp at the asset endpoint, and retain the existing tail blend. They are
  not stretched across a longer lock. Shells retain per-phase windows; legacy
  callers without phase metadata retain their existing normalized mapping.

## Shared Caller Patch

Applied in `simulation.ts` (shot scheduling, direct fire guarding and predicted
recoil scheduling) and `duel/weapon-state.ts` (fire permission maximum).
Both range and combat now respect `reload.fireReadyAt`. The render engines
already pass phase duration, progress, latched empty flag, equipment and ammo.
Integration tests exercise tactical/empty AK reloads, early and late knife/back,
precommit cancellation, and independent sidearm/knife readiness.

Only compact `native-reload-runtime.json` is imported by gameplay. Full source
hashes and event evidence stay in `native-reload-timing.json` for offline audits
and tests, avoiding a large proof payload in the browser bundle.

For AK normal reload started at T, waiting gives readiness T+2.466667.
Knife/back at T+1.10 commits ammo, and the return draw's 1.0 s alone would give
T+2.10. The callers require `max(reload.fireReadyAt, drawReadyAt, shotCycleAt)`,
so the early switch cannot shorten the original floor. A later return can be
slower because of deploy. This retained floor is the requested conservative
trainer policy; the static resources alone do not prove live CS2 quick-switch
timer reset semantics or exact tick/subtick rounding.

## Boundaries

- AUG's installed reload changed to 3.2 s / commit 1.4 s; the old asset is
  3.766667 s with an older marker at 1.566667 s. The controller uses current
  reload evidence but no asset has been rebuilt. The old AUG asset therefore
  still cannot claim current-build visual parity. AUG remains unselectable.
- Single-shell engine transitions are not resolved by this audit. Authored
  Nova intro/loop/outro windows are 0.366667/0.433333/0.833333 s, XM1014
  0.7/0.6/0.433333 s, and Sawed-Off 0.4/0.533333/0.8 s. Ammo markers fall
  *inside* the loops (respectively 0.3/0.333333/0.266667 s after loop start).
  Existing simulation start 0.5 s / finish 0.2 s and loop-end insertion remain
  explicit estimates. Replacing these with clip lengths would invent engine
  fire-readiness semantics, so shotgun gameplay is deliberately unchanged.
- Hold-R multiplier 2 and whole-phase rate integration remain trainer estimates.
  Native `WPN_RELOAD_SILENT` ranges are recorded, not proof of an exact slowdown
  coefficient or of engine rate application beyond that range.
- Shared sound scheduling still retimes foley to its requested duration; this
  patch changes first-person pose/ammo timing, not the shared sound controller.
  No audio/native material/graph-transition parity is claimed.
  In addition, `tools/import-audio.mjs:132` calls `extractSoundTimeline` without
  its FPS argument, defaulting to 30 even for M249's 60 Hz reload. A future
  audio import must supply the compiled source rate (60 for this resource),
  not infer it from the 30 Hz baked GLB sample count.

## Reproduce

```powershell
node tools/audit-native-reload.mjs --refresh --write
node tools/audit-native-reload.mjs
node tools/verify-reload.mjs ak47 m4a4 m4a1s galil famas sg553 glock usp m249
$env:TEMP = Join-Path $PWD '.local-tools/test-tmp'; $env:TMP = $env:TEMP
npm test -- --run src/range/native-reload.test.ts src/range/native-view-actions.test.ts src/range/view-animation.test.ts src/range/range-weapon-actions.test.ts src/range/weapon-actions.test.ts src/range/equipment.test.ts
npm test -- --run
npm run build
npm run check
```

The workspace-local temporary directory avoids sandbox EPERM rename failures
from Vite's default OS temp location. This is a command-local environment
override, not a project configuration change.

## Verification Results

- Focused six-file command above: **126 tests passed**.
- Fresh-source extraction plus independent cached comparison: **34 weapons
  verified** against installed build 2000933.
- Nine native GLB assemblies listed above: grip and reload motion checks passed.
- Shared caller integration is applied; final validation is recorded in the
  combined coverage/control/reload audit.
- `npm run build`: **passed**, including TypeScript and Vite (2,051 modules).
  Existing large-chunk warnings remain.
- Combined final `npm run check`: **179 files / 3,677 tests passed**, followed
  by TypeScript and the production build. Earlier integration failures from
  stale route proofs and changed Prefire fixtures are superseded by this run.
- Production smoke: **18 checks**, covering nine modes at desktop and phone
  sizes, without browser or missing-asset errors.
