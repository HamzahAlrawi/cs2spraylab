# Feature Reliability Audit

October 19, 2026. Local changes, not a deployment record.

## Reproduced Problems

| Area | Cause | Repair |
| --- | --- | --- |
| Fight review | A selected-shot diagnostic was presented as playback; the camera and target shapes remained at one shot while the time control changed. | Separate timeline playback with interpolated actor poses and recorded player camera angles; exact shot diagnostics are optional. |
| Reviewing a loss without firing | The UI required a player shot even when movement and bot shots had been recorded. | Timeline playback uses recorded frames and does not require player shots. |
| Replay after a round reset | Actors were drawn over the next randomized arena. | Bounded, detached cover snapshots retain the arena and interactive surface states belonging to that recording. |
| Replay lifecycle | Playback could outlive a setup restart or continue behind another panel. | Restart/configuration changes close both UI and engine playback; suspension pauses the timeline; close restores live overlays. |
| Scorecard text | Narrow global definition-list styles, missing legacy fields and non-finite values produced overlapping or invalid text. | Scoped scorecard layout, safe value formatting, one focus/action, optional detailed measurements. |
| Completed scorecard | Automatic round advance replaced useful feedback with the new empty coach. | Completed-round snapshot, then valid history, supply the last measured result until new activity exists. |
| Practice action | Serialized metric equality depended on object key insertion order and rejected normalized reviews. | Compare metric fields structurally; only the active completed-round context offers Duel practice. The browser regression clicks through to an actual three-rep block. |
| Mode changes | Old ready status could outlive its disposed range engine during an asynchronous mode import. | Explicit engine readiness, reset loading status, and guarded entry. |
| First visit | The floating settings hint covered toolbar buttons. | An in-flow hint row reserves its own space and retains dismiss/settings actions. |
| Fullscreen | The toolbar resolved the range-only canvas host, which is absent in Duel/Prefire. | The shared practice section is the fullscreen target; unsupported APIs give feedback. |
| Settings shortcuts | Mode-specific gear buttons opened whichever settings tab was last used, even if unrelated. | Hearing opens Audio & video; combat mouse/crosshair shortcuts open Mouse. The general settings button retains its last tab. |
| Lessons | Native Space activation was intercepted on buttons; held keyboard controls and completion snapshots were unreliable. | Preserve native button activation, explicit held controls, stable results, and an actionable coast-to-stop retry. |
| Lesson from Session | The history drawer remained mounted below the lesson, leaving two modal keyboard handlers active. | Replace the drawer with the lesson and restore a connected opener or the fundamentals button. |
| Hearing interruptions | Calibration, mute or a settings panel could leave an unanswerable trial without a clear resume; stale async loads could start audio later. | Explicit resume/retry of the same trial and token-based cancellation of pending loads/sequences. |

## Replay Boundaries

- This records the authoritative browser simulation, not a CS2 demo or a second simulation.
- Collection does not call the random generator or modify shot resolution. The initial and
  terminal frames are retained, including a death between the regular four-tick samples.
- Positions and angles interpolate; damage, death and equipment changes occur on their
  recorded frame. Playback uses separate skeletons and never rewinds the live hitbox rigs.
- Recording rings remain bounded: 321 frames, 160 shots, changed input history and only
  cover revisions referenced by retained frames/shots. No recording is added to persistent
  browser storage. Export remains a deliberate download.
- Overview is a cutaway of recorded Duel cover, not a duplicate full-detail warehouse.
  Native Prefire uses its existing static map renderer. Playback has no audio track and
  does not reproduce CS2 demo features, first-person viewmodel animation or netcode.
- Normal aiming, recoil, movement, collision, damage, XP and saved progression rules are
  unchanged. Replay camera capture reads the existing recoil/scope calculations.

## Regression Coverage

Unit coverage includes detached/bounded recordings, interactive door snapshots, no-shot
playback, angle wrapping, stepwise death/equipment, final lethal frames, stable seeded
damage, reusable playback rigs, scorecard legacy/malformed values and lesson snapshots.

Browser coverage exercises replay movement/cameras, optional diagnostics, export,
pause/close/restart, previous-map replay, original live simulation state, native hitbox
pose clocks, measured scorecard retention, desktop capture, delayed mode imports,
mobile entry, settings, loadout, progression, lessons, hearing interruptions and Prefire.
Desktop/mobile screenshots and nonblank canvas checks accompany the workflows.

Several older browser assertions targeted controls that now live inside explicit
disclosures, exact pre-calibration input labels, or obsolete changelog counts. Those
selectors were updated to follow real user paths while retaining their behavior checks.
Input-test resource timing buffers were enlarged because native audio/model requests
could fill the browser's default buffer before the later lazy range import was observed.
The 240-seed arena sweep has a scoped 60-second timeout rather than 30 seconds; no seeds
or geometric assertions were removed.

Local validation artifacts are under ignored `research/` and `test-results/` directories.
Physical Safari/mobile hardware, headphone acoustics and every third-party browser/GPU
combination cannot be certified by the local automated runs.

## Completed Validation

- `npm run check`: 175 test files / 3,554 passing tests, followed by a successful build.
- Desktop workflow recheck: 16 passed, one touch-only case skipped. Includes real pointer
  capture through a Duel-to-range switch, legacy event completion, settings, loadout,
  history-to-lesson navigation and measured scorecard retention.
- Phone workflow sweep: 19 passed, three desktop-only cases skipped. Includes replay,
  interrupted hearing trials, tutorial completion, responsive dialogs and FPS controls.
- Physical drill sweep: 27 passed, one mobile-only case skipped. Includes all exported
  selectable weapon models/audio, native Dust 2 hits, moving-shot feedback, two physical
  route clears, automatic progression/repeat, transfer, jump/distance and long-range cues.
  The remaining armor/radar test used obsolete selectors; its repaired user path passed
  in the final recheck, including persisted armor, helmet and per-bot settings.
- Final desktop/phone regressions: eight passed, two desktop-only cases skipped, including
  six rapid Deagle taps, delayed range imports and clicking through to a Duel practice block.
  Two additional contextual settings-shortcut checks passed.
- Installed Brave and Opera GX: 30 passed; four Chromium-specific QA cases skipped.
- `node tools/smoke-production.mjs`: 18 checks / nine modes at desktop and phone sizes,
  nonblank canvases, no page errors and no failed local asset responses.
- `git diff --check`: clean. Existing large-bundle warnings remain; the audit does not
  claim exact CS2 behavior or guaranteed performance on every old machine.

No push or Cloudflare deployment was performed as part of this repair.
