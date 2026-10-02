# Local Progression Economy

Version 2 is stored under the existing `spraylab.progression.v1` browser key. XP, wallet, owned IDs, equipped choices, completion counters and claimed milestones are persisted together. A future-version save is preserved; unavailable storage falls back to this session. This is not server-secured or shared across devices. Credits have no real-world value and cosmetics are not CS2 inventory items.

The Armory also includes 42 permanent [achievements](achievements.md), persisted with the same profile. They recognize combat, technique, drill, collection, and career goals without adding currency or changing the economy.

## Earning And Spending

AI Duel remains the main source. Its validated XP formula considers coaching score, win/loss, difficulty, actual opposition defeated/damaged, armor, accuracy and player health. Ordinary credits are `floor(XP * 0.6)` for duels and `floor(XP * 0.35)` for drills, additionally capped at six credits per simulated active second. Idle/paused/review time cannot increase XP; extra time only stops a very fast round from exceeding the cap. Milestone awards are separate one-time bonuses.

There are ten level milestones at levels 10..100, awarding `level * 150` credits. Qualifying-completion milestones at 25, 100, 500, 1000, 2500, 5000 and 10000 attempts award 250, 1000, 4000, 7500, 12500, 20000 and 35000 credits. Their combined lifetime bonuses total 162,750 credits. A reset, abandoned round, impossible result, settings change, no-engagement result or duplicate completion is not a qualifying completion.

Level gates only make an item purchasable. Purchases atomically debit the wallet and add ownership; repeating a purchase never debits twice. Purchase does not auto-equip. Stock items are always free. Cosmetic equipment never modifies weapon stats, collision, health or rewards. Level 100 requires 357,885 XP; earning and spending continue after reaching it.

### Duel Difficulty Weighting

Each bot's difficulty is `0.4 + (skill - 1) * 0.15` for levels 1..10, and `2.0` for `10+`. Previously it was `0.7 + (skill - 1) * 0.075`, with `10+` at `1.5`. The per-level slope is doubled; level 5 remains neutral at `1.0`. Easier bots pay less and harder bots pay more on both wins and engaged losses. Losses never subtract XP or credits.

The remaining formula is unchanged:

```text
threat = difficulty * min(1, botHealth / 100)
         * (botArmor ? 1 : 0.8) * min(1.15, botAccuracy)
engagedThreat = sum(threat * min(1, healthDamage / botHealth))
opposition = engagedThreat / max(1, sum(threat))^0.38
XP = floor((55 + 95 * score / 100) * opposition
           * outcome * min(1, 100 / playerHealth))
outcome = 1.2 for wins, 0.65 for losses, 0.75 for draws
```

A null coaching score counts as zero. At score 75 against one 100-HP armored bot with accuracy 1 and player health 100, wins pay 60 / 151 / 214 / 232 XP at levels 1 / 5 / 10 / 10+. Losses with 50 damage pay 16 / 41 / 58 / 63 XP respectively. The `10+` versus level-1 win differential is about 3.87x, previously about 1.83x. These are formula examples, not claims about measured CS2 difficulty. Multi-bot rewards still use each bot's actual damaged-health fraction and the same roster denominator; untouched opponents cannot inflate a reward. Health, armor, accuracy, score, outcome, lifecycle validation and all anti-farming caps are unchanged.

### After Level 100

The displayed level stops at 100, but stored XP continues up to `MAX_XP` (100,000,000). Ordinary credits always use the full evaluated attempt XP, not the amount that can still fit in stored XP. Therefore repeated qualifying duels and drills keep paying even when stored XP is already capped; notifications then show zero added XP and positive credits. Qualifying-completion milestones can still pay after level 100, while previously claimed level/completion milestones never repeat.

Focused regression tests cover repeated duel/drill rewards at the exact level-100 threshold, above that threshold, and at `MAX_XP`, including reload, replay rejection, spending earned credits, continued earning and ledger consistency. Credit rewards remain limited to six per simulated active second, wallet headroom (100,000,000 credits) and lifetime-earned counter headroom (1,000,000,000,000 credits). Reaching a wallet or lifetime counter cap can stop credit gains; reaching level 100 or the XP cap alone cannot.

## Catalog And Pacing

- 300 firearm finishes: ten per firearm, priced 350 / 700 / 1200 / 1900 / 2800 / 4000 / 5500 / 7500 / 10000 / 13000 credits. Eligibility levels: 2 / 4 / 7 / 12 / 18 / 26 / 38 / 52 / 70 / 90.
- 557 native knife choices across all 20 special families plus stock T: 3,500..89,000 credits. Stock CT knife remains free.
- Eight native glove families: 15,000..60,000 credits.
- Six native bot agents: 4,000..12,000 credits.

The expanded catalog costs 24,778,900 credits in total. Even at the ordinary-credit ceiling, buying every item requires more than 1,139 active hours after all milestone bonuses; real collection time will be longer. This is a formula-derived estimate, not a measured retention claim. The old ten-knife catalog cost 2,183,000 credits and its 200..500-hour estimate no longer applies after adding all supported native pairings. Individual favorites remain purchasable much earlier. New-user hints, the wallet, collection count, scoped knife shop, price/level filters, milestone progress and purchase confirmation make goals visible. Further catalog-wide pacing should be tuned using measured play sessions, not by silently changing combat XP.

## Migration And Limits

Version 1's eleven previously earned implicit finishes remain owned; previously equipped/retired choices remain saved. New catalog items do not become owned merely because an old user has a high level. Old levels do not retroactively pay milestone credits. Wallet and counters are finite/capped, purchases cannot go negative, attempts settle once, and malformed imported saves are sanitized.

The browser-only architecture cannot prevent a user editing their own localStorage. Do not describe this as cheat-proof or a transferable economy. Native materials are simplified factory-new approximations, not Valve's full wear/seed compositor. The source license does not grant redistribution rights to extracted Valve assets.
