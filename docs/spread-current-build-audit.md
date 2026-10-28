# Current-Build Spread Audit

Audit date: 2026-10-12. Read-only installed artifacts and isolated arithmetic;
no DLL loading, game process access, hooks or live-game inputs.

## Fresh Data

`python tools/verify-native-accuracy.py --stats` freshly decompiled the installed
`scripts/weapons.vdata_c`. All 2,030 primary/alternate comparisons across 35
weapons match the stored runtime data, including spread, standing/crouching/
moving/firing/jumping/landing inaccuracy, recovery and recoil parameters.

- Installed build: **2000930**.
- Client SHA-256: `44af2aa0d2c64f90d273444cb393b8b679094f0b02136dbdb89d4ec82a560008`.
- Fresh resource SHA-256: `46e7a84b46c620e8daf11c403ee9152a5faa1a033407748b527862aa3147236b`.
- Stored resource provenance remains build 2000924; identical checked fields do
  not establish that all native state-machine code stayed unchanged.

The existing hash-pinned native accuracy verifier passes 130 movement-remap,
105 recovery-time, 80 penalty-recovery, 25 landing and 15 firing-addition cases.
The movement cutoff uses float32 horizontal speed at 34% of current weapon
speed; above that, running uses the inspected fourth-root remap, walking the
linear remap. The latest shot telemetry uses actual speed and grounded state.

## Newly Inspected Sampler

The current sampler was located through references to float32 `2*pi` at RVA
`1b00584`, then inspected at `d235a0..d238c4`:

- `d235b6..d235d3`: draw inaccuracy radius then angle in `[0, 2*pi]`.
- `d23624..d23633`: R8 alternate inaccuracy radius becomes `1-r*r`.
- `d23683..d236ab`: early Negev radius uses repeated squaring then `1-r`.
- `d236be`: multiply the radius by supplied inaccuracy exactly once.
- `d2370d..d2372d`: ordinary spread draws radius then angle independently.
- `d23780..d2381d`: corresponding R8/Negev spread-radius transforms.
- `d23844`: multiply spread radius by supplied weapon spread exactly once.
- `d2384e..d238af`: add the two cosine projections horizontally and the two
  sine projections vertically. There is no square-root area sampler, doubled
  random cone or extra difficulty multiplier in this slice.

`tools/verify-native-spread.py` emulates only that inspected range with a strict
current-client hash and instruction/path budget. The weapon-definition cache,
pattern-off flag, one-pellet loop and uniform draws are explicit fixture inputs.
Only the manager accessor and RNG/trigonometric imports are stubs; no unverified
native execution or operating-system import is allowed.

Twenty-four independently generated cases cover AK ordinary sampling, R8
primary/alternate, and Negev indices 0, 0.5, 1, 2 and 3, using zero, near-edge and
ordinary draws and several coefficient sizes. `native-spread.test.ts` compares
the runtime sampler to those native outputs within `2e-8` absolute slope error
and asserts exactly four draws. All cases pass. No gameplay value was retuned.

## Why A Correct Shot Can Miss

For a recovered AK-47 at rest, the extracted standing inaccuracy is `.00641`
and spread is `.0006`; crouching uses `.00481` inaccuracy. At 20 m, the theoretical
maximum random displacement is approximately 14.02 cm standing or 10.82 cm
crouched. This is the maximum slope sum, **not** typical error, an accuracy
circle diameter or a guarantee every shot lands that far away.

Running just above the accuracy cutoff, rapid repeat fire, landing, retained
recoil and unscoped sniper mode legitimately increase error. Recoil and external
damage punch are independent from this random cone. Prefire/Duel use the same
physical sampler and do not apply bot-skill scaling to weapon spread. Camera
centering and physical impacts remain separate regression contracts.

## Limits And Reproduction

Uniform draws are supplied, not captured native command/subtick seeds.
Python/JavaScript trigonometry substitutes are not native `V_sinf`/`V_cosf`.
This new fixture checks the pattern-off single-pellet sampler; shotgun tables
retain their older separately pinned verifier, whose current-build hash guard
must not be bypassed. Full native firing, animated stance timing, quaternion
camera interpolation and end-to-end live-CS2 impacts are not reproduced by
these checks. Thus this establishes checked data and sampler arithmetic, not
bit-for-bit live-engine parity for every mechanic.

```powershell
python tools/verify-native-accuracy.py --stats
python tools/verify-native-accuracy.py
python tools/verify-native-spread.py
npm test -- --run src/range/native-spread.test.ts src/range/native-accuracy.test.ts src/range/shot-model.test.ts src/range/duel/weapon-state.test.ts
```

Focused result: **545 tests / four files passed**. The spread fixture is
regenerable with `--write` only after inspecting a supported build. The full
integration results are recorded in `prefire-map-case-study.md`.
