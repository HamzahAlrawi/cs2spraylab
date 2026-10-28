# Native HE Blast Findings

Static audit of installed CS2 build **2000935**, 2026-10-27. No game execution, process inspection, hooks, DLL loading, native-code emulation, or app-code changes. Addresses below are **RVAs**, not runtime addresses. Function names such as `RadiusDamage` and `BodyTarget` describe their statically observed role; the retail binary does not supply those symbols.

## Verified Results

For ordinary HE creation with default native multipliers:

```text
initial damage D0 = 99
radius R = 350 native units
sigma = R / 3
blast damage B = D0 * exp(-(d*d) / (2*sigma*sigma)) * exposure
```

The exponential formula is verified in `server.dll`; the 99/350/1.2 values come from installed weapon resource data connected to the native field reads, not historical CSGO constants. This is damage before player rules, armor, and final health accounting. It is not a promise of a 99-point health hit at any particular ground distance.

**Important correction:** grenade `+0xa90` is damage; `+0xa84` is radius. The initial task description had those two labels reversed.

## Source Identity

- `server.dll` SHA256: `2a229dd46c8af0b52c1f49a3e343b99d9ffe946c102c56102a45b00f6a52349c`.
- Preferred image base: `0x180000000`.
- Installed `steam.inf`: client/server `2000935`, patch `1.41.9.2`, source revision `11162119`.
- Installed VPK `scripts/weapons.vdata_c` entry was read directly from archive 504, offset 37160448, length 26903. Its CRC32 and SHA256 match the existing extracted resource byte-for-byte.
- Existing decoded resource was parsed using `tools/kv3.mjs`; its hash matches the recorded decoder provenance. The decoder was not rerun in this audit.

Full fingerprints: [resource provenance](../research/native-he-resource-provenance.log).

## Field Mapping And Initialization

Native reflection field records use a 32-byte stride; the field offset is the uint32 at record `+16`.

| Owner | Field | Offset | Reflection record RVA |
| --- | --- | --- | --- |
| Grenade | `m_DmgRadius` | `0xa84` | `0x1e072d0` |
| Grenade | `m_flDamage` | `0xa90` | `0x1e07330` |
| Weapon data | `m_nDamage` | `0x820` | `0x1e14530` |
| Weapon data | `m_flArmorRatio` | `0x828` | `0x1e14570` |
| Weapon data | `m_flRange` | `0x830` | `0x1e145b0` |
| Player | `m_ArmorValue` | `0x1514` | `0x1da5c60` |

`0x3aac40` creates `hegrenade_projectile`. At `0x3aadb5`, the integer weapon damage is converted to float and stored to grenade `+0xa90` at `0x3aadda`. At `0x3aadde`, weapon range is loaded as float and stored to grenade `+0xa84` at `0x3aae0b`.

The two subsequent multiplications are:

```text
grenade.m_flDamage = float(vdata.m_nDamage) * sv_hegrenade_damage_multiplier
grenade.m_DmgRadius = vdata.m_flRange * sv_hegrenade_radius_multiplier
```

Handle RVAs: damage `0x1fb41d0`, radius `0x1fb41e0`. Registrations `0x5f450` and `0x5f4f0` both pass **1.0** to the float-convar registration helper `0x17ba40`; that helper stores the supplied default into registration metadata. These are compiled defaults, not a claim about an arbitrary running server's overrides.

The generic base-grenade constructor temporarily initializes **radius** (`+0xa84`) to **100** at `0x8c38e7`. That is neither the final ordinary HE radius nor evidence of 100 damage: HE creation replaces the radius using the weapon data above. The existing extracted HE block has `m_nDamage=99`, `m_flRange=350.0`, `m_flArmorRatio=1.2`.

Evidence: [initialization](../research/native-he-initialization-and-formula-helpers.asm), [reflection records](../research/native-he-damage-dispatch-and-schema-fields.asm), [decoded field neighbors](../research/native-he-radius-damageinfo-and-reflection.asm), [convar registrations](../research/native-he-convars-damageinfo-pawn-rtti.asm).

## Dispatch And Curve

1. `CHEGrenadeProjectile` RTTI primary vtable is `0x17ce4c8`; slot 318 (`+0x9f0`) is `0x3ab850`.
2. HE detonation calls `0x8c8cd0`. At `0x8c8da7`, it supplies damage type **0x40** to virtual `+0x998`, which resolves to `0x9c2640`, then the base explosion routine `0x8c9b50`.
3. `0x8c9b50` reads `+0xa90` damage and `+0xa84` radius, constructs damage info through `0xfbf400`, and dispatches virtual `+0x9f0` to `0x3ab850`.
4. `0x3abe25` calls `0xdf5970`; `0xdf5a62` tail-dispatches the global game-rules object's virtual `+0x1f8`.
5. `CCSGameRules` RTTI primary vtable is `0x18cad18`. Zero-based slot **63** is `0x95bcf0`, which clears the exposure-bypass argument and jumps to `0x95ad30`.

