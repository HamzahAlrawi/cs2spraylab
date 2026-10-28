# AI Policies And Utilities Delivery

Date: October 26, 2026. Local implementation only; not deployed.

## AI Changes

- `aim-intent.ts` arbitrates named, expiring gaze evidence. Current combat wins
  over travel/scanning; eligible trades and re-peek memory retain explicit
  priorities. `firingVeto` exposes the actual reason a bot cannot fire.
- `TacticalBrain` receives the shared weapon/equip readiness deadline. Reaction,
  settling, movement accuracy, ammo and cooldown gates remain authoritative.
- `botSensorView` uses a fixed human-screen aspect and actual scoped FOV, not
  the visitor's viewport or unlimited vertical vision. Prefire also uses the
  finite frustum. Explicit player sensor geometry remains independent.
- Visible-part candidates retain hitgroup, probe support, margin and observation
  time. Weapon/range/own-uncertainty heuristics select exposed points, with short
  hysteresis. Hidden enemy health/armor is never used.
- Visibility work normally uses five native rays in open sight and is capped at
  24 probes per actor, including smoke/flash predicates. Unvisited points remain
  unknown rather than being counted as occluded.
- `TravelProgress` detects failure to approach a goal, including oscillation.
  Yield, checked backoff and rate-limited replan preserve tactical intent and
  gaze. Idle campers, airborne transitions and arrived holds do not accrue stalls.
- Seeded personality preferences vary patience, risk and flank commitment without
  expanding the novice peek repertoire or changing shared physical constants.
- Bots carry a loaded backup sidearm where appropriate. Recognized visible
  threats can cancel an uncommitted tactical reload or justify switching to it.
  Ammo-commit, retained attack floor and deploy timing cannot be bypassed.
  Loaded primary restoration supports snipers as well as automatic rifles.
- Bot weapon models, muzzles, audio and gesture packs follow the equipped weapon;
  per-actor cached models prevent repeated switching from accumulating clones.

These are independent browser policies informed by the pinned research in
`bot-improver-research-2026-10-25.md`. No native plugin code, memory integration,
instant velocity writes, permanent alertness or zero-reaction defaults were
imported. FACEIT labels remain training heuristics, not empirical population
ratings or a claim of human-indistinguishable play.

## Utilities

All six items are selectable: HE, flashbang, smoke, Molotov, incendiary and decoy.
The four-slot loadout permits two flashes, one of each other item and one fire
grenade. Both player and bot utility use can be disabled in Setup / Utility.
New and existing Duel setups retain their saved non-utility preferences.

- Desktop `5` cycles carried grenades and is rebindable. Legacy bindings using
  `5` are preserved by selecting an unused utility key. HUD buttons provide
  selection, full throws and lobs, including touch operation.
- Holding primary/secondary attack primes the selected grenade; release throws.
  Combined buttons produce intermediate strength. Draw time, a short release
  interval, movement inheritance and throw lift precede physical flight.
- Early touch/HUD throws queue without bypassing draw. Pause cancels priming,
  weapon slots return to firearms, and an empty utility cannot be re-equipped.
  `G` drops the selected unprimed grenade, not the hidden rifle. Pickups enforce
  stock limits, distance and wall visibility; deaths drop selected/best utility
  or release a live primed grenade. Picking up a gun exits utility stance.
- World-space projectiles use bounded fixed-step gravity and bounces. Native
  maps use a separate grenade hull/mask, including the native grenade-only clip
  overlay; authored maps use bounded small-hull probes. Live actor hulls bounce
  grenades without inventing contact damage.
- HE applies cover/armor-aware radial damage. Fire occupies supported reachable
  floor patches, with distinct Molotov/incendiary lifetimes/range and 5-Hz damage.
  Fire cannot burn an actor on another storey through a floor.
- Smoke obscures individual sight/shadow samples, inhibits negative sight
  evidence and extinguishes fire. World-clipped bullets and HE open temporary
  holes; a bullet is not physically stopped by the cloud.
