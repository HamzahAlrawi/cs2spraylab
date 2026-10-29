export type ChangelogSection = {
  id: string;
  title: string;
  items: readonly string[];
};

export type ChangelogRelease = {
  id: string;
  title: string;
  baselineCommit: string;
  sections: readonly ChangelogSection[];
};

const october23Changes = {
  id:'update-2026-10-23',
  title:'Combat feedback & map delivery (October 23)',
  baselineCommit:'af175145e581bd4cc853440af1a529856f0a5057',
  sections:[
    {id:'verified-map-delivery',title:'Reusable map downloads',items:[
      'Dust 2 chunks share content-addressed texture bundles and verified compressed resources, with bounded browser caching and low-priority preparation of the next round.',
      'Native visibility reduces off-screen map rendering. Round data loads per chunk, detailed skin data loads on demand, and entry waits for the selected weapon, actor rig and required shaders.',
    ]},
    {id:'combat-timing',title:'More consistent shot timing',items:[
      'Duel shots sample scheduled firing time, recovery and actor poses within each simulation step. Range guidance follows the same recoil clock; R8 alternate fire no longer rounds its cadence to whole ticks.',
      'Mixed shotgun hits retain individual aim-punch contributions. Native-map tactical roles and approach comparisons use local geometry instead of absolute world-coordinate signs.',
    ]},
    {id:'hit-death-feedback',title:'Hits, headshots & body contact',items:[
      'Distinct native hit and kill audio covers flesh, armor, heads and helmets, with attacker/victim layers and corrected M249 reload cue timing.',
      'Hit reactions use extracted native flinch layers sampled on the shot/render pose clock without accumulating offsets. Deaths retain impact direction, head/body impulses and native-map corpse contact; body impacts play speed-scaled game samples.',
      'Real-map sound routing uses a bounded navigation-derived doorway path shared by AI hearing and playback. Motion transitions, ragdolls and acoustic propagation remain trainer approximations, not the complete Source 2 engine.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october26Changes = {
  id: 'update-2026-10-26-utilities', title: 'Smarter opponents & utilities (October 26)',
  baselineCommit: 'af175145e581bd4cc853440af1a529856f0a5057',
  sections: [
    {id: 'bot-decisions-vision', title: 'More deliberate opponents', items: [
      'Combat and recent re-peek evidence take priority over routine scanning and route steering. Scoped vision has horizontal and vertical bounds, with weapon-aware exposed-part aiming and explicit firing-veto diagnostics.',
      'Threat-aware reload cancellation and loaded sidearms respect ammo commit and deploy timing. Progress-aware travel recovery distinguishes blocked routes from deliberate angle holds; persistent personality variation retains skill-specific peek limits.',
      'Sight and utility decisions use observed information, not hidden player positions. These policies are trainer heuristics, not measured FACEIT population data.',
    ]},
    {id: 'playable-grenades', title: 'Grenades in Duel & Prefire', items: [
      'Four-slot loadouts support HE, flashbangs, smoke, Molotovs, incendiaries and decoys, with two-flash and fire-grenade limits. Grenade selection, full throws, lobs, positional native sounds and bounded rendered effects work on desktop and touch.',
      'Smoke affects player and bot sight, extinguishes floor fire and supports temporary bullet/HE openings. Flashes respect facing and cover; HE damage respects cover and armor. Utility damage does not inflate gun accuracy or reward self-damage.',
      'Duel bots prepare utilities from sensed contact, react to seen flashes and leave burning ground. Fire durations, range limits and tick damage use installed convars; grenade trajectories, smoke rendering, blast falloff and tactical choices remain browser approximations.',
    ]},
    {id: 'native-grenade-presentation', title: 'Native grenade models & hands', items: [
      'Native models replace the placeholder shapes, with textured hands, equipped gloves, draw/inspect/pin/throw tracks and correctly anchored bot grips.',
      'Flying grenades retain their own shape without attached pins or lighters. Models are compressed, cached locally and prepared before entry; Source 2 lighting and utility effects remain browser adaptations.',
    ]},
    {id:'complete-utility-loop',title:'Grenade pickups & fight review',items:[
      'Drop and recover carried grenades with shared inventory limits, grounded native loot and through-wall pickup protection. Deaths drop a carried item or release a live primed grenade.',
      'Fight review records grenade flight, bounces, smoke/fire, temporary openings, flash exposure and pickups. Paused and backward seeks use absolute recorded clocks without changing the live inventory.',
    ]},
    {id:'environmental-utility-actions',title:'Environmental smoke & native action cues',items:[
      'Connected smoke cells fill around openings without crossing sealed walls. Native smoke/fire/flash textures replace primitive effects, with fixed instance budgets and shared sight/interior membership.',
      'Draw and pin readiness use installed weapon data and animation graph completion rules. Native action sounds follow the same clock and cancel on interruption; flash exposure muffles audio.',
      'Dust 2 grenade-only clip geometry and grenade masks are separated from player movement. Independently authored utility setups are trajectory-tested against each chunk; native physics, shaders and smoke are still browser adaptations.',
    ]},
    {id:'contextual-team-policies',title:'Shared combat policies & team setups',items:[
      'Duel and Prefire share threat-aware reload/sidearm and utility policy gates. Allied utility reservations prevent duplicate setups and release supporting peeks after the actual detonation.',
      'Expiring passage reservations, persistent flank plans, correlated personalities and context-specific aim motors improve congestion recovery and decision continuity without changing player movement or bullet coordinates.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october23PreloadingChanges = {
  id:'update-2026-10-23-preloading',title:'Ready rounds & more Dust 2 angles (October 23)',
  baselineCommit:'af175145e581bd4cc853440af1a529856f0a5057',
  sections:[
    {id:'prepared-local-maps',title:'Prepare the next fight',items:[
      'Capable devices now prepare one complete next chunk during play, including collision, texture/vertex uploads and shaders. Low-memory devices keep a lighter download-only preload; data-saving preferences and cancelled sessions stop background work.',
      'Visited resources persist locally within a quota-aware disk budget separate from RAM. Collision worlds are built in a worker and cached locally for compatible future visits, without extra snapshot downloads.',
      'Dust 2 coverage grows to 197 unique validated holds across ten approaches, including seven reviewed positions from public combat-coordinate data. Existing lineups and the five-bot budget stay unchanged; combat frequency is not used as holding odds.',
    ]},
    {id:'sampled-shot-motion',title:'Shots and movement poses',items:[
      'Range origins, running accuracy and moving targets sample scheduled firing time too. Combat recovery samples the firing stance before completing the remaining movement interval.',
      'Native locomotion blends starts, stops, reversals and crouching with short bounded foot-contact correction. Repeated shot/render pose samples share transition history rather than advancing animation independently. These blends remain trainer adaptations.',
    ]},
    {id:'source-audit-safety',title:'Current-source checks',items:[
      'Weapon and reload checks now require fresh native exports instead of accepting stale files after a parser failure. Current static weapon fields are verified separately from historical native arithmetic fixtures.',
    ]},
    {id:'map-contact-presentation',title:'Map continuity & radar',items:[
      'Native chunk shadows keep a fixed frame instead of jumping as you leave a tunnel. Next-chunk preparation includes static shadows, and selecting a chunk keeps the existing renderer.',
      'Lightweight distant Dust 2 scenery fills sliced exits without replacing nearby map geometry or combat collision. It is shared between chunks and stored in the verified local asset cache.',
      'Radar edge markers preserve their true bearing. Ramp contact no longer plays a heavy landing unless the impact reaches the captured game threshold.',
    ]},
    {id:'visible-combat-results',title:'Clearer eliminations',items:[
      'A bounded top-right death feed shows killer, weapon, victim and headshots. Character impacts add short blood bursts and helmet flashes at resolved world contacts.',
      'Directional native-derived death guidance, stronger headshot response and a faster player death view replace the slow generic collapse. Ragdolls and particles remain presentation approximations.',
      'Completed fight recordings transfer their buffers to review instead of deeply copying them during the next-chunk handoff; live exports remain detached.',
    ]},
    {id:'armory-browsing',title:'A simpler armory',items:[
      'Collection and Unlocks use equipment-specific paged browsing, a selected-item preview and clear ownership, level requirements and prices.',
      'Purchases show a confirmation before spending credits; equipping remains a separate action. Wallet, XP, milestones and achievements stay accessible on desktop and mobile.',
    ]},
    {id:'duel-evidence-coaching',title:'Feedback from the actual fight',items:[
      'Duel reviews show opening speed, first-shot hits, contact timing and per-enemy damage. Repeated movement, pre-aim, exposure, reload and follow-up-control issues receive measured evidence and a specific next-rep goal.',
      'Shot diagnosis separates aim/recoil-line misses, random dispersion and blocking cover using the resolved target pose. Fractional shot visibility timing is corrected; local aim-line scores no longer penalize random dispersion alone.',
    ]},
    {id:'aim-metrics-profile',title:'Engagement metrics & aim weaknesses',items:[
      'Duel scorecards now separate contact-to-shot, time to damage, time to kill, damage-to-kill and an input-response estimate, with sample counts and exclusions instead of treating every timing value as reaction time.',
      'A six-part local aim profile uses published metric definitions, transparent practice targets and measured weaknesses. Same-setup history pools raw samples; personal form compares with older saved rounds, not invented Leetify or FACEIT population ratings.',
    ]},
    {id:'articulated-deaths',title:'Articulated deaths & death camera',items:[
      'Player and bot deaths use joint-limited rigid bodies with freshly verified native SAS shapes, masses, inertia and limits. Captured poses, running momentum and jump velocity carry into the fall; complete body transforms keep the skin aligned with its contact shapes.',
      'Nearby native movement geometry includes floor, walls and cover sides; selective self-contact, sleeping and bounded local collision caches limit unnecessary work. The player death camera follows the body while avoiding arena edges and cover.',
      'The browser physics solver, release impulses, joint-cone approximation and camera transitions remain trainer adaptations, not an identical implementation of Source 2 ragdolls.',
    ]},
    {id:'textured-context-round-start',title:'Cleaner surroundings & smoother round starts',items:[
      'Distant Dust 2 surroundings retain native diffuse textures and cleaner silhouettes in one shared visual-only atlas. Playable chunk geometry, movement, aiming and collision stay unchanged.',
      'Audio setup moves before Enter; round transitions avoid constructing a discarded route guide, reuse immutable animation data and stage new actors across frames. Combat resumes only after the final lineup and guide have been warmed with the active lighting.',
    ]},
    {id:'victory-freeplay-local-maps',title:'Keep playing between rounds',items:[
      'After a win, movement, aiming, shooting, reloading and weapon switching remain available while the next chunk prepares. Scores, XP, completed timings and fight recordings stay frozen at the result; pause still works.',
      'Chunk and context metadata now ship with the app release instead of being requested again. Previously downloaded, verified chunk resources load from local browser storage without map requests, including after a fresh page. Clearing, eviction or disabled storage can require a new download.',
      'A failed next-round preparation leaves the current range playable and offers an explicit retry instead of repeatedly downloading in the background.',
    ]},
    {id:'beginner-duel-defaults',title:'A gentler first duel',items:[
      'New visitors start AI Duel against three FACEIT level 1 bots. Returning players keep their saved bot count, difficulty and individual overrides.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october20Changes = {
  id: 'update-2026-10-20',
  title: 'Smoother Dust 2 Duels (October 20)',
  baselineCommit: 'af175145e581bd4cc853440af1a529856f0a5057',
  sections: [
    {id:'native-map-performance',title:'Faster loading & smoother combat',items:[
      'Dust 2 Duel visuals use bounded textures, single-request image packs and material-aware batching. Collision, scale and shot geometry are unchanged.',
      'Blocked bot paths back off instead of retrying every simulation tick. Native terrain queries use allocation-light exact clipping, with unchanged movement/contact results.',
      'Changing opponent settings keeps the current map. Returning to the previous chunk reuses its loaded assets, and active chunks share decoded texture sources without closing images still in use.',
    ]},
    {id:'held-angle-awareness',title:'Better angle holds & awareness',items:[
      'Duel defenders prefer useful covered angles and keep pre-aim on the approach while moving. Native-map sighting memory considers reachable openings rather than staring through a wall.',
      'Recent sightings, general approach memory and reaction-ready sound reports take priority over routine checks. Elevated-map sound and shadow cues retain their world height.',
      'Prefire defenders hold visible course openings near the last encounter and react to audible flank or rear cues. Geometry checks are cached and bounded; hidden movement cannot update their aim or authorize shots.',
    ]},
    {id:'teammate-hearing',title:'Clearer teammate reports',items:[
      'Teammate callouts keep the reported enemy position instead of passing through noisy footstep localization. Later player sounds retain their own reaction delay.',
      'Allied steps, landings and gunfire stay excluded from enemy-hearing cues in Duel and Prefire. Recent personal sightings remain protected from conflicting reports.',
    ]},
    {id:'dynamic-duel-rounds',title:'More varied defensive Duels',items:[
      'Eight native Dust 2 chunks cover all ten practice approaches, with varied covered starts, larger common-angle pools and nearby defensive pairs. Certified round layouts and radar floor atlases are baked offline.',
      'Default mixed rosters favor active cover peeks. Teammates follow up on recognized contact while a partner is alive and trade deaths more often; lower/mid settings are more forgiving without reducing the top difficulty ceiling.',
      'The minimap now draws native-map floors and cover, with spotted-only enemy markers. Footsteps use re-extracted surface-specific game sound banks and distance curves, and confirmed native-wall muffling is no longer overwritten by a clear acoustic fallback.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october19Changes = {
  id: 'update-2026-10-19',
  title: 'Training reliability (October 19)',
  baselineCommit: 'af175145e581bd4cc853440af1a529856f0a5057',
  sections: [
    {id: 'real-map-duels-empty-magazines', title: 'Real-map Duels & empty-magazine reloads', items: [
      'AI Duel now defaults to random Dust 2 chunks: Long doors/pit, B tunnels/site and Mid doors/CT. Native collision, scale and textures are retained without loading the full map. Generated arenas remain an opt-in, and route arrows are enabled by default.',
      'Defenders use Duel perception, hearing, trading and combat behavior at sourced holding positions, with terrain-checked navigation and map-relative pre-aim. Navigation is prepared offline rather than rebuilt on older CPUs.',
      'An equipped empty magazine reloads automatically after attack is released and existing weapon-action gates allow it. Holding attack suppresses idle reload; native ammo-commit, draw and attack deadlines remain intact.',
    ]},
    {id: 'dust2-holds-wheel-reload', title: 'More Dust 2 holds, wheel-jump & native reload timing', items: [
      'Added Pit-floor, Long-car, A-box, ramp, Ninja and close-Catwalk coverage, with focused lineups and a covered Top-Mid approach to Catwalk. New locally authored positions are disclosed separately from sourced positions and measured hold evidence.',
      'Active Prefire defenders repeat validated peeks, counterstrafe before firing and can pressure a recently seen opponent along a certified local lane. Static holders remain static; bots cannot follow hidden positions or walk through cover.',
      'Controls accept Wheel Up and Wheel Down for jump and other one-shot actions. Magazine refill markers and attack gates were re-extracted from the installed game: committed ammo survives holstering, while draw and fire deadlines remain enforced. Reload poses use authored clip time, not a stretched attack-lock duration.',
    ]},
    {id: 'weapon-switch-route-guidance', title: 'Smoother weapon switches & visible route guidance', items: [
      'Duel and Prefire retain up to three prepared first-person weapon rigs. Carried weapons prepare one at a time while practice is inactive; hot switches reuse their rigs instead of parsing models, rebuilding animations or compiling shaders again. Gameplay draw and fire readiness are unchanged.',
      'Dust 2 floor arrows stay on by default and have a visible toggle beside the route selector. Difficulty presets no longer change navigation preferences. Older preset-disabled arrows are restored once; an explicit new opt-out is saved.',
    ]},
    {id: 'fight-review-repair', title: 'Fight playback & readable scorecards', items: [
      'Fight replay follows recorded movement, stance and camera angles, with a timeline and separate player/overview views. It works even when you did not fire. Recorded Duel cover stays with the fight after the next random map loads; playback rigs do not alter live shot hitboxes.',
      'Shot rays, recorded hit shapes and bot decisions remain available as optional diagnostics. Playback pauses when another panel opens and closes cleanly on restart. Recordings can still be exported; this is browser-simulation playback, not a CS2 demo.',
      'Scorecards show one coaching focus, one next-rep action and measured totals. Detailed metrics are expandable, missing values are marked unavailable, and a fresh round no longer erases the last completed fight feedback.',
    ]},
    {id: 'practice-workflow-repairs', title: 'More reliable practice controls', items: [
      'Range entry waits for its engine and models after a drill switch. The fullscreen toolbar also works in Duel and Prefire. The first-visit settings hint has its own row and cannot cover the FPS/audio controls.',
      'Movement lessons retain keyboard button activation, held movement controls and stable completion results. Hearing practice can explicitly resume after calibration, mute or interruptions, retries a failed sound without changing its hidden position, and cancels stale pending audio loads.',
      'The drill and settings workflows have new desktop/mobile regression coverage. These repairs preserve the physical movement, shot, recoil and damage calculations and saved progression.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october18Changes = {
  id: 'update-2026-10-18',
  title: 'Dust 2 angle coverage (October 18)',
  baselineCommit: 'af175145e581bd4cc853440af1a529856f0a5057',
  sections: [
    {id: 'ct-site-holds-navigation', title: 'CT boxes, site holds & clearer routes', items: [
      'CT spawn gains the missing box headglitch and under-A hold. A native-validated standing variant retains the exact sourced box coordinate; it shares one selection family with the original crouched sample and cannot spawn beside it.',
      'Seventeen additional approach/hold assignments bring elevated and back-site boxes into Long, Short, A-retake and B-tunnel practice. The B route continues through the back site. Four focused fixed lineups expose these holds directly, retaining ten approaches and the five-bot limit.',
      'Route hints no longer skip tight checkpoints, clear them backwards or suggest a horizontal turn to another level. Off-route hints stop pointing directly through unknown cover. Completed floor arrows disappear as checkpoints advance, without per-frame geometry rebuilds or hidden-enemy guidance.',
    ]},
    {id: 'training-workspace-ux', title: 'A clearer training workspace', items: [
      'Browse every drill by skill in a searchable drill chooser. Loadout search and weapon categories keep the existing inventory and owned finishes, while setup and review panels can be hidden to give the range more room.',
      'Mouse, crosshair, controls, training and audio/video now have separate settings sections. Essential Duel and Prefire setup comes first; advanced options stay available in expandable groups. Settings save automatically and resetting them requires confirmation.',
      'Larger labels, stronger contrast, keyboard-accessible settings tabs and focus handling, plus compact phone and landscape layouts. This is a presentation update: aiming, movement, recoil, damage, spawn selection and saved progression are unchanged.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october17Changes = {
  id: 'update-2026-10-17',
  title: 'CS2 coaching update (October 17)',
  baselineCommit: 'af175145e581bd4cc853440af1a529856f0a5057',
  sections: [
    {id: 'cs2-coaching-language', title: 'Clearer, situation-specific coaching', items: [
      'Duel, Prefire, spray, transfer, movement drills, hearing and lessons now use familiar CS2 terms and one next-rep action: crosshair placement, pre-aim, counter-strafe, angle isolation, burst resets and spray control. Advice remains tied to observed shots rather than random tips.',
      'Skill reviews put the next action first and include optional CS2 term explanations. Body hits, off-angle mouse corrections, valid holds and situational wide swings or crouch sprays are not blanket mistakes. Hearing tips account for device and cue ambiguity, without treating loudness as an exact range finder.',
      'Common community coaching advice was cross-checked across Reddit discussions; it does not supply game constants or invented rank benchmarks. Physical shot calculations, score weights and saved practice identifiers are unchanged.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october16Changes = {
  id: 'update-2026-10-16',
  title: 'Training quality update (October 16)',
  baselineCommit: 'af175145e581bd4cc853440af1a529856f0a5057',
  sections: [
    {id: 'prefire-navigation-input-trades', title: 'Routes, controls & faster inspections', items: [
      'Dust 2 adds exact-source CT Mid wall/recess and Upper-tunnel exit holds, checked against native collision and physical head shots. Route directions track ordered waypoints; brighter floor arrows show the course without revealing enemy locations. Both can be disabled independently.',
      'Hit captions and coaching feedback sit farther down the viewport. Fixed beveled-box support masking near Mid Xbox, which caused repeated tiny falls and landing sounds rather than real falls.',
      'Settings now include saved keyboard bindings, conflict checks and reset controls. Shared CS2 mouse-count tests cover hip fire, zoom ratio and invert Y, with raw-input status and explicit physical calibration for browser/OS scaling differences. DPI is not multiplied into mouse deltas. Inspect can interrupt drawing immediately, including a request made while its model loads; firing cooldowns remain intact.',
    ]},
    {id: 'trade-execution', title: 'Nearby trade responses', items: [
      'Trade responders prioritize viable nearby openings and loaded fights over unrelated setup/reload routines. Audible teammate deaths can trigger delayed area checks without exposing a hidden killer.',
    ]},
    {id: 'training-quality-roadmap', title: 'Shot review & focused practice', items: [
      'Duel and Prefire retain a bounded combat history with shot-time hit shapes, aim and bullet rays, actual damage/cover contacts, bot decision evidence and a downloadable recording. Review recent shots while paused to inspect placement, recoil, spread and cover.',
      'Skill reviews can launch three measured reps, open the relevant movement lesson and retain the original task. Saved Prefire angle diagnoses support native-validated covered-entry retries without adding full-route records. Same-setup trends and optional retention checks keep progress separate from XP.',
      'Visibility uses pose-aware samples and orientation-correct fallback shapes. Bots retain evidence-weighted cover expectations, clear checked angles and apply smoother aim transitions. Fixed-tick pose clocks prevent render queries from advancing shot-time locomotion; lower-body turning retains matching upper-body aim.',
    ]},
    {id: 'native-materials-performance', title: 'Native surfaces & frame diagnostics', items: [
      'Dust 2 source materials and validated convex thicknesses now inform penetration, impacts and footsteps. Unverified/open surfaces stay opaque. Setups select complete authored lineups, with a contextual evidence pipeline for future measured datasets and map admission checks.',
      'Lazy mode loading, bounded map loading, shared image decoding and shader prewarming reduce avoidable work. The optional FPS counter includes frame-time percentiles, 1% lows and stalls; exported diagnostics retain raw active-frame timings. Complete live-CS2 movement and FACEIT population parity are not claimed.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october8Changes = {
  id: 'update-2026-10-08',
  title: 'Latest update (October 8)',
  baselineCommit: 'af175145e581bd4cc853440af1a529856f0a5057',
  sections: [
    {id: 'prefire-contact-quality', title: 'More deliberate Prefire encounters', items: [
      'Return fire now controls shooting rather than perception: non-shooting defenders notice visible opponents, react to audible movement and retain observed approach areas across cover breaks. Head, body and shoulder exposure are recognized without tracking hidden players.',
      'Quick checks counterstrafe on contact; wide swings retain their commitment. Native cover planning rejects forward strolls and exits that show their backs to earlier approach angles. Long-range defenders aim before firing instead of accepting several degrees of error.',
      'Dust 2 gains clearer lighting and cached static cover shadows, with no added shadow pass in Low/Performance. Moving weapon and arm pitch alignment is corrected while retaining the hand mounts. Independent native encounter audits and browser movement/rendering checks accompany these changes.',
    ]},
    {id: 'encounter-practice', title: 'Coverage & reactive encounters', items: [
      'Prefire presets preserve your Next route / Repeat route choice, with Next route selected for new visitors. All holders watch native-validated authored approaches instead of inheriting a facing from an unrelated larger course. Duel angle checks avoid unrelated rear corners.',
      'Configurable teammate-death trades use recent sightings or audible shot estimates, with skill-dependent delayed attempts, shared accuracy and physical cover swings. Prefire requires Return fire. Trades expire, return to cover and cannot reveal the hidden killer position. Damage punch keeps its armor-aware physical effect, with corrected paused/result camera sampling and bounded Prefire bot aim correction.',
      'Eleven additional pinned source identities expand car, A-site, Short, pit and Top-Mid coverage to 141 identities across ten approaches. Selection balances family coverage with match-balanced regional hold observations, reducing domination by uncertain counts without inventing exact angle popularity. Unsafe or unreachable proposals remain excluded.',
    ]},
    {id: 'purposeful-practice', title: 'Clearer routes, peeks & arenas', items: [
      'Dust 2 consolidates 24 duplicate route/roster entries into ten distinct landmark approaches. Compatible old sets become fixed-lineup options with saved-ID migration. Revised covered starts and supported connectors are individually native-validated at full speed; bot plans reject open strolls and unsupported firing views, with committed exits, counterstrafed bursts and precise cover returns.',
      'AI Duel places compounds, inward-facing traversal and usable support angles around themed landmarks and two protected ground bypasses. Seeded asymmetry remains, but props now have tactical relationships instead of independent depth scatter. Existing collision and geometry budgets remain unchanged.',
      'Show coaching tips can be disabled without hiding hit feedback, measurements or controls. Further position-data research records independent dataset rights and sampling limits, exposes supporting match counts and adds an offline native pocket-leakage audit; unverified new popularity numbers are not substituted for measured support.',
    ]},
    {id: 'prefire-evidence', title: 'Better hold coverage & evidence', items: [
      'Weighted Prefire now draws from broader, individually native-validated position pools on each approach. All-angle learning keeps its fixed lineup. Bots per run is configurable from one to five, defaulting to four, replacing the old independent coin-flip count.',
      'The verified demo sample expands to 32 matches / 256 complete rounds. Observed-round support replaces the earlier smoothed episode weights below: repeat pauses and nearby cells in one round count only once, matched by side, phase, distance and floor height. The panel shows numerator/sample size rather than misleading weight multipliers or invented match probabilities.',
      'Coordinate configs, creator training guidance and competitive demo evidence are cross-checked separately. Source attribution and limitations remain visible; unsupported locations do not become fabricated popularity statistics.',
    ]},
    {id: 'prefire-expansion', title: 'Movement & varied clearing practice', items: [
      'Dust 2 now has 24 clearing courses and 120 angle slots from pinned OpenPrefirePrac and cs2-retakes coordinates. Expanded pit, site, mid, tunnel and post-plant checks keep covered starts, native walking validation and a five-bot maximum.',
      'Weighted occupancy uses 1,845 observed low-speed firearm episodes from eight competitive matches / 48 sampled rounds, separated by side and round phase. Smoothing and an exploration prior retain rare angles; these are relative training weights, not exact match probabilities. Existing all-angle settings remain available.',
      'Installed-binary movement checks correct walk-speed eligibility, surface-friction arithmetic, crouched air steering and jump momentum. Prefire bots commit to full-speed, counterstrafed angle takes or validated information peeks rather than endless short shuffle loops. Local-player hits retain damage arcs without near-camera impact dots. Complete live-engine parity is not claimed.',
    ]},
    {id: 'aim-reliability', title: 'Aiming & target reliability', items: [
      'Imported Duel/Prefire bot rigs now use 19 extracted native SAS hit capsules attached to the actual animated bones. Authoritative shot-time pose sampling fixes mismatches during stance, running and pitch changes without enlarged head zones or redirected shots. Analytic shapes remain for the local player and unavailable/headless rigs; this supersedes the earlier imported-bot analytic-only limit below.',
      'Fullscreen now gives the entire screen to the 3D view, restoring centered aim and the correct native-aspect field of view; ESC restores settings and detailed review. Corrected reversed third-person aim pitch, synchronized Follow Recoil between physics ticks, and preserved accumulated inaccuracy through scope/alternate changes. Static installed-build inspection verifies recoil signs and the .45 weapon-recoil camera factor; external damage punch is preserved.',
      'Prefire shows captured last-shot speed, movement/air penalties, retained recoil and a maximum random-cone estimate. Desktop/mobile projection tests and physical route-clearing regressions cover the changes; native animation graphs, command seeding and complete live-game parity remain outside these checks.',
    ]},
    {id: 'skill-coaching', title: 'Measured training feedback', items: [
      'Drill-specific skill reviews replace generic hit-rate advice with measured evidence, transparent score components, one next-rep action and a repeatable goal. Scores are local practice criteria, not FACEIT ranks.',
      'Spray coaching separates recoil-corrected shot centers from random impacts, diagnoses opening / late / lateral errors and measures B acquisition in transfers. Peeking, counterstrafing, burst and Duel reviews account for weapon, range and actual shot state rather than banning body hits or mouse corrections.',
      'Prefire reviews identify the angle to repeat; hearing feedback separates direction and distance with device-aware calibration. Comparable attempts, repeated weaknesses, confidence and older unmeasured results are handled explicitly. Physical shot and movement calculations are unchanged.',
    ]},
    {id: 'prefire', title: 'Dust2 Prefire', items: [
      'Native-map Dust2 prefire practice adds 8 routes and 40 sourced common angles from MIT-licensed OpenPrefirePrac, preserving facing and standing/crouched stance with stationary holds or peeking bots.',
      'Covered starts require moving out before the first contact. Angle-specific holds, crouch-hide cycles, quick/wide/crouch peeks, full-speed exits, counterstrafed bursts and pre-aim join all-angle or random occupancy, optional return fire, route guide, repeat and auto-advance controls.',
      'The training scorecard adds Learn / Clean Entry / Pressure presets, angle-by-angle opening-shot feedback, velocity-based timing, prepared-aim and isolation metrics, repeatable clean-route goals and bounded same-setup progress, putting training quality before speed. Random occupancy can omit the first angle; pause cancels queued trigger input, brief cover breaks reset bot reactions, and dry peeking bots retreat.',
    ]},
    {id: 'native-map', title: 'Native Dust2 assets & limits', items: [
      'Dust2 collision is extracted from the installed game at the exact Source-unit scale (1 unit = 0.0254 m). Native art and collision load lazily, preserving higher-resolution textures, normal maps, alpha modes, signs, trims and roofs; Source 2 visibility culls hidden scenery.',
      'Native map cover currently blocks bullets as opaque geometry. Dust2 wallbangs and material penetration are not reproduced; actor hit shapes retain the existing analytic model.',
      'Native floor, edge and ceiling contacts remain stable while crouching and moving uphill, fixing false airborne accuracy penalties. Native float32 movement-accuracy rounding fixes the crouch-speed cutoff. Facing-aware head anchors and an eye-aligned world camera reduce misleading misses. Source positions are checked for clearance, reachable head shots and overlap without silent relocation. Routes do not import a Dust2 navigation engine or reproduce the complete CS2 engine.',
    ]},
    {id: 'duel-arenas', title: 'AI Duel arena diversity', items: [
      'New asymmetric central-cover layouts vary player and bot sides while keeping covered starts and walking lanes.',
      '12 new cover clusters and 11 new prop assemblies expand the authored arena catalog.',
    ]},
  ] satisfies readonly ChangelogSection[],
} as const satisfies ChangelogRelease;

const october5Changes = {
  id: 'update-2026-10-05',
  title: 'Latest update',
  baselineCommit: '49d8ea6',
  sections: [
    {id: 'combat', title: 'Penetration & collaterals', items: [
      'Material-aware entry/exit rays carry damage through penetrable cover and multiple opponents. Range collaterals preserve physical target-mesh scoring.',
      'Shotgun pellets share discharge-level feedback and scoring; armor is consumed across pellets rather than reused for each hit.',
      'Installed-build recoil tables, shotgun patterns, spread transforms and penetration arithmetic have new offline verification fixtures.',
    ]},
    {id: 'weapons', title: 'Weapons & actions', items: [
      'Nova, XM1014, MAG-7, Sawed-Off and Zeus x27, with extracted cadence, accuracy, recoil, range and reserve data. Zeus is also available on slot 4.',
      'Finite reserves, magazine and interruptible shell reload states, slower silent reloads while holding R, and Zeus recharge.',
      'Knife slash/stab, hit/miss cooldowns and backstabs in Duel. Shotguns have ten native finishes each; Zeus has its seven available native finishes.',
    ]},
    {id: 'movement', title: 'Movement & traversal', items: [
      'Shared player/bot hull contacts, step-up, ramp, ladder, shallow-water and partner-support handling.',
      'Current native landing-factor arithmetic, centered bunnyhop window, jump-spam rejection and crouch/contact regressions.',
      'Experienced bots can quietly climb authored routes and coordinate partner boosts through the same physics as the player.',
    ]},
    {id: 'arenas', title: 'Arenas & team tactics', items: [
      'Fifteen new traversal/environment POIs add stairs, ramps, lofts, ladders, vents, glass, sliding gates and movable cargo to the existing cover catalog.',
      'Doors, breakable panels and displaced props update combat, movement, rendering and acoustics together.',
      'Evidence-led trades, synchronized entries, crossfires, shadow cues and knife-equipped opponents. Hidden enemy positions do not grant firing permission.',
    ]},
    {id: 'bot-behavior', title: 'Duel behavior', items: [
      'Committed weapon/range-aware exchanges and shot-confirmed burst timing replace repeated empty peek loops.',
      'Counterstrafe re-engagements, nearby-cover resets and changing firing lines keep open fights active while preserving deliberate escapes.',
      'Steadier uncertain sound bearings and fresh-audio priority improve contact expectations without revealing hidden targets.',
    ]},
    {id: 'connection', title: 'Responsive combat, radar & armor', items: [
      'Removed simulated network latency, delayed input and hit feedback, prediction replay and shot rewind. Old saved ping settings are ignored.',
      'A compact rotating radar shows visible contacts and expiring last-known positions, with zoom and visibility controls.',
      'Independent Kevlar, helmet and armor-condition controls for both sides and individual opponents, with armor-aware XP weighting.',
    ]},
    {id: 'presentation', title: 'Animation, audio & performance', items: [
      'Lazy native weapon gestures with stable anchors, phase-matched reloads and event-timed native weapon foley.',
      'Cover-aware directional audio, immediate hit-frame skeletal death physics and pooled Zeus electrical wires instead of a firearm flame.',
      'Fewer duplicate skeleton updates, compatible mesh batching, bounded caches, cached terrain routing and radar sizing fixes; shot math is unchanged.',
    ]},
    {id: 'performance', title: 'Frame rate & monitoring', items: [
      'Allocation-light cover rays, contributing-animation scheduling and memoized Duel setup reduce repeated CPU work.',
      'Fixed untracked dropped weapons accumulating across rounds; allocation-light corpse contacts and sleeping-pose reuse reduce post-kill CPU work.',
      'A toolbar FPS toggle and CPU-aware automatic pose sampling make performance easier to monitor and adapt without changing gameplay timing.',
    ]},
  ] satisfies readonly ChangelogSection[],
} as const satisfies ChangelogRelease;

// Append new releases without rewriting the previously published entries.
const october28GrenadeChanges = {
  id:'update-2026-10-28-grenade-fidelity',title:'Grenade mechanics audit (October 28)',
  baselineCommit:'af175145e581bd4cc853440af1a529856f0a5057',
  sections:[
    {id:'native-grenade-mechanics',title:'More faithful throws & effects',items:[
      'Installed game code now drives throw strength, release height, hull placement, bounce response and separate fuse clocks. Short clicks no longer wait for cosmetic pin-animation completion.',
      'HE uses the extracted damage curve and blast armor rules. Flashes use native facing bands, partial-cover paths and overlapping timers. Fire damage ramps up while bounded parent/child flames spread.',
      'Bot grenade setups have been rebuilt and versioned against the corrected trainer physics and existing Dust 2 collision.',
    ]},
    {id:'grenade-evidence-boundaries',title:'Verified data, clear limits',items:[
      'Build-pinned offline arithmetic fixtures cover launch, input, clipping, HE, flash and fire. Native HE/flash presentation parameters and dropped-model scales are audited separately.',
      'Full Source 2 smoke, fire placement, specialized contacts, client compositing and final damage accounting remain adaptations. Extracted models and passing trainer tests do not establish exact CS2 parity.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october28ProgressRecoveryChanges = {
  id:'update-2026-10-28-progress-recovery',title:'Progress recovery & gifts (October 28)',
  baselineCommit:'af175145e581bd4cc853440af1a529856f0a5057',
  sections:[
    {id:'safer-local-progress',title:'Keep your progress',items:[
      'Rotating checked saves and a separate local profile database can recover damaged or missing browser saves. Newer save formats are protected, and stale tabs refresh before spending or awarding rewards.',
      'Armory now includes complete JSON backup export/import, visible save-failure warnings and an optional persistent-storage request. Clearing all site data still requires an exported backup for recovery.',
    ]},
    {id:'signed-owner-gifts',title:'Gifts from SprayLab',items:[
      'Redeem owner-signed XP and credit gifts in Armory / Save & gifts. Rewards and redemption receipts save together; repeat claims do not add rewards again to the same local profile.',
      'Level-recovery gifts top up XP and lifetime credit earnings without refunding purchases or inventing completed games and combat achievements.',
    ]},
    {id:'equipment-key-layout',title:'Weapon & grenade controls',items:[
      'Press 3 to cycle knife and Zeus, and 4 to cycle carried grenades. Controls supports direct bindings for every grenade type, including wheel input; the old stock layout migrates without resetting unrelated custom keys.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october29BotChanges = {
  id:'update-2026-10-29-bot-difficulty',title:'More forgiving beginner bots (October 29)',
  baselineCommit:'fbeefb2',
  sections:[
    {id:'beginner-bot-assistance',title:'Easier lower ranks',items:[
      'Levels 1-6 react and settle their aim more slowly, with less precise aim and less consistent stopping. Assistance is strongest at levels 1-3 and tapers out before level 7.',
      'Levels 7-10+ retain their existing skill parameters. Weapon damage, spread, recoil, health, movement physics and XP rules are unchanged.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october29GrenadePresentationChanges = {
  id: 'update-2026-10-29-grenade-presentation', title: 'Grenades & authored Duel lineups (October 29)',
  baselineCommit: '1867d2d', sections: [
    {id: 'grenade-input-audio', title: 'Throws & native sound', items: [
      'Right-click lobs and combined left/right throws use reconciled browser button chords. Native underhand selection and elapsed clip timing replace stretched throw presentation.',
      'Current game sound banks supply 75 utility events and 118 samples, with cue-name matching, sample-loop metadata, retryable loading and independent fire sustain/fade sounds.',
    ]},
    {id: 'smoke-fire-flash', title: 'Smoke, fire & flashes', items: [
      'Depth-aware volume smoke replaces flat puffs. Narrow bullet channels and larger HE openings temporarily clear the density and refill, with shared AI visibility envelopes.',
      'Ground fire uses native center, edge, surface, incendiary and ember textures. Fully blinded actors use native standing/crouched eye-cover poses.',
      'The white flash curve matches 1,440 offline cases from the installed client, fixing opaque rear-flash plateaus. Fluid rendering, particle emission and full afterimage composition remain browser adaptations.',
    ]},
    {id: 'authored-duel-lineups', title: 'Common entries & your own holds', items: [
      'Standard real-map Duels start at their authored covered entry. Shuffled approaches remain selectable, without inventing measured encounter probabilities.',
      'Manual lineups capture a player entry and up to five named bot holds, check supported hulls and sightlines, save on this device and import/export JSON. Walk mode does not award combat scores or XP.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october29RadarReviewChanges = {
  id: 'update-2026-10-29-radar-utility-review', title: 'Clearer radar, grenades & round review (October 29)',
  baselineCommit: '0a1ff64', sections: [
    {id: 'readable-native-radar', title: 'A useful radar', items: [
      'Larger circular radar with a consistent world-space zoom, heading cone, height cues, edge bearings and fading last-known contacts. Hidden enemies are not revealed.',
      'Dust 2 uses the installed native overview artwork and coordinates, shared between chunks through verified local caching. The collision-derived floor atlas remains a fallback.',
    ]},
    {id: 'post-round-grenades', title: 'Grenades keep moving', items: [
      'Dying no longer stops the world clock: airborne grenades and primed grenades dropped by dying players continue falling, bouncing and detonating after the result. Scored outcomes stay fixed.',
      'HE opens a visible temporary window through the full smoke cloud; sustained bullet fire no longer evicts the explosion opening. The shared visual/AI envelope remains a documented browser approximation.',
      'Fire uses more native sequence variants, corrected luminance/multiply color composition, additive blending, separate particle lifetimes, overlapping emission and clamped sequence ends rather than looping flat cards.',
    ]},
    {id: 'compact-duel-review', title: 'Focus on your next improvement', items: [
      'The Duel scorecard puts measured aim, movement and positioning first, with at most two evidenced weaknesses and specific actions. Six headline stats include time to damage, time to kill and opening accuracy.',
      'Detailed findings, aim breakdown and history remain available in expandable sections. Missing measurements are not displayed as zero, and small samples are marked provisional.',
    ]},
  ],
} as const satisfies ChangelogRelease;

const october29HeSmokeChanges = {
  id: 'update-2026-10-29-he-smoke', title: 'HE explosion smoke (October 29)', baselineCommit: 'abb9652',
  sections: [{id: 'he-explosion-after-effect', title: 'A complete-looking HE burst', items: [
    'HE detonations now leave expanding native-texture smoke billows and spreading dust after the central flash, with fitted frame animation and gradual dissipation.',
    'The cosmetic after-effect stays in live play and fight review, including post-death explosions. Instant blast damage and smoke-grenade clearing are unchanged.',
    'One pooled draw, a compressed shared atlas and prepared texture uploads keep the effect bounded. Native field ranges inform the browser adaptation; it is not the full Source 2 particle renderer.',
  ]}],
} as const satisfies ChangelogRelease;

export const latestChanges = {
  id: 'update-2026-10-29-bleeding-edge', title: 'USP-S finish repair (October 29)', baselineCommit: '4c0f4db',
  sections: [{id: 'usp-bleeding-edge-repair', title: 'Bleeding Edge renders again', items: [
    'Replaced the broken magenta USP-S Bleeding Edge material with its installed-game UV paint mask and valid authored colors, retaining weapon surface detail and unchanged gloves.',
    'Existing purchases and equipped skins are preserved. A versioned repair asset bypasses the old cached texture; import checks reject missing-texture placeholders and corrupt palettes.',
  ]}],
} as const satisfies ChangelogRelease;

export const changelogHistory = [
  october29HeSmokeChanges,
  october29RadarReviewChanges,
  october29GrenadePresentationChanges,
  october29BotChanges,
  october28ProgressRecoveryChanges,
  october28GrenadeChanges,
  october26Changes,
  october23PreloadingChanges,
  october23Changes,
  october20Changes,
  october19Changes,
  october18Changes,
  october17Changes,
  october16Changes,
  october8Changes,
  october5Changes,
  {
    id: 'update-49d8ea6',
    title: 'Previous update (49d8ea6)',
    baselineCommit: '06774a9',
    sections: [
      {id: 'duels', title: 'AI Duel & arenas', items: [
        'Bots remember recent sightings and nearby re-peeks without tracking you through walls. Hit feedback updates on the damage frame; player and AI share armor-aware aim punch and new constrained death falls.',
        'Authored points of interest create coherent cover, routes and props, with corrected top surfaces. One- and two-bot arenas can be made smaller.',
        'Bots vary holds, hear weapon-specific sound ranges and approach quietly in small duels. Beginner peeks and mid-level difficulty are rebalanced without weakening level 10/10+.',
      ]},
      {id: 'weapons', title: 'Weapons & actions', items: [
        'Expanded firearm data and loadouts, including sidearm-only practice, scopes, burst modes and R8 alternate fire.',
        'Native draw, reload, inspect and supported firing animations; knife choices, weapon-specific bot grips and dropped-weapon pickups.',
        'Native muzzle flames and pooled, instant-hit cosmetic tracers. Suppressed guns leave no tracer.',
      ]},
      {id: 'progression', title: 'XP, credits & achievements', items: [
        'Local XP, levels, a credit wallet and one-time milestones; eligible cosmetics are purchased rather than automatically owned.',
        'Permanent achievements track combat, technique, training, collection and career goals.',
        'Bot difficulty has twice its previous XP weighting. Credits keep paying after level 100.',
      ]},
      {id: 'collection', title: 'Cosmetics & owned collection', items: [
        'All 20 special knife families, both stock knives, 557 knife finishes, native inventory previews, gloves and bot agents.',
        'Owned-only collections are scoped to the selected gun, with a separate Unlocks shop. Selecting a gun with owned finishes keeps Loadout open at its finishes.',
      ]},
      {id: 'performance', title: 'Performance & browser play', items: [
        'Batched impacts and scenery, bounded asset caches, and less work for idle or hidden ranges.',
        'Adaptive and performance quality, frame limits, an optional FPS counter and supported-browser shortcut protection.',
        'Confirmed mouse capture prevents accidental drag-only aiming after switching drills. Animated barrel anchors and bounded effects avoid per-shot GPU allocations.',
      ]},
      {id: 'hearing', title: 'Hearing practice', items: [
        'Locate hidden native footsteps and shots on an overhead board, with direction/distance feedback, replay and session history.',
        'Headphone, stereo and mono profiles, HRTF/equal-power spatialization, surface choices, muffling and level calibration.',
      ]},
    ],
  },
] as const satisfies readonly ChangelogRelease[];

export const changelogReleases: readonly ChangelogRelease[] = [latestChanges, ...changelogHistory];
