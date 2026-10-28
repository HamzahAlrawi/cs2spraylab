# Dust 2 Coverage, Controls And Reload Follow-up

October 19, 2026. Catalog `2026-10-19-coverage-v7`.

## Placement And Provenance

The catalog has ten approaches, 33 fixed lineups, 160 distinct hold identities
and 213 approach/hold assignments. No more than five opponents are active.
Existing OpenPrefire and retakes source coordinates remain unchanged.

`src/range/prefire/data/authored-dust2.json` explicitly identifies nine **local**
training positions, not upstream samples or measured competitive frequencies:

| Local ID | Purpose |
| --- | --- |
| `pit-slope`, `pit-floor` | Real Pit floor/slope rather than only its ledges |
| `car-front-edge`, `car-back-edge` | Separate Long-car exits |
| `a-ninja` | Crouched back-box/barrel tuck |
| `a-default-box-top` | Elevated A box watching Short |
| `a-short-box-edge` | Short-facing A box edge |
| `a-ramp-short-low`, `a-ramp-short-high` | Two elevations on A ramp watching Short |

The [Yprac callout radar](https://yprac.com/cs2-callouts-guide-radar-overviews)
was checked visually to identify callout families, not to derive coordinates.
Positions were surveyed and checked in the locally imported native geometry.
No radar image is bundled. Existing source attributions, licenses and the broad
regional-evidence limitations remain in `prefire-angle-sources.md`.

Map build **2000932**; native collision SHA256:
`395a10802ed5a26dce1c48b754adc7c2f1418755edc4f62c401597d19f7e6396`.
New numeric positions do not claim validation against a newer unimported map.

Fixed focus lineups are `long-pit-floor`, `long-car-variations`,
`catwalk-close`, and `short-a-ninja-ramp`. `short-site-entry` retains the old
five Short-site targets. The default Short lineup now includes early Catwalk.
Its player starts covered at `[200,160,8]`, before close Catwalk, and follows a
native-walked Top Mid connector. Earlier bad shortcuts through the wall were
rejected, not admitted by loosening geometry tolerances.

Both Pit-floor variants share a selection family. Front/rear car alternatives
share the corresponding existing family. Ramp elevations also share a family.
Duplicates therefore cannot multiply a corner's sampling weight or spawn on
top of one another. No invented encounter percentages were introduced.

## Admission And Facing

Strict pool generation checks exact horizontal placement/stance, native hull
clearance, dense standing/crouching spawn concealment with a 64-unit margin,
the first 32 units of movement, both-stance supported paths, the full-speed
movement motor, and standing-path head visibility before close contact.

Rejections remain meaningful: the low A-ramp hold is not admitted to Short
because its head is occluded; the front-car hold is not admitted to A-retake
because it is exposed at spawn. The bad elevator/B-window samples remain out.

Planner-facing regression tests found narrow native visibility windows between
coarse route samples. The planner now retains certified route-walk samples in
a WeakMap and refines pre-aim only when coarse samples find no sightline.
It walks terrain adaptively, including small legitimate wall slides, and keeps
interior samples only when the complete leg is supported and reaches its end.
Blocked chords/gaps cannot manufacture a watch point. Dense samples do not
expand the ordinary excursion candidate search or run on simulation ticks.
Plans remain in the existing bounded roster cache.

## Active Defenders

Generated move-outs now recover and re-peek instead of permanently parking at
their endpoint. Idle rechecks wait 0.7-1.8 seconds; recent-contact rechecks wait
0.4-0.95 seconds, with seeded variation. Explicit stationary holds remain holds.
Safe source-unlisted `moving`/`peek` hints can request motion without inheriting
an unrelated imported source index's behavior.

Fresh recognized contact can authorize a reversible, collision-checked local
pressure corridor. Sound can hasten a planned peek but cannot locate a hidden
player or authorize blind shooting. Perception samples and aim settling reuse
Duel helpers; actual movement, spread, recoil and damage use shared simulation.
See `prefire-active-bots.md` for evidence, braking and bounded-pressure details.
This is a training controller, not a claim of full human/Valve AI parity.

## Wheel-Jump And Reloads

Settings accepts Wheel Up/Down for one-shot actions, with conflict checks and
saved bindings. Native wheel events become single press edges, not held jump.
Inactive play and settings scrolling are preserved. Ctrl-crouch and Shift-walk
do not disable a bound jump during owned pointer capture; normal Ctrl+wheel
browser zoom remains untouched outside capture.

Reload timing evidence was refreshed separately against installed build
**2000933**, without game process access. AK ammo commits at the authored
1.10-second event, the attack gate is 2.466667 seconds, and the clip ends at
2.433333 seconds. Already committed ammo survives knife/back. Fire readiness
also respects draw and cycle gates; late switching can still be slower.
The retained postcommit attack floor is a conservative trainer policy: static
files alone do not prove live CS2 quick-switch/subtick transition semantics.
See `native-reload-timing-audit.md` for all 34 firearms and unresolved boundaries.

## Reproduce

```powershell
node tools/build-prefire-pools.mjs --save
node tools/audit-native-materials.mjs
node tools/build-prefire-pools.mjs --quality-output=research/dust2/requested-coverage/quality-v7-certified.json
node tools/validate-prefire-map.mjs --quality=research/dust2/requested-coverage/quality-v7-certified.json --artifacts=research/dust2/requested-coverage/quality-v7-certified.json.artifacts.json
node tools/audit-native-reload.mjs
npm run check
npx playwright test tests/wheel-controls.spec.ts tests/prefire-site-coverage.spec.ts --project=chromium
```

The quality certificate must be copied to the served map directory only after
the validator passes. It is expected to block a stale catalog; the initial
browser run correctly rejected the old certificate rather than silently
loading unverified positions. Research artifacts are local/ignored.

## Final Validation

- `npm run check`: 179 files / 3,677 tests passed; TypeScript and Vite build passed.
- Native map quality validator: passed with no errors, including the refreshed
  72-case material proof and all ten supported approaches.
- Fresh reload reproduction: all 34 firearms verified against installed static
  build 2000933; full proof is not shipped in the runtime bundle.
- Chromium: 12 browser checks passed, including persisted bindings, physical
  wheel-jumps, Ctrl/Shift combinations, native head hits and fixed lineups.
- Brave: all nine wheel-input checks passed. Opera GX: seven passed, including
  bindings, persistence and physical Ctrl/Shift jumps; two paused-settings
  scrolling checks remain failing. An isolated scrollable element works in the
  same Opera session, so this is not classified as general lack of runner
  scrolling support. Removing the gameplay listener, changing scroll layers,
  disabling overscroll containment and waiting for scroll-end did not fix it.
  Those experimental changes were removed. This compatibility issue remains
  open; native wheel events can also be non-cancelable in that runner.
- Production: all nine modes at desktop/phone sizes, 18 checks and no browser
  or missing-asset errors. Existing large-bundle build warnings remain.

These checks validate this browser trainer. They do not certify exact live
CS2 timing, animation graph transitions, competitive encounter probabilities,
or human-equivalent bot intelligence.
