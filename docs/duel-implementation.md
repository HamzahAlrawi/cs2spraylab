# AI Duel implementation and verification

AI Duel is the default drill. It is a local, browser-only simulation; it does not
connect to CS2, read game memory, or automate gameplay. `DuelStage` owns the UI
and persisted configuration. `DuelEngine` owns Three.js rendering, input, audio,
and animation. `DuelSimulation` owns the fixed 128 Hz combat state and emits
events. The shared movement, recoil-recovery, and shot kernels also serve the
older range drills.

## Current behavior

- One to five independently configured bots use a seeded, connected cover arena.
  Their primary weapon, armor, health, skill, accuracy, and behavior can be set
  globally or per bot. Player health is separately configurable (100 by default).
  New rounds alternate the opening cover lane and restart automatically after a
  configurable 1-3 seconds, retaining fullscreen and pointer lock. Escape pauses
  the session and countdown. A compact result notification does not resize the stage.
- The bots route around physical cover and actors, sense visible head/body
  samples through the same solid geometry used by shots, hear footsteps and
  gunfire with delayed/uncertain location estimates, retain short-term location
  memory, and choose rank/weapon-conditioned
  shoulder, quick, wide, fast wide, crouch, prefire, slice, jump, run, and
  crouch-wide actions. Lower ranks largely use basic run/wide peeks and have
  slower recognition, worse preaim, aim error, and less reliable braking.
  The expanded arena includes entry, flank and camp angles, low barriers and
  independently varied flanks with paired north/south cover; sound responses differ by holder/patient/aggressive
  behavior. Each side has an entry, flank, camp, and off-angle route. Bots can
  switch routes after a fight, when hurt, or when a hold stays blind, vary
  burst and hold durations, counter-strafe for short combat displacements,
  and reload behind cover. A confirmed visual contact can generate a delayed,
  noisy teammate callout, but the receiver cannot fire on the callout alone.
  Peeks search for reachable exposure at the selected edge before committing;
  navigation can recover when a physical hull is closer to cover than the route
  planner's safety margin. Approach gaze follows travel until near the angle.
  Follow recoil and dynamic crosshair use the range's projection.
- Player and bot rounds use the same weapon cadence, movement inaccuracy,
  spread, recoil recovery, impact ray, and cover hit tests. Damage and armor
  are handled in a separate module. Magazines persist until reload. Automatic
  firing carries fractional cycle time across ticks, matching the range rather
  than rounding every interval up to a full tick.
- The player and bots share gradual crouch stance, camera/head height, 34%
  crouch-speed cap, and standing-clearance checks. Crouch is on Ctrl or C.
  The 0.15625-second duck ramp, 72/54-unit hull heights, and speed cap come
  from [current-build movement measurements](https://memorin.app/mechanics/movement-constants).
  The precise eye interpolation and unduck timing remain approximations.
  Airborne crouch tucks the feet up without dropping the eye trajectory. Both
  simulations sweep vertically against cover, so actors can land on and jump
  from props. Accuracy uses support contact, not an assumption that feet must be
  at floor height. All range modes now interpolate rendered player positions.
  See `duel-validation-2026-09-27.md` for the latest installed-build comparison.
- Desktop duel entry requests pointer lock before fullscreen. In browsers
  supporting [Keyboard Lock](https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock),
  it locks `KeyW` while fullscreen so Ctrl+W can be used to crouch and move.
  On unsupported browsers or denied permission, a live warning recommends C;
  a normal webpage cannot universally suppress the close-tab shortcut.
  Escape exits the duel and releases both locks.
- The renderer uses a CS2-derived third-person rig and weapon assets already
  produced by this project's local asset pipeline. When present,
  `duel-motion.glb` adds 40 clips: eight-way run/walk/crouch, directional jump,
  crouch-jump/in-air, idle, and three native deaths. A small floor-contact
  correction settles corpses without a ragdoll solver. Player death lowers and
  rolls the first-person camera. Otherwise the baseline target clips are used.
- Fixed-tick positions are interpolated for display, with immediate local mouse
  orientation. Native locomotion clips blend by direction, actual speed and
  continuous crouch fraction on a shared stride phase. Bot aim has bounded
  angular acceleration, routes skip redundant grid corners, and arrival braking
  does not repeatedly restart movement. A firing burst begins after aiming,
  rather than expiring during the recognition/settling delay.
- Static geometry is batched by material. Conservative whole-character bounds
  skip rendering/animation only when outside the view or entirely behind one
  solid. Actor physics and perception continue. Replaced skeleton GPU textures
  and view models are disposed. See `duel-rendering-audit.md` for measured costs.
- Enemy sounds now use camera-relative HRTF positioning and cover filtering;
  tracers start at cosmetic weapon muzzles without modifying physical rays.
  Visible-motion prediction, continuous aim correction, separate recoil control
  and range-dependent bursts improve stronger opponents. See
  `duel-audio-combat-audit.md` for calibration, regression checks and limitations.
- Shared render-only camera and weapon recoil tracking does not change the
  physical shot direction. Its fractions are tuning priors, not a measured CS2
  camera reconstruction. See `gameplay-session-audit.md` for this pass's checks,
  current-build weapon comparison, animation conversion, and remaining gaps.

## Assets and deployment

The model and animation binaries in `public/revamp/models/` are Git-ignored.
They are available in this local workspace but **not** a clean Git clone.
The source game files and derived exports are not licensed here for public
redistribution. Regenerate the local assets with `npm run assets:build` before
building/deploying from a fresh checkout. It now includes native motion export;
`npm run assets:duel-motion -- --refresh` rebuilds just that library. Source2Viewer,
Blender's Python and Blender Source Tools' DMX parser are local prerequisites;
see `gameplay-session-audit.md`. Review rights before publishing derived art.

## Verification and remaining fidelity gaps

Run `npm run check`, `npm run audit:duel`, `npm run bench:duel`, `npm run profile:duel`, and
`npm run test:browser -- --project=chromium tests/duel.spec.ts`.
The Playwright suite checks fullscreen/pointer lock, Ctrl+W in supported
Chromium, fallback messaging, combat traversal, config persistence, and
mobile tap entry. The headless benchmark measures simulation CPU time only,
not GPU frame rate on older devices.

The seeded behavior audit checks that bots actually engage and use different
routes, peeks, and combat phases; it is a regression check, not a realism
score. This is a playable tactical simulation, not measured human equivalence. The
FACEIT level values are provisional tuning curves, not measured reaction-time
distributions per level. Route selection and callouts are hand-tuned heuristics,
not a learned policy or a validated model of human decision making. Slice/prefire behavior, audiovisual
footsteps, ragdoll physics, and reload/firing animation layers are still simplified. Third-person
hit shapes are analytic and not bone-attached. The current damage/armor formula
is a Source-family approximation. Eighteen firing, movement-speed, accuracy,
recoil and recovery fields across 17 weapons match installed build 2000918;
that is not a full engine-behavior validation. USP-S and knife are available
in the original range but are not yet duel loadouts. Do not claim exact CS2
parity until independent current-build fixtures and low-end GPU tests exist.
