# Teammate Audio And Callouts

October 20, 2026.

## Finding

Living allied footsteps, landings and gunfire already return at the hostile-audio boundary in `DuelSimulation.informHearing`. Prefire inherits that boundary before its controller receives any sound. Rendering audio to the human player is separate and does not feed microphone/output audio into bot perception.

There was a related callout bug in Duel: `TacticalBrain.teammateCallout` called `hear` as an occluded footstep. The point was the teammate's observed enemy position, not the speaker's position, but it gained acoustic localization error again. It was then labeled as sound and could select unrelated nearby sound-check openings. A subsequent real footstep could also blend with that reported point and inherit the callout's already-expired reaction deadline.

## Correction

- Callouts retain their reported position and world height, with a reaction deadline and bounded memory uncertainty. They do not consume acoustic-localization randomness.
- Reports of sightings remain sight-based trade evidence; they are not relabeled as independently heard footsteps. Only a bot's own current visual contact can generate a visual broadcast.
- A real sound does not coalesce with a previous callout or inherit its deadline. Normal repeated-footstep coalescing is unchanged.
- Stale sound-opening selection cannot redirect a callout-focused bot. Duplicate callouts remain idempotent, and a recent personal sighting remains protected.
- Allied footsteps, landings and shots stay audible to the human player but excluded from bot enemy-hearing/contact updates.

Nearby audible teammate deaths still intentionally locate a fight area for trading when no better evidence exists. That existing behavior does not identify the hidden killer and keeps uncertainty and a reaction delay. Acoustic corner routing of actual player sounds is also unchanged.

No shot, recoil, movement, audio rendering, geometry or per-tick ray budget changes are part of this fix.

## Regression Coverage

- Duel: all three sound kinds from every living allied emitter, with five listeners; genuine player sounds still reach all five.
- Prefire: all three allied sound kinds stop before controller hearing/contact updates; genuine player sounds still reach both fixture defenders without granting sight.
- Callouts: position copies, original height, source, delayed recognition, duplicate rejection, recent-sighting priority, unchanged acoustic RNG, independent subsequent sound deadlines and actual motor-facing output without blind firing.
- `npm run check` passed: 188 test files / 3,783 tests, TypeScript and production build (`research/teammate-hearing-final-check.txt`). The initial run caught the compact-list limit in the appended changelog; that entry now has its own section.
- Desktop/mobile changelog browser checks: both passed (`research/teammate-hearing-browser.txt`).
