# Damage tagging audit

Date: 2026-09-29. Scope: non-lethal bullet and practice-knife hits in AI Duel.

## Sources and verification

- Installed CS2 build **2000919**, `game/csgo/bin/win64/server.dll` SHA256
  `f95fe0dcd7b526137a8b305dd76a72f624e0508ad42bb5949d05c77a37e1bd70`.
- `tools/import-tagging.mjs` exports the two flinch fields and held-weapon
  movement speed from `scripts/weapons.vdata_c`. The raw export SHA256 and build
  are saved in `src/range/tagging-data.json`. The import fails if movement speeds
  differ from the separately audited equipment data. Existing recoil provenance
  remains unchanged; this is not a new recoil audit.
- Read-only static disassembly identified application at RVA `0xab2960`, stack
  recovery at `0xac3a40`, and grounded movement recovery at `0xad7d61`. The damage
  caller reads large/small flinch fields together, NOT by body region. The
  damage-dependent adjustment belongs to grenade-projectile damage, not bullets.
- `tools/verify-tagging.py` emulates those arithmetic routines offline using
  Unicorn, with lookup, ConVar and notification calls stubbed. It refuses a DLL
  hash mismatch. `tagging-native-fixture.json` records single and successive hits
  for six attacker/held-weapon combinations with twelve 128 Hz ticks between
  hits. Vitest compares the implementation to those results within float32
  tolerance. No game process is opened, hooked or modified; no DLL is shipped.
- Valve's [official tagging explanation](https://steamcommunity.com/sharedfiles/filedetails/?id=412879303)
  provides historical context for weapon-dependent, cumulative slowdown and
  grounded recovery. Its 2015 numeric examples are NOT current-CS2 fixtures.

## Implemented model

With native flinch fields `L`, `S`, existing stack `F`, and the victim's held
weapon speed `v` in Source units/second, default `mp_tagging_scale = 1`:

```text
F = min(F, L, L - (1 - F) * S)
mobility = 0.08 + 0.8 * max(0.15, (v - 120) / 130)
floor = max(0.2, (1.2 * min(1, (v - 80) / 170) - 0.08) * 0.25)
hitModifier = clamp(F * mobility, floor, max(L, 0.65))
velocityModifier = min(velocityModifier, hitModifier)
```

Every simulation tick, stack approaches one at `0.35 / second`, bounded to
`[0.1, 1]`. The stack may briefly fall below zero on a hit; clamping it early
would differ from the native routine. The velocity modifier separately
recovers at `0.4 / second` while grounded, capped at one. There is no invented
post-hit hold timer. Airborne hits retain the modifier for landing; they do not
cut jump height or horizontal air velocity. Armor and body region change damage,
not the bullet tagging formula.

The shared movement kernel uses the modifier to reduce grounded wish speed
and acceleration and cap existing horizontal momentum. Walk/duck caps still
apply. Untagged movement is unchanged. Both player and bot use identical state,
with actual velocity feeding animation, footsteps and shot inaccuracy.
Only physically resolved, non-lethal damaging hits apply it. Misses and cover
do not. Equipment changes retain it, pause freezes it, new actors reset it.

For example, the native arithmetic gives a single AK hit on an M4A4 holder a
`0.29046` modifier, recovering to one in about `1.77 s` of grounded simulation
without more hits. Repeated hits reach the mobility-dependent floor, not zero.

## Limits

The **tagging arithmetic** is pinned to this installed build. Full native
movement, friction/acceleration ordering, collision, jump subticks and network
prediction have not been measured end-to-end against a live CS2 session. The
browser retains its existing fixed-step movement model. This does not claim
perfect engine parity. Grenades, wall penetration, native aim flinch and native
melee damage are outside this change. Non-combat range targets remain training
targets rather than damageable Duel actors.

## Reproduction

```text
node tools/import-tagging.mjs
python tools/verify-tagging.py
npm run check
```

The import requires the local Source2Viewer CLI and CS2 installation. Offline
verification requires Python with `pefile` and `unicorn`; it never launches CS2.
