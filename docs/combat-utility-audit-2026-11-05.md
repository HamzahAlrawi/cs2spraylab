# Combat and utility audit: November 5, 2026

## Authority and reproduction

Offline static inspection only. No game process, hooks, DLL loading, or live memory
access was used. Unicorn fixtures execute isolated arithmetic blocks with explicit
inputs and stubs; they do not reproduce the entire engine.

Installed source: CS2 build **2000940**, SourceRevision **11198439**, dated
November 2, 2026 (1.41.9.5). SHA-256:

| File | SHA-256 |
| --- | --- |
| server.dll | `7e88b23196b0a746d99c7c622f947b96c25de61cc4d921d8dda79e515c4b48a8` |
| client.dll | `57ee728e15c50881070d847d7516d632d70456e0648d486a53f2528ec53f6ee0` |
| steam.inf | `221437bd0d9d4768e5cdeef8f4cb4af9e6ba4596a3ce644b4add7ee4b2098dfc` |

The three `verify-*.py` tools changed in this iteration pin the current module
hash and code locations. Generated numeric fixtures retain those locations.
Native assets and scratch disassembly remain ignored, not distributed in Git.

## Grenade release and contact

`verify-native-grenades.py` checks client launch block `0x7c81d0..0x7c85da`,
AngleVectors at `0x17449f0`, and the source sweep boundary at `0x7c832d`.
Fifteen launch fixtures include short and medium strength throws with elevated
eyes, rising/falling inherited velocity, and obstructed source sweeps.

The current native arithmetic retains the pitch adjustment, 0.9 throw-velocity
scale, strength * 0.7 + 0.3, strength-dependent eye offset, 16-unit sweep with
2.02-unit half extents, and 1.25 inherited velocity. No arbitrary launch tuning
was added. The trainer now samples eye, view and velocity at the fractional
release deadline instead of taking the end-of-physics-step crouch/jump state.
The first projectile step consumes only the remainder of that step.

`verify-native-grenade-flight.py` checks clipping at `0xe95170..0xe951f9` and
records the current contact handler `0x9d4650..0x9d581f` (projectile vtable slot
163). Seven clip and six conditional-think examples pass. Native clipping adds
0.03125 normal bias, then applies elasticity; the active handler clamps the
projectile field at +0x3f8 to [0, 0.9]. Support, high-speed and resting branches
were inspected. Existing trainer clipping arithmetic did not need retuning.

Limits: the complete moving-support, secondary-contact, breakable, base-velocity
and contact-count state machine is not established by these fixtures. The
native subtick launch-state capture/cache was inspected but not fully recreated.
No matching in-game crouch-jump trajectory capture was available. This is a
specific release integration correction, not a claim of complete grenade parity.

## Aim punch correction

`verify-aim-punch.py` checks 64 hitgroup cases and 49 recovery samples against
the current server module. Relevant blocks: hitgroup dispatch `0xa8f6a0`, table
`0xa8fcd0`, hit-punch accumulation `0xa454b0`, recovery
`0xa45c1d..0xa45c73`, and view punch lookup `0xa44d30`.

Damage/unpredictable punch uses service fields +0xa0/+0xa4; predictive recoil
uses separate +0x48/+0x50/+0x5c fields. The trainer incorrectly recovered the
combined vectors and subtracted independently recovered recoil. That could
create sideways flinch during a spray. Damage punch now recovers independently.
This supersedes the shared-cache interpretation in older aim-punch notes.
Existing hitgroup mapping and physical shot composition remain unchanged.
The fixture injects scale 3 explicitly; it does not establish every live convar
default or exact camera/quaternion composition.

## Weapons and audio

Fresh weapon export SHA-256:
`cc04aa26fd8d4a34119df7c4b7f4f29c7ebe0c7862ce78e0a2a753642502ba0a`.
`verify-weapon-data.mjs --compare-build` found no mismatches across 35 weapons,
including alternate modes, damage, accuracy, recoil fields, movement limits,
reload timing and pellet counts. P2000/hkp2000 is one projectile, 35 damage,
13 rounds and 0.17-second cycle; only the four shotguns have multiple pellets.
An actual firing regression now covers every selectable weapon.

The reported P2000 pellet bug was not reproduced in the ballistic simulation.
Presentation did replay old catch-up shots at the current muzzle; expired
tracers/flashes are now skipped and fresh effects retain event age. Physical
hits and damage remain immediate and unchanged.

Fresh utility vdata, CFG and explosion-type extraction matches the previous
values. Evidence metadata now identifies build 2000940. Unknown effective
defaults remain unknown. Native utility audio was reimported locally (75 events,
118 WAVs) and preloaded before play. Native samples alone do not establish exact
CS2 mixing, cadence or propagation.

## AI and training coverage

- Motion estimates compare corresponding confirmed visible probes, never a new
  head/torso point against an unrelated old point. Identity generations reset
  those estimates.
- Recognition accumulates confirmed angular exposure; it is an authored policy,
  not measured FACEIT reaction data and not inferred from the number of probes.
- Heard evidence narrows prefire opening selection. No hidden actor position is
  supplied to gaze or utility planning.
- Combat movement refreshes at action boundaries after a substantial range
  change, not every frame. Continuous-contact tests cover four weapons, four
  seeds each at maximum skill; complex native corner cases remain a separate
  validation concern.
- Utility targets use a bounded walkable-floor query near reported evidence,
  rejecting unknown lower floors. Smoke can cover a planned short crossing;
  bots wait for their actual smoke effect to bloom before using that plan.
- Short-stairs and B-window/car focused lineups use already validated holds.
  Weighted coverage groups ensure training variety without labeling those
  coverage choices measured encounter probabilities. All ten native placement
  pools were re-audited; accepted counts are unchanged. Invalid exact-source
  positions were not nudged into apparently valid locations.
- Player health supports up to 10,000; default stays 100 and reward scaling still
  reduces rewards for increased health.

## Smoke performance

Resting smoke projectiles prepare the unchanged cell flood-fill incrementally:
16 ray queries per projectile per physics step, with a shared limit of 64.
Membership/order matches the synchronous algorithm. This does not move the fuse
or create smoke early. Late-settling or invalidated preparation can still finish
remaining work at detonation; this is not a guarantee of zero stalls.

Before play, the renderer initializes the density/noise textures, HDR target,
depth/blit materials and matching world shader variants. Browser regression
checks that preparation preserves the frame and the first smoke draw does not
compile additional shader programs. No extra world pass is added without smoke.

## Validation

- `npm run check`: 290 test files / 6,733 tests passed, followed by TypeScript
  and the production build. The existing large-bundle warning remains.
- Fifteen selected desktop Chromium checks passed, including corrected reruns
  for asynchronous restart/readiness. Three mobile Chromium checks passed.
  These cover camera/physical-ray alignment, aspect ratios, utility models,
  tracers, smoke pixels/shader readiness, and post-death projectile motion.
- Strict native map certificate validation passed, including 72 independently
  audited material cases. Source-only asset policy and staged whitespace checks
  passed. Native arithmetic fixtures described above also passed.
- An isolated live Dust 2 Mid/CT first-smoke run (one bot, Performance preset,
  120 FPS cap, no CPU throttling, development server) measured at most 6.8 ms
  frame CPU work around bloom, 4.1 ms steady-state CPU p95, and a maximum
  25.9 ms frame gap around bloom. No page errors occurred. This is one local
  scenario, not a before/after comparison or a guarantee for other hardware,
  quality presets, simultaneous effects, or late-settling smokes.

No deployment is requested for this iteration.
