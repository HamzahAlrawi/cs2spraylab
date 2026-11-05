# Cover discipline and reward experience

## Scope

- Level 6 through 10+ bots check a conservative whole-body envelope when waiting or resetting, rather than treating a hidden eye position as full cover. Beginners retain imperfect cover use.
- Checks use perceived/remembered threats or authored approach points. They never read an unseen player's live position. Intentional head-only holds remain valid; active combat is not interrupted by the waiting-cover policy.
- Local correction tries at most twelve candidates per stance, at most twice per policy check. Checks are staggered and cached for 400-500 ms; there is no new per-frame navigation search. Movement remains ordinary shared-physics input, not teleportation.
- Supported native-map feet come from the movement hull's vertical query, not a visual/bullet floor ray. Unsupported or unreachable destinations are rejected. Safe low cover can request crouching; unusable static cover prompts relocation.
- Precise covered arrivals and reload destinations use tighter tolerances to avoid stopping with a shoulder exposed.

This is an authored training-bot policy, not a claim of native CS2 AI parity. The body envelope is conservative cover evaluation only, not a change to hitboxes, recoil, aiming coordinates, or map collision. Native fixtures require locally extracted assets and skip in lean source checkouts. The CT-to-Mid regression checks the current collision resource identified by the chunk's manifest; it is map-query validation, not measured gameplay parity.

## Progression

The Armory opens on an overview of the wallet, next milestone, nearby achievements, and relevant finishes. Finish details distinguish level eligibility, credit funding, purchase, ownership, and equip actions. Existing purchase confirmation and backup/gift tools remain available.

Achievements increase from 42 to 172. Original IDs remain unchanged. New tier goals reuse saved counters where available; new skill counters begin with future observed results, not invented past history. Badges do not silently award extra currency or XP. Profile schema and storage keys are unchanged.

Level-ups show the actual earned rank, XP and credits with bounded CSS effects. Click/Escape dismissal is allowed after 500 ms; automatic dismissal occurs after 4.4 seconds. The reveal does not capture pointer lock, consume gameplay clicks, or re-award currency. Reduced-motion preferences disable the effects. There are no paid spins, random prizes, or near-miss outcomes.

## Practice ammo

All non-Duel shooting practice uses unlimited reserves, normal magazine sizes, and the existing reload state machine. Bullets are not restored while firing. Shell reloads, commit timing, cancellation, switching and readiness remain unchanged. Prefire grants unlimited reserves only to the player. AI Duel and enemy reserves remain finite. HUD reserve counts show infinity in practice.

## Verification

- Full unit suite and production build, plus focused cover, combat-continuity, reload, save compatibility, achievements and progression tests.
- Real extracted CT-to-Mid collision witness: an eye-hidden shoulder leak now has a reachable, hull-supported, body-safe retreat.
- Chromium desktop/mobile Armory purchase/equip and achievement tests, responsive screenshots at 320/390/844/1440 pixels, reduced-motion verification, exact 499/500 ms skip boundary, and unchanged wallet after skipping.
- Guided Deagle browser exercise checks shooting, normal reloads, unlimited-reserve HUD, switching and nonblank rendering.

No new game assets are included. No deployment is performed by this iteration.
