# CS2 Coaching Language Review

Reviewed October 17, 2026. Scope: feedback wording and presentation across all nine
training modes, plus movement lessons. No aiming, impact, recoil, movement,
visibility, scoring weights or score thresholds were changed for this review.

## Evidence Policy

Reddit is useful for familiar terminology, practical exercises and contrasting
situations. Comments are community opinions, not verified professional credentials,
mechanical measurements, population statistics or FACEIT benchmarks. We retain
repeated, applicable ideas and reject universal claims such as "never crouch",
"never spray", "always wide swing" or "never move the mouse". No comments are
copied into the app. The implementation adapts the advice to measured events.

## Sources and Application

| Discussion | Useful theme | Application and boundary |
| --- | --- | --- |
| [When to counter-strafe on a peek](https://www.reddit.com/r/LearnCSGO/comments/1k7y9lg/) | Prepare the intended angle before exposure; deliberate clearing differs from a committed entry. | Pre-aim, strafe into the line, stop, correct and fire. Do not diagnose all wide peeks as wrong. |
| [Crosshair placement and flicking](https://www.reddit.com/r/LearnCSGO/comments/1h6kxn9/) | Reduce avoidable corrections with better placement; avoid searching several angles at once. | Crosshair-placement feedback requires exposed target samples; isolation advice requires observed multiple threats. Necessary mouse corrections are valid. |
| [Peeking and counter-strafing](https://www.reddit.com/r/LearnCSGO/comments/13zczx3/) | Use cover to isolate fights; information and shooting peeks have different purposes. | "Slice the pie" means clear positions one at a time, not shuffle indefinitely or forbid an informed 1v1 swing. |
| [Aim improvement review](https://www.reddit.com/r/LearnCSGO/comments/1w1sofu/any_advice_on_how_i_can_improve/) | Aim before clicking; practise fundamentals deliberately. | First-bullet placement cues describe observed alignment, not an inferred panic habit or reaction-time defect. |
| [Spray transfer](https://www.reddit.com/r/LearnCSGO/comments/ffpqhf/) | Clean first-target control helps the transfer; continued firing retains the ongoing recoil. | Connect on A, transfer to B while carrying the correction. The selected kill/bullet transfer rule still applies. |
| [Burst versus spray](https://www.reddit.com/r/LearnCSGO/comments/lajbgl/) | Weapon, distance and commitment matter when choosing taps, bursts or a spray. | Long-range low hit rate suggests comparing bursts with a reset, not a universal bullet limit. Close-range controlled sprays and body follow-ups remain valid. |
| [Movement during a fight](https://www.reddit.com/r/LearnCSGO/comments/1rtzu00/how_am_i_supposed_to_strafe_mid_fight_if_by_the/) | Repositioning and committed crouch sprays solve different situations; being tagged changes escape options. | Do not blame every crouch or static shot. Movement drills explicitly require entries; holding in Duel is valid. |
| [Audio setup discussion](https://www.reddit.com/r/cs2/comments/16x280m/the_best_audio_settings_for_most_people/) | Devices and processing change perceived cues; there is no universal loudness setting. | Calibrate comparable sounds at fixed, comfortable volume. Mono cannot grade direction; front/back ambiguity is not proof of poor listening. No unsafe volume or blanket EQ recommendation. |

## Feedback Contract

1. Name the measured issue, then give one short next-rep action. Keep numeric
   evidence, caveats and local targets in the review rather than the live cue.
2. Say **counter-strafe** for the technique, **crosshair placement / pre-aim** for
   preparation, **angle isolation / slice the pie** for cover use, and **reset**
   for allowing recovery between shooting sequences. Optional term explanations
   define these for beginners.
3. Do not infer an opposite-key brake from low speed alone. Duel measures firing
   eligibility, not keyboard intent. Explicit brake observations belong to the
   movement drills.
4. A hit-rate collapse alone does not reveal overpulling, insufficient pull or
   horizontal drift. Only the Range coach has recoil-corrected shot-center
   measurements for those directional diagnoses. Guided head misses use the head
   guide rather than the free-spray body envelope. Opening-only errors do not
   become late-spray diagnoses. Moving-target lateral errors can include tracking,
   not just recoil. Random spread remains separate.
5. Do not call time-to-damage reaction time, or a practice score a rank. Do not
   turn an isolated miss into a claim about a player's habits.
6. Use binding-neutral cues outside the A/D tutorial. The tutorial has its own
   visible A/D controls; game controls are configurable.
7. Preserve `SkillMetric.label` as a stored key. `coaching-language.ts` provides
   display aliases consistently for reviews, practice blocks and skill trends.
8. Keep "Show coaching tips" effective: optional term help hides with other
   coaching prose, while evidence, scores, values and controls remain available.

## Verification

Scoped tests cover contextual cues, concise live actions, off-angle corrections,
weapon/body exceptions, isolated versus multiple threats, spread uncertainty,
repeated-rep exercises, binding-neutral text, persistence keys and hidden tips.
Browser checks exercise real shot results, the glossary, practice/trend continuity,
mobile layout and tips visibility. The full test/build check remains required.

Validation for this review:

- `npm run check`: 3,481 tests in 170 files passed; TypeScript and production build
  passed. Existing large-chunk warnings remain; no FPS improvement is claimed.
- Final focused Range/rep/language regressions: 44 passed, including the additional
  moving-target tracking distinction after the full-suite snapshot began.
- 39 distinct desktop/mobile Chromium browser tests passed across coaching,
  hearing, saved-practice workflows, Prefire, lessons and round-end notifications.
  Five desktop-specific cases were intentionally skipped on mobile. Two stale
  tutorial-text expectations were updated and passed on rerun.
- Production smoke: all nine modes at desktop and mobile sizes (18 checks), no
  browser/asset errors, no horizontal overflow and nonblank 3D canvases.
- `git diff --check` passed. No commit, push or deployment was requested here.