- Flash exposure uses the actual camera-eye position, facing, range and cover.
  Both sides receive blindness; bots cannot continue perfectly accurate live
  tracking/fire while blinded. Seen flashes permit delayed, skill-dependent
  turn-away reactions. Local fire contact triggers physically legal escape inputs.
- Bot grenade plans use recognized sight/sound reports, finite aim and readiness,
  distance/near-wall checks and teammate safety. They cannot read the hidden
  player's live position. 127 independent Dust 2 opportunities were trajectory-
  tested against the eight chunk colliders, not certified in the native engine.
- Duel and Prefire share the same utility/loadout policy. Allies reserve setups
  and covered supporting peeks wait for actual detonation. Passage leases,
  persistent flanks and context-specific motors integrate with existing tactics.
- Fight review captures bounded projectiles/effects/drops and exact utility
  events, including openings, flashes and native held/throw poses. Paused and
  backward seeking do not advance or mutate live utility state.
- Utility damage uses the ordinary damage/death feed but not gun-hit accuracy.
  Self-damage awards no kill, damage or XP credit. Grenade damage does not reuse
  the underlying rifle's bullet-tagging constants.
- Instanced projectiles, retained smoke/fire billboards, flash/interior overlays
  and small pools bound cosmetic work. No runtime inference or remote AI service
  is introduced. Idle utility simulation avoids actor snapshot allocations.

## Native Audio And Fidelity Boundaries

`tools/import-utility-audio.mjs` extracted 63 event definitions / 113 unique WAVs
from installed build 2000935, totaling 23,906,530 bytes. Source archive, source
hashes, decoded WAV metadata and selection notes remain in `audio/events.json`.
It merges only utility-owned entries. No downloads or running-game inspection
were used for extraction. The optional bank is loaded separately; gun-only
drills do not fetch/decode it. Decoys use the thrower's retained firearm report
when known, with an explicitly documented representative native fallback.

Numeric throw velocity, carry speed, deploy and fire convars were checked
against static exports. Pin readiness uses native graph completion rules; the
explicit .1-second launch gap is not inferred from sound markers. Action cues
cancel their owned voices on interruption and flash applies a low-pass effect.
Restitution, blast falloff, flash compositing, smoke shape/holes, flame spread
and tactical selection are trainer approximations.
Grenade models and authored first-person actions now come from the installed
game, with native hand-grip anchors and absolute third-person grenade poses.
The renderer and action transitions remain browser adaptations, not the complete
native animation graph. Playback reproduces recorded trainer effects, not
Source 2 particles. See `utility-completion-audit-2026-10-26.md`,
`native-grenade-presentation-2026-10-26.md` and `utility-kernel.md`
for precise boundaries.

## Verification

- Broad final regression rerun: 231 files / 4,207 tests passed, excluding the
  unchanged expensive native-route file already exercised in the full run.
- Full run's 75 native-route checks passed. Its one failed peripheral-vision
  fixture was corrected to test memory with both points inside the finite
  frustum, then verified with scoped/vertical negative-vision tests.
- Further targeted passes cover subsequent integration changes, all six utility
  items against actual installed Dust 2 collision, audio provenance/importer,
  control migration, self-damage, pause/resume, inventory and draw timing.
- Chromium desktop/mobile browser tests pass for actual grenade selection,
  smoke shader/instancing, nonblank canvas pixels, loadout persistence and native
  sidearm model reuse. The mobile HUD was visually checked for radar overlap.
- Production TypeScript/Vite build passed; existing large-chunk warnings remain.
- Headless five-bot generated-arena CPU sample: median ~0.40 ms and p99 ~1.77 ms
  per physics tick on this machine. This is not a rendered FPS guarantee.
- The profiling harness now explicitly selects generated arenas and rejects
  paused/no-progress samples. Its native-default/paused initial trials are not
  valid comparative performance evidence. The live 4x-CPU covered-arena sample
  progressed 4.5 simulated seconds; frame medians were ~16.7 ms. Its zero visible
  actors mean it does not establish worst-case rig or native-map performance.

Player bullet impact coordinates, native map resources/caches and shared weapon
movement/spread formulas were not retuned for these policies. Changelog history
is preserved, with a new October 26 entry prepended.
