# Skill Coaching Audit

## Purpose

Feedback must answer: what happened, which measured skill matters next, what to change, and how to repeat the improvement. A local practice score is not a FACEIT level, Leetify rating, diagnosis of intent, or proof of professional proficiency.

The [October 17 CS2 language review](cs2-coaching-language.md) adds community-source
provenance, concise next-rep cues and presentation rules without changing score
weights or persisted skill keys.

## Coaching Sources

- [Leetify's metric definitions](https://leetify.com/blog/leetify-stats-glossary/): visible-target accuracy differs from all-shot accuracy; time to damage includes aim and firing rather than measuring reaction time alone. Their match-demo formulas and inclusion rules are not copied or represented as identical to our simulator.
- [f0rest's recoil practice interview, Dignitas](https://dignitas.gg/articles/how-to-practice-recoil-control-with-dignitasvie-player-f0rest): observe the uncontrolled pattern, practice correction at different distances, and retest without guides. Distance and shooting context influence whether taps, bursts or sprays are appropriate. Our 80% containment goals and distance bands are local heuristics, not interview measurements.
- [Refrag's aiming guide](https://refrag.gg/blog/how-to-improve-your-aim-in-counter-strike/): prepare likely positions, clear angles incrementally, and practice both opening and sustained fire. Body-follow-up practice is legitimate; aim corrections for unexpected targets are legitimate. Weapon accuracy always uses the installed runtime data, not generalized claims in a guide.
- [Dignitas' CS2 peeking guide, August 2026](https://dignitas.gg/articles/peeking-in-cs2-why-you-keep-losing-duels): distinguish information peeks from committed fights, use cover to limit exposure, and focus on one weakness at a time. We do not assume a hold, crouch, wide swing or lack of a shot is inherently bad.

## Mode Contracts

| Mode | What Is Measured | What The Coach Must Not Invent |
| --- | --- | --- |
| Guided spray | Native movement eligibility, recoil-corrected opening and shot centers in a 20 cm head coaching envelope, actual impacts, early/late drift | A guarantee that a center in the envelope physically hits; a random-spread miss is not automatically bad correction |
| Free spray | Deliberate opening, grounded shot discipline, sustained head/body envelope and physical hit rate | A requirement that every follow-up hits the head; full-magazine fire is an exercise, not the right choice for every duel |
| Transfer | A/B-phase shot centers, hits on each target, first connecting B round, wrong-target rounds | A fresh recoil reset on B, successful transfer from only shooting A, useful hits after a target is dead |
| Counterstrafing | Entry speed relative to current weapon-mode cap, speed at the shot, actual opposite-input brake, opening aim and impact | A stationary hit as a braking rep; a miss as proof of movement error |
| Peeking | First observed opening, distance-normalized aim, actual brake, shot timing, sustained settled shots | An off-angle correction or settled diagonal path as inherently wrong; universal headshot requirements for body-focused guns |
| Burst & reposition | Opening hit, rounds 1-3 versus 4-6, movement eligibility, existing 0.9 m reposition gate | Pull direction from hit counts alone; every burst bullet must hit the head |
| AI Duel | Fresh visible-target firing sequences, weapon/range-aware timing, exposed head/body preparation, shot-level accuracy, rapid sequences, single-threat openings | Intent, exact reaction time, hidden head preparation, knife or blind wallbang accuracy; holding or information peeks as an entry failure |
| Map prefire | Route completion, settled openings, exposed aim preparation, clean entry, isolation, efficiency and named angle review | Preparation from hidden heads, exact pro time targets, full-route mastery from one lucky kill |
| Hearing | Signed bearing error, front/back confusion when supported, range over/undershoot, comparable setup/sound trials | Left/right ability in mono, distance penalties in direction-only practice, reliable in-game metres from loudness alone |

## Physics And Sampling

- Existing physical shot and impact calculations are unchanged. Scores never replace mesh/actor intersections or repaint stored world impacts.
- Range telemetry computes the pre-random-spread center using the existing shot formula: yaw minus recoil yaw, pitch plus recoil pitch. It is an analytical coaching sample, not a second simulated hit.
- Movement eligibility uses the actual firing-mode accuracy parameters, float32 Source-unit speed, walking state and ground contact. Low speed is not automatically an observed opposite-key brake.
- Duel coaching consumes existing 32 Hz exposed-point observations. It adds no raycasts, mesh traversals, frame loops or hidden-position lookups. Descriptive aim gap is not Leetify's demo-based crosshair-movement metric.
- Information-gathering time does not lower Duel accuracy or opening isolation. Only committed measured sequences are scored. Short-range mobile weapons can receive a small contextual allowance; physical spread remains unchanged.
- Scores omit unmeasured components and explicitly state sample confidence. Range overall control needs at least three measured shots. Old history without telemetry remains readable and unscored for new quality metrics.
- Semi-automatic single presses can form a bounded 30-second same-setup tap review after three measured taps. This joins coaching evidence only; trigger timing, ammunition, punch and recovery remain continuous and unchanged. Its local score weights native shot discipline 40%, recoil-corrected preparation 40% and physical hits 20%.
- Range comparisons match weapon, mode, spread, moving-target state, burst, distance and transfer configuration. Hearing comparisons match output, sound, muffling, volume and replay count. Device volume outside the browser cannot be verified.

## Verification

Automated coverage includes native crouch-speed rounding, scoped-mode eligibility, opening-error preservation, body-focused weapons, off-angle corrections, early/late control, B acquisition, unique pellet/collateral hit counts, blind fire, information peeks, legacy history, signed audio bearings, mono and comparable-history gates. Browser workflows exercise actual range shot resolution, persistence, stable canvas size, mobile overflow, live goals and audio calibration. Run `npm run check` plus the focused Playwright skill, hearing, learning and Prefire workflows.

### October 10 Results

- `npm run check`: 2,865 tests across 124 files passed, followed by TypeScript and a successful production build.
- Coaching / hearing / learning / Prefire desktop and mobile Chromium: 41 workflows passed; three duplicate mobile-only projection, sound-bank and native-course sweeps were intentionally skipped. Deagle taps were verified separately through real range shot resolution and persisted recoil state.
- Ten loadout / changelog desktop and mobile workflows passed after updating stale test expectations for the already-existing 40 angle placements and the appended coaching section. Published changelog fingerprints remain unchanged.
- Screenshots checked for readable feedback and mobile overflow. Range canvas dimensions remain stable before and after completing an attempt. The Duel scorecard retains the last completed review until the new round has measurements.
- Review fixes include incomplete six-shot bursts remaining unscored and scoped shot telemetry retaining firing-mode parameters after automatic unscoping. Coaching adds no visibility raycasts or physical hit substitutions.
- Build retains the existing large-chunk warning. No cold-load or old-hardware FPS improvement is claimed by this scoring-only change. CS2 parity and professional rank calibration are not implied.
