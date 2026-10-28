# Training Workspace UX

October 18, 2026. Presentation-only iteration after the Dust 2 coverage update.

## Problems Addressed

- A flat drill dropdown provided little indication of which skill to practice.
- Long, undifferentiated forms hid frequent settings among specialist controls.
- Tiny form labels and narrow sidebars made setup hard to scan.
- Phone sidebars consumed the practice area; there was no explicit focus view.
- A single accidental reset could discard personalized input settings.
- Dialog tab traps could include controls inside closed disclosures.

## Interaction Structure

- The live training surface remains the first screen. There is no landing page,
  forced onboarding wizard, additional asset download or UI dependency.
- The native quick drill switch is grouped by skill. All drills opens an explicit,
  searchable dialog with one-line goals and a current-selection indicator.
- A visible Setup command shows/hides the existing drill setup and review panel.
  Narrow phones begin with the range unobstructed. Opening the panel gives it a
  scrollable, full-width setup section instead of squeezing controls into columns.
- AI Duel puts bot count, skill, behavior and weapon pool first. Arena, health and
  armor, advanced combat/radar and individual bot overrides are disclosures.
- Prefire puts route, lineup and training preset first. Specialist encounter,
  combat, evidence and guidance controls remain available in disclosures.
- Global settings separate Mouse, Crosshair, Controls, Training and Audio & video.
  Scoped sensitivity calibration and data tools are optional advanced sections.
- Loadout categories and text search filter only the existing weapon inventory.
  Owned-finish selection, sidearm-only behavior and unlock purchasing are unchanged.
- Settings save through the existing storage path. Restore defaults opens an inline
  confirmation; cancel does not mutate settings or progression.

## Accessibility and Rendering

Settings use linked tabs with one tab stop, arrow-key navigation and Home/End.
Dialogs close on Escape, restore focus to their opener and trap Tab using only
currently visible controls, including summary elements. Binding capture retains
its own Escape and arrow handling. Disclosures use native details/summary.

The visual layer uses neutral charcoal surfaces with mint selection and gold
primary actions. Input labels are generally 13px or larger. Narrow viewport checks
include actual button contents, not only document horizontal overflow. Motion is
disabled when reduced motion is requested.

No runtime effects, extra shadow passes, heavy artwork, per-frame DOM measurement
or engine simulation work were added. Hiding a panel uses the existing renderer
resize behavior. It can increase canvas area and therefore rendering work; no FPS
improvement is claimed. The existing Performance graphics setting remains available.

## Preservation Boundaries

No recoil, impact coordinates, camera projection, movement, spread, armor/damage,
bot logic, native map data, selection weights, progression or saved result schema
is changed. Drill switching retains its existing per-mode spread recommendation.
Changing bot or route configuration retains its existing round-restart behavior.

## Verification

`tests/ux-workflows.spec.ts` covers drill search and switching, unchanged input and
loadout values, keyboard tabs, persistence, reset cancel/confirm, loadout categories,
advanced settings, focus view and desktop/mobile rendering. The explicit viewport
sweep covers 320x740, 393x800, 768x1024, 740x390, 1280x720 and 1440x1000.

Unit coverage checks complete nonduplicated drill and weapon inventories, skill
search, selected drill markup and the preserved setup controls. Existing browser
tests open the relevant new tabs/disclosures instead of assuming every control is
always expanded. Full checks and production smoke are required before delivery.

Final local results:

- `npm run check`: 3,528 tests across 173 files, TypeScript and production build passed.
- Final focused UI, settings, tips and changelog unit rerun: 50 passed.
- Desktop/mobile UX, input, persistence, tips, native Prefire and physical completed-run review browser regressions passed. The explicit responsive sweep passed all six viewports. Desktop-only lifecycle cases retain their documented mobile skips.
- Final production bundle smoke: 18 checks across all nine drills, no browser or asset errors. The smoke workflow explicitly opens the mobile Setup panel before inspecting route controls.
- Screenshot review caught and corrected a clipped phone Settings label, a missing accessible name on the compact tutorial action, and the entry button obscuring guided-spray aiming cues.
- Existing large-bundle warnings remain; no performance benchmark or exact CS2 parity is claimed. No deployment was performed.