Damage-info `+0x44` is damage, `+0x12c` is radius. At `0x95b6b1`, the radius is divided by the float **3.0** from `0x178ae08`. Instructions then compute `-d*d / (2*sigma*sigma)`. `0x95b6da` calls IAT slot `0x1770e80`, verified by the PE import name as **`V_expf`**. The result is multiplied by damage at `0x95b6e4` and exposure at `0x95b6ea`. `0x525fb0` writes the resulting damage to the per-victim damage-info copy.

The early `D0/R` computation at `0x95afa4` is used later for force scaling. It is **not a linear health-damage falloff**.

Evidence: [game-rules RTTI](../research/native-he-gamerules-rtti.jsonl), [HE RTTI](../research/native-he-projectile-rtti-and-thunks.asm), [full radius routine](../research/native-he-radius-full-and-field-scan.asm), [damage-info setup](../research/native-he-radius-damageinfo-and-reflection.asm), [imports and blast type](../research/native-he-blast-type-bodytarget-exposure-sanity.log). Existing base-explosion and HE-dispatch logs named in the task remain unchanged.

## Actual Distance And Exposure

`d` is a **3D Euclidean distance**, not horizontal ground distance, distance to feet, or distance to a fixed chest point.

- `0x95afc6` adds **1 native unit to the explosion source Z** before the entity query and exposure work.
- At `0x95b506`, the victim's virtual `+0x630` is called with its fourth argument **true**. For `CCSPlayerPawn`, that virtual resolves to `0xce9290`.
- Its normal valid-handle path computes `BodyTarget = playerOrigin + transformedOffset * RandomFloat(0.7, 1.0)`. The offset input is `player+0x818`, processed by `0x158e20`; this audit does not assume a universal fixed offset height. The random import is confirmed as `CUniformRandomStreamImpl<CAtomicMutex>::RandomFloat` through `0x168c641` / IAT `0x17704a0`.
- If that handle is unavailable, `0xce93b4` falls back to virtual `+0x2c8`. This is a separate target-point path.
- `0x95b63d` through `0x95b69e` subtract the selected source from the saved body-target point, square all three components, and take the square root.
- The ordinary starting source is the shifted explosion origin. If exposure is below 1 and the entity permits the alternate-source path, `0x95b575` onward evaluates alternative sources returned by `0x910990`, retains a better exposure/source, and uses that chosen source for distance. Full alternate-source generation was not decoded.

Player exposure at `0x92bf80` uses five sample-helper results:

```text
E = 0.4*T(BodyTarget(false)) + 0.2*T(origin + (0,0,71)) + 0.2*T(origin)
  + 0.1*T(sidePointA) + 0.1*T(sidePointB)
```

The weighted exposure call uses `BodyTarget(false)`, distinct from the random-flag body target saved for distance. The side offsets are derived from orientation with a 16-unit scale and body-target height. The helper `0x92d1c0` is **not just binary world LOS**: it has clear, blocked, and fractional obstruction branches, including a 0.75 fallback and a branch involving a queried property divided by 3000. The semantic identity of that property was not established. Treating E as five boolean rays would still be an approximation.

Candidate selection uses the radius in an entity-shape query (`0x490900`, `0x536fb0`, `0xbe1d60`, `0xbfd400`, whose embedded name is `EntitiesInShape`). The audited damage loop has **no explicit `d > R` rejection or radial damage clamp**. This does not prove infinite blast reach: exact shape-overlap/candidate boundary behavior is unresolved, and cannot be replaced with an asserted point-distance cutoff.

Evidence: [exposure weighting](../research/native-he-exposure-and-schema-xrefs.asm), [body target, random import, obstruction helper](../research/native-he-blast-type-bodytarget-exposure-sanity.log), [full source-selection loop](../research/native-he-radius-full-and-field-scan.asm).

## Armor

The player damage gate is statically connected through `0x3f3ae0` -> pawn virtual `+0x400` (`0xb6c710`) -> virtual `+0x7f0` (`0xae08c0`) -> damage service `0xa99640` -> armor routine **`0xa8e500`** at `0xa99a38`.

Armor eligibility checks damage type, an armor-bypass flag at bit 18 of damage-info `+0x70`, positive armor, and `0xad7ba0`. For ordinary HE type `0x40`, the hitgroup argument stays 0, whose jump-table entry accepts armor without a helmet check. This establishes that ordinary HE armor protection does not require a helmet; it is not a general claim about all other damage types or modes.

