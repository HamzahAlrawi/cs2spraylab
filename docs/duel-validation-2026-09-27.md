# AI Duel validation (2026-09-27)

## Installed game comparison

The local CS2 installation reports `ClientVersion=2000918` and
`ServerVersion=2000918` in `game/csgo/steam.inf`. The project extractor
decompiled `scripts/weapons.vdata_c` from this installation; the raw KV3
SHA-256 was `3289d4dba65b1ef3f884c389448c8a6c6db8691442c18a7aaddb28434aaf250d`.
Every extracted weapon gameplay field was byte-for-byte unchanged from the
repo's build `2000908` JSON. The generated file was not substituted because
the native recoil-math fixtures are explicitly proven against build `2000908`.
An unchanged weapon table does **not** prove the current binary's recoil
algorithm is unchanged. A fresh binary/math audit is still needed before
updating that provenance label.

Both the old range and AI Duel use `advanceActor` and `shotDirection`. A new
128-tick fixture compares AK position, velocity, duck and jump on identical
open-floor inputs. Duel's separate solid and body collisions can of course
change a path when cover or another actor is contacted. The local game files
do not expose an authoritative default movement-cvar set in the distributed
`cfg` files; the simulation's gravity, friction, stop speed, acceleration,
walk/crouch multipliers, duck ramp and hull sizes were cross-checked against
[current-build movement measurements](https://memorin.app/mechanics/movement-constants).
This is still a 128 Hz browser approximation, not a CS2 server replay; air
control, stamina, contact resolution, and some eye-height interpolation are
not yet proven equivalent. The synthetic arena is in metres using
`1 Source unit = 0.0254 m` throughout movement and weapon data.

## Arena and sound checks

The arena now has paired entry, flank, camp, and off-angle pockets, low head-exposure
barriers, supply crates and cargo dividers across three symmetric variants.
Every physical prop is in the same solid list for movement, bot vision, and
shot traces. Tests check hidden spawns, clear navigation to each angle, and
cover blocking of bullets and movement. The 12-seed, 25-second behavior audit
recorded bot shots in every round, multiple route roles in 11 rounds, and
multiple peek actions in 11 rounds. This measures policy variety, not whether
the policy looks human. With teammate callouts enabled, five-bot headless
p99 tick time was about 0.25 ms on this machine; this does not measure
older-device GPU time.

Running footsteps, landings and shots now create delayed, noisy auditory
beliefs. Repeated footsteps preserve the initial reaction deadline. Aggressive
bots investigate, patient bots reposition, and holders preaim or hold their
angle; a sound alone never authorizes a shot. Occlusion reduces footstep and
landing range. The chosen `900 u` open and `520 u` occluded hearing radii are
**trainer tuning values**, not measured CS2 sound-engine constants. Tests
cover a hidden gunshot changing bot movement, response delay, rapid-cue
coalescing, silent settled shift movement, and the rule that teammate callouts
cannot authorize shots without visual identification. Exact CS2 HRTF, material-based
attenuation and masking are still outside the model.
