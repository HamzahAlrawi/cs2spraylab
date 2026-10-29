# Manual Duel Lineups

1. Choose AI Duel, open Setup, and select a real Dust 2 chunk under Arena.
2. Open Manual lineups and enable Walk mode. Enter using Walk map.
3. Stand at the desired player entry and aim along the intended approach. Press Escape,
   then Capture entry. Remain standing; airborne/crouched captures are rejected.
4. Resume walking. Stand at a bot hold and face the angle it should initially watch.
   Press Escape and Add hold. Repeat for up to five bots. Each capture records feet and view.
5. Name the lineup and individual holds, then Save. Use lineup starts a new normal Duel.
6. Curated returns to the standard course without deleting your saved work. Walk mode
   disables bot combat, scoring and XP; it does not change the regular movement kernel.

Capture is available only after the native chunk is ready. Recapture updates a specific
point; removing points or saved lineups is explicit. A lineup cannot use overlapping hulls,
unsupported floors or points beyond the chunk. Intentional spawn-to-spawn sightlines require
Allow immediate sightlines. Geometry changes require recapture rather than silently moving points.

Saved lineups live at `spraylab.duel.manual-spawns.v1` on the current browser origin. They do not
sync between localhost and production. Export makes a JSON backup of the current chunk's
lineups; Import merges by chunk/id without replacing unrelated setups. Limits: 64 lineups total,
12 per chunk, five bots per lineup, 192 KiB per library. Invalid imports leave saved storage intact.

Coordinates are trainer world metres (y-up), not radar pixels: Source x becomes x*0.0254,
Source z becomes y*0.0254 and Source y becomes -z*0.0254. Yaw/pitch are radians. Chunk ID and
collision SHA-256 bind the exact geometry used for validation. The library is suitable for
sharing curated setups but is not evidence of measured player-position frequency.
