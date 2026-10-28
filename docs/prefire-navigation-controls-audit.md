# Prefire Navigation, Input And Contacts

October 16, 2026. Browser trainer only. No live-game hooks or input automation.

## Changes

- Four additional exact-source holds: CT Mid close wall/recess (`mid_to_b/20,21`)
  and Upper-tunnel exit right/deep-left (`b_tunnel/1,5`). Coverage regression tests
  resolve route-facing physical head hits and verify supported, stationary actors.
  Other proposed angles remain gated by covered starts, reachable sight and hulls.
- Ordered waypoint directions, independent of coaching-tip visibility, and batched
  floor chevrons. Neither uses bot positions. No nearest-segment shortcut through
  another floor. Two separate persisted toggles; new navigation hints default on.
- Lower-viewport hit captions/coaching, with compact short-viewport presentation.
- Persistent physical-key bindings and conflict validation. Escape is reserved;
  C remains a browser-safe crouch alias. Browser-reserved Ctrl+W cannot be promised
  to work reliably; use the alias or rebind crouch.
- Immediate inspect interrupts draw/pickup presentation. Requests during model
  loading are honored when that model is ready, not after the deploy timer.
  Reload/firing guards and gameplay deploy readiness remain independent.

## Xbox Root Cause

The native vertical support query selected the highest upward-facing triangle,
including near-vertical beveled box faces. At a floor/box seam that face could
mask a valid floor by a fraction of a Source unit. Horizontal sliding then created
a small upward velocity, an airborne flag and a new landing every few ticks.

Vertical support now requires the existing walkable normal threshold (0.7).
Unwalkable surfaces still block the continuous hull sweep; this does not make
walls passable or mute genuine landings. The same 120 valid starts / four cardinal
directions / 512 ticks reproduced 24 repeated-landing cases before the fix and
zero afterward. 89 blocked/unsupported grid starts were excluded explicitly.
Run `node tools/audit-dust2-landing.mjs --assert` to reproduce. The native regression
suite separately retains jumps, crouch jumps, steep collision and braking tests.

## Sensitivity

Hip-fire yaw/pitch remain 0.022 degrees per count times sensitivity. DPI describes
hardware counts per distance; multiplying it into deltas would apply it twice.
Both engines now apply the same explicit zoom ratio and count calibration once.
No guessed devicePixelRatio, frame-time, aspect-ratio or display-scale multiplier
was introduced. Promise/event-based pointer-lock tests distinguish accepted raw
requests from standard/drag fallbacks and do not silently claim hardware parity.
Physical cm/360 must still be checked on the user's browser/OS/mouse combination.
Installed user convars independently show `m_yaw`/`m_pitch` = `0.022` and
`zoom_sensitivity_ratio` = `1`. Valve's published
[Source input arithmetic](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/in_mouse.cpp)
is a primary reference for the count-times-sensitivity-times-yaw/pitch contract,
not proof of the entire current CS2 input pipeline. Fresh defaults are 0.5 / 1600
(800 eDPI); saved sensitivity and DPI are not overwritten.

## Encounter Evidence

[OpenPrefirePrac](https://github.com/lengran/OpenPrefirePrac) provides authored
practice coordinates, not measured occupancy probabilities. Its Dust 2 update
and source identities are recorded in `prefire-angle-sources.md`. Existing
regional telemetry is 32 pro matches / 256 sampled rounds, with 50% physical-family
coverage and 50% match-balanced nearby support. This is not an arrival-conditioned
probability of meeting a defender at a specific pocket.

Further primary leads include [PureSkill's CS2 data](https://docs.pureskill.gg/),
which documents per-tick positions and view angles, and
[CSKnow](https://github.com/David-Durst/csknow), whose measured Dust 2 movement data
is from CS:GO, not the installed CS2 map. Dataset rights, build identity, stance,
round phase and route arrival still need validation before replacing runtime
weights. `prefire-evidence-followup.md` records that review and rejected shortcuts.
No exact encounter percentages have been invented or silently substituted.
PureSkill specifically requires subscription approval, CC BY-NC-SA terms and a
separate subscriber agreement. Its data is not silently redistributed here.

The installed `game/csgo/replays` folder was also inspected **offline**, using
the pinned `demoparser2==0.42.0` binary wheel in ignored local tools. Seven `.dem`
headers report Italy/2000701, Anubis/2000717, Dust 2/2000744, Office/2000776,
Inferno/2000878, Office/2000908 and Anubis/2000918. Build numbers here are hints
from `game_directory`, not verified geometry fingerprints. The sole Dust 2 demo
is one older match, not a representative current-map corpus. None was uploaded,
copied into public assets or used to alter live weights; player names/IDs were
not included in this inventory. This local-data lead does not clear the existing
build/rights/pocket/conservation/held-out validation gates.

## Trades

Nearby viable responders use their own recent report or the victim's recognized
callout. If neither exists, an acoustically audible death can prompt a delayed,
spatially uncertain area check. It never supplies the killer's current position.
At most two responders, finite reaction and expiry, cover/path checks, weapon
readiness and configured trade/return-fire toggles still apply. Committed trades
are not interrupted by optional reloads or unrelated sound investigations. These
are training behavior policies, not measured FACEIT trade-rate statistics.

## Verification

- Full unit suite: 3,439 tests across 169 files and the production build passed. The two large
  arena seed-batch tests retain all cases/assertions, with explicit 30-second
  timeouts instead of the unrelated default five-second limit.
- Native material audit: 72 cases, 8,268 validated closed solids, 1,837 opaque
  primitives. Full pool and map-quality reports were regenerated from current
  inputs; coverage admission passed, contextual evidence remains authored-only.
- Browser workflows cover desktop/mobile controls and persistence, ordered route
  hints, physical shooting/preset progression, viewport-relative feedback,
  immediate native inspections and touch HUD focus. Aim/recoil-follow alignment
  retains its aspect-ratio and fractional-frame regression checks.
- Final navigation/control/inspection matrix: 11 passed, one desktop-only native
  inspection case skipped on mobile, across Chromium, mobile Chromium, Brave and
  Opera GX. Built-bundle smoke: nine modes at two viewport sizes, 18 checks with
  no runtime/asset errors and nonblank rendered canvases. The existing large-chunk
  build warning remains; these checks do not claim a measured FPS improvement.
