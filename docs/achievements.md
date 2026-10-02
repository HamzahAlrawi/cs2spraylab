# Achievements

The Armory has 42 permanent badges across combat (16), technique (3), training (14), collection (6), and career (3). Each shows its requirement and progress; filters show category, earned/in-progress state, nearest goals, and recent unlocks. Earned badges include a local date. Achievement toasts are nonblocking, remain readable for eight seconds, survive rapid subsequent round rewards, and can open the achievement view directly.

## Result Integration

Achievement statistics live in the existing version-2 progression profile under `achievements`. Duel and drill statistics update only after the controller validates a completed result and consumes its one-use attempt token. Abandoned/reset/reconfigured/invalid/no-engagement attempts cannot award badges. Qualifying losses contribute kills/headshots and reset the qualifying-win streak. A nonqualifying attempt is not part of that streak. Purchases award collection badges only after the wallet debit and ownership succeed. Stock, unknown, and retired catalog IDs do not count as current collection items.

The existing DuelCoach review supplies headshots, health damage taken, settled-shot percentage, airborne shots, and moving shots. Optional metrics absent from old result producers are not inferred. The settled-fire badge checks that these metrics agree. The range uses its existing validated per-mode success result, so this feature does not change recoil, movement, targeting, scoring, or physical bullet coordinates.

Hard-opposition badges require gun-equipped bots, armor, at least 100 bot HP, at least 100% bot accuracy, and player HP no higher than 100. Every opponent must meet the advertised difficulty for level-5/10 wins. The five-bot badge requires defeating the full five-opponent roster. Low-health or weakened bots cannot pad those challenges. These are local trainer achievements, not certifications of a real FACEIT rank.

## Persistence And Economy

This is an additive version-2 field, not a profile reset. Existing XP, balances, owned cosmetics, and equipped choices remain unchanged. Old saves can prove their player level, current collection, and total qualifying drill completions, so those badges are recognized without replaying notifications. Such badges use timestamp zero and show "Earned previously." Old saves cannot prove victories, headshots, streaks, or which drills were completed: these start collecting from this update onward. Reloading never replays achievement awards. Earned known badges remain earned if a catalog later changes.

Badges do not add XP or currency, change weapon stats, or unlock cosmetics automatically. Existing credit and milestone pacing remains intact. Achievement data is bounded and sanitized; unsupported future saves remain untouched, and blocked storage uses session-only progress. Like all existing frontend-only progression, this is local to the browser and is not protected against localStorage editing.

Checks: `src/range/achievements.test.ts` covers thresholds, result validation, idempotence, caps, migrations, purchase integration, and accessible markup. `tests/achievements.spec.ts` checks filters, persistence, and desktop/mobile sizing. The completed-combat browser regression additionally verifies actual DuelEngine events award badges once and that the toast opens the achievement view.