`0xa8e597` starts the health ratio at **0.5**. For blast, `0xa8e5ba` invokes game-rules virtual `+0x110`; `CCSGameRules` points that slot to `0xe891c0`, which returns true, selecting armor-cost factor **1.0** instead of the non-selected 0.5 branch.

`0xa80120` resolves the source item/data; its grenade path uses projectile item identity at `+0xb0e`. If blast item resolution is missing, `0xa8e61e` onward explicitly looks up a schema handle whose string is **`weapon_hegrenade`**. With valid resolved data, `0xa8e69f` multiplies the initial 0.5 by weapon-data `+0x828 = m_flArmorRatio`, so the installed HE ratio is **0.6** (subject to float32 arithmetic).

For nonnegative incoming damage B and integer armor A, ordinary eligible HE with valid 1.2 armor-ratio data simplifies to:

```text
H = B * (0.5 * 1.2)
C = (B - H) * 1.0
if C > A:
    H = B - A / 1.0
    C = float(A)
    A_after = 0
else:
    A_after = A - trunc(C)
reported armor consumption = trunc(C)
damage-info damage = H
```

The native code computes `B-H`, not an independently rounded `B*0.4`; preserve operation order for float32 boundary tests. If weapon-data resolution fails completely, it retains the initial 0.5 health ratio rather than inventing 1.2. Other damage types have extra factors, including a 20.0 branch, outside the ordinary HE simplification.

The comparison with available armor occurs **before** truncation. The sufficient-armor branch subtracts `cvttss2si(C)`; fractional armor consumption is not carried forward here. Example mathematical checks, not native execution:

| B | A | H before final health accounting | A after |
| --- | --- | --- | --- |
| 99 | 100 | 59.4 | 61 |
| 99 | 39 | 60 | 0 |
| 10 | 3 | 7 | 0 |
| 2 | 1 | 1.2 | 1 |

Evidence: [armor arithmetic](../research/native-he-armor-math.asm), [armor-ratio resolution, fallback name, eligibility jump table](../research/native-he-armor-provenance-helpers.asm), [player damage entry](../research/native-he-player-damage-entry.asm), [damage gate](../research/native-he-radius-damageinfo-and-reflection.asm).

## Unresolved And Implementation Limits

- Exact shape-query boundary and which entity hulls intersect it; do not assert that all victim body points beyond 350 are excluded.
- Full alternate-source generation and material/property semantics in the obstruction helper.
- Bit-exact native RNG, transformations for every stance/model, and imported `V_expf` implementation. Ordinary mathematical `exp` samples are not bit-exact native results.
- Final integer health/event rounding, prior fractional-health state, friendly-fire scaling, immunity/special-mode branches, and health clamping. `0x3f40c4` onward visibly consults player fractional state at `+0x2dc`; a fresh independent round per grenade is not established by this audit.
- Runtime overrides and map-specific behavior were not inspected. The values here are compiled/resource defaults, not observed server state.

For implementation, the curve and ordinary armor branch can be tested independently now. A deterministic chest point, binary LOS, simplified candidate cutoff, or independently rounded health should remain explicitly labeled training approximations.

Numerical curve samples in [the static sanity log](../research/native-he-blast-type-bodytarget-exposure-sanity.log) use E=1 and the given d: at d=0, B=99; at d=100, B~=68.564363; at d=200, B~=22.776564; at d=350, B~=1.099791. The last value evaluates the equation only, not candidate eligibility.

## Reproduction And Validation

Read `AGENTS.md`. Used existing `tools/audit-native-grenade-code.py` with the Blender 5.2 Python interpreter and bundled `pefile`/Capstone dependencies, plus read-only PE reflection/import inspection, direct VPK parsing, and arithmetic sanity calculations. Useful audit invocations:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' tools/audit-native-grenade-code.py --module server --classes --class-filter '^\.\?AVCCSGameRules@@$'
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' tools/audit-native-grenade-code.py --module server --rva 0x95ad30 --size 0xfc0
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' tools/audit-native-grenade-code.py --module server --rvas 0x3aac40
& 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' tools/audit-native-grenade-code.py --module server --rva 0xa8e500 --size 0x300
```

The auditor's exception-directory range for `0x95ad30` covers only its prologue. Explicit `--size` is needed for split-unwind functions. Raw member scans may report alternate/misaligned decodes; only instructions on the traced function paths support conclusions. Some linear listings extend into padding, neighboring functions, or jump-table data; those bytes are not treated as executed control flow.

No `npm test`, `npm run build`, or `npm run check` was run: this request explicitly limited tools to static-file research, and no application code was changed. No ZIP was created. New files are only `research/native-he-*` evidence logs and this findings document; unrelated working-tree changes were left untouched.
