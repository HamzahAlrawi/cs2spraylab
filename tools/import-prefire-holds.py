"""Bounded, offline-only empirical hold aggregation from pinned OpenCS2 ticks.

Install duckdb==1.4.4 in .local-tools/prefire; see docs/prefire-statistics.md.
No game access, videos, events/kill tables, or runtime configuration are used.
"""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REVISION = "8d7deddcd30c081fb197b75f58b4a0fba1117b9d"
DATASET = "blanchon/opencs2_dataset"
SEED = "dust2-holds-v1"
HZ = 64
MAX_MATCHES = 32
MAX_ROUNDS = 8
MAX_MIB = 1024
MAX_WORKERS = 4
PINNED = {
    "README.md": "cb08b2d18f6fa70f0c7d500740daa5156e4c040b68e602a0ae174a2d35a478da",
    "index/matches.parquet": "b4d83ba3413d35a7f5da6d04f8d5c41597caddb4fb29b4a3a865f5446945a685",
    "index/rounds.parquet": "d0770b59df6dc5bbcc16772476464101e3558682e4294e9eed105f27b7c24d16",
    "index/pov_rounds.parquet": "17f77dcc4677fd19b0cd6b4f2742bb0930c3f544206b06b879106b8e66bb5ff5",
}
TICK_COLUMNS = ["tick", "t", "team_num", "is_alive", "health", "x", "y", "z",
                "velocity_x", "velocity_y", "velocity_z", "match_id", "map_name",
                "player", "round", "input_weapon", "input_weapon_id", "active"]
LEGACY_FIREARMS = frozenset({"ak47", "m4a1_silencer", "m4a1", "awp", "ssg08", "galilar", "famas",
                     "glock", "usp_silencer", "p250", "deagle", "fiveseven", "elite", "mac10", "mp9",
                     "tec9", "mp7", "hkp2000"})
FIREARMS = LEGACY_FIREARMS | frozenset({"aug", "sg556", "bizon", "p90", "mp5sd", "ump45",
    "m249", "negev", "g3sg1", "scar20", "nova", "xm1014", "mag7", "sawedoff", "cz75a", "revolver"})
MOVEMENT_INPUTS = frozenset({"forward", "back", "move_left", "move_right", "jump"})
BUSY_INPUTS = frozenset({"reload", "use", "look_at_weapon"})


def fingerprint(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path, value, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".partial")
    try:
        temporary.write_text(json.dumps(value, separators=(",", ":") if compact else None,
                                        indent=None if compact else 2, allow_nan=False) + "\n",
                             encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def round_keys(values):
    return [f"{match_id}/{number}" for match_id, number in sorted(values)]


def tick_path(value):
    prefix = f"hf://datasets/{DATASET}@main/"
    path = value.removeprefix(prefix)
    if not re.fullmatch(r"rounds/match_id=\d+/map_name=de_dust2/round=\d+/player=\d+/ticks\.parquet", path):
        raise ValueError(f"Not an allowed Dust2 tick sidecar: {value}")
    return path


def fetch(cache, path, budget, expected=None, download=False):
    # Whitelist paths before opening the network or constructing a local target.
    if path not in PINNED:
        tick_path(path)
    destination = cache.joinpath(*PurePosixPath(path).parts)
    if not destination.exists():
        if not download:
            raise ValueError(f"Missing {destination}; rerun with --download")
        destination.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/datasets/{DATASET}/resolve/{REVISION}/{path}"
        temporary = destination.with_suffix(destination.suffix + ".partial")
        try:
            with urllib.request.urlopen(url, timeout=60) as response, temporary.open("wb") as output:
                size = response.headers.get("Content-Length")
                if size and int(size) > budget[0]:
                    raise ValueError("Download byte cap would be exceeded")
                written = 0
                while block := response.read(256 * 1024):
                    written += len(block)
                    if written > budget[0]:
                        raise ValueError("Download byte cap exceeded")
                    output.write(block)
            if expected and fingerprint(temporary) != expected:
                raise ValueError(f"SHA-256 mismatch: {path}")
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    size = destination.stat().st_size
    budget[0] -= size
    if budget[0] < 0:
        raise ValueError("Sample exceeds --max-mib, including cached inputs")
    actual = fingerprint(destination)
    if expected and actual != expected:
        raise ValueError(f"SHA-256 mismatch: {path}")
    return {"path": path, "bytes": size, "sha256": actual}


def parquet_reader():
    sys.path.insert(0, str(ROOT / ".local-tools" / "prefire"))
    try:
        import duckdb
    except ImportError as error:
        raise ValueError("Install duckdb==1.4.4 into .local-tools/prefire") from error
    if duckdb.__version__ != "1.4.4":
        raise ValueError("Reproduction requires duckdb==1.4.4")
    connection = duckdb.connect()
    connection.execute("SET TimeZone='UTC'")
    return connection


def index_rows(connection, cache, name):
    result = connection.execute(
        "SELECT to_json(row) FROM (SELECT * FROM read_parquet(?) WHERE map_name='de_dust2') row",
        [str(cache / "index" / f"{name}.parquet")],
    )
    return [json.loads(row[0]) for row in result.fetchall()]


def select_sample(matches, rounds, povs, n_matches=4, n_rounds=3):
    if not (1 <= n_matches <= MAX_MATCHES and 1 <= n_rounds <= MAX_ROUNDS):
        raise ValueError("Selection exceeds bounded match/round limits")
    grouped = defaultdict(list)
    for pov in povs:
        grouped[(pov["match_id"], pov["round"])].append(pov)
    complete = {}
    for round_row in rounds:
        key = (round_row["match_id"], round_row["round"])
        group = grouped[key]
        slots = [p["player_slot"] for p in group]
        if sorted(slots) != list(range(10)):
            continue
        if Counter(str(p["player_side"]).lower() for p in group) != {"ct": 5, "t": 5}:
            continue
        start, end = round_row["freeze_end_tick"], round_row["round_end_tick"]
        if start is None or end is None or end <= start:
            continue
        if round_row["has_bomb_plant"] != (round_row["bomb_plant_tick"] is not None):
            raise ValueError(f"Inconsistent plant metadata: {key}")
        if any(p["capture_start_tick"] != start or p["capture_end_tick"] < min(
                p["death_tick"] if p["death_tick"] is not None else end, end)
               for p in group):
            continue
        for pov in group:
            tick_path(pov["ticks_parquet_path"])
        complete[key] = round_row
    def rank(value):
        return hashlib.sha256(f"{SEED}:{value}".encode("ascii")).hexdigest()
    eligible = [m for m in matches if sum(k[0] == m["match_id"] for k in complete) >= n_rounds]
    if len(eligible) < n_matches:
        raise ValueError("Insufficient complete matches; do not publish partial selection")
    chosen_matches = sorted(eligible, key=lambda m: rank(m["match_id"]))[:n_matches]
    selected_rounds, selected_povs = [], []
    for match in chosen_matches:
        candidates = [r for k, r in complete.items() if k[0] == match["match_id"]]
        chosen = sorted(candidates, key=lambda r: rank(f"{r['match_id']}:{r['round']}"))[:n_rounds]
        selected_rounds.extend(chosen)
        for row in chosen:
            selected_povs.extend(grouped[(row["match_id"], row["round"])])
    return chosen_matches, sorted(selected_rounds, key=lambda r: (r["match_id"], r["round"])), sorted(
        selected_povs, key=lambda p: (p["match_id"], p["round"], p["player_slot"])), {
            "dust2_matches": len(matches), "eligible_matches": len(eligible),
            "dust2_rounds": len(rounds), "complete_rounds": len(complete),
        }


def context(row, round_row, pov):
    if not row["is_alive"] or row["health"] is None or row["health"] <= 0:
        return None
    tick = row["tick"]
    if not round_row["freeze_end_tick"] <= tick < round_row["round_end_tick"]:
        return None
    if pov["death_tick"] is not None and tick >= pov["death_tick"]:
        return None
    side = {3: "ct", 2: "t"}.get(row["team_num"])
    if side is None or side != pov["player_side"].lower():
        raise ValueError("Tick team_num disagrees with POV side; refusing mixed-side data")
    plant = round_row["bomb_plant_tick"]
    phase = "postplant" if plant is not None and tick >= plant else "preplant"
    return side, phase


def finite_state(row):
    return all(isinstance(row.get(k), (int, float)) and math.isfinite(row[k]) for k in
               ["t", "x", "y", "z", "velocity_x", "velocity_y", "velocity_z"])


def low_speed(row, threshold):
    return math.hypot(row["velocity_x"], row["velocity_y"], row["velocity_z"]) <= threshold


def hold_ready(row):
    active = row.get("active")
    return (row.get("input_weapon") in FIREARMS and isinstance(active, list)
            and not (set(active) & (MOVEMENT_INPUTS | BUSY_INPUTS)))


def episodes(rows, round_row, pov, threshold=20.0, minimum=0.5, quality=None, exposure=None,
             observed=None, weapon_rows=None):
    """Integrate only observed adjacent intervals; no extrapolated final tick."""
    quality = quality if quality is not None else Counter()
    exposure = exposure if exposure is not None else Counter()
    pending = []
    previous = None
    for row in rows:
        quality["tick_rows"] += 1
        if previous is not None and row["tick"] <= previous["tick"]:
            raise ValueError("Duplicate or non-increasing ticks")
        if not finite_state(row):
            quality["invalid_state_rows"] += 1
            if sum(x[2] for x in pending) + 1e-9 >= minimum:
                yield pending
            pending, previous = [], row
            continue
        label = context(row, round_row, pov)
        if label:
            quality["eligible_alive_rows"] += 1
            if weapon_rows is not None:
                weapon_rows[(row.get("input_weapon"), row.get("input_weapon_id"))] += 1
            if row.get("input_weapon") not in FIREARMS:
                quality["excluded_weapon_rows"] += 1
            if not isinstance(row.get("active"), list):
                quality["missing_input_rows"] += 1
            else:
                if set(row["active"]) & MOVEMENT_INPUTS:
                    quality["movement_input_rows"] += 1
                if set(row["active"]) & BUSY_INPUTS:
                    quality["busy_input_rows"] += 1
            if hold_ready(row):
                quality["firearm_idle_rows"] += 1
        valid_pair = previous is not None and finite_state(previous)
        if valid_pair:
            dt = row["t"] - previous["t"]
            if row["tick"] - previous["tick"] != 1 or abs(dt - 1 / HZ) > 0.0001:
                quality["gap_intervals"] += 1
                valid_pair = False
        prior_label = context(previous, round_row, pov) if valid_pair else None
        same_window = bool(label and label == prior_label)
        if same_window:
            exposure[label] += dt
            if observed is not None:
                observed.add(label)
        holding = False
        if (same_window and hold_ready(row) and hold_ready(previous)
                and low_speed(row, threshold) and low_speed(previous, threshold)):
            displacement = math.dist([row[k] for k in ("x", "y", "z")],
                                     [previous[k] for k in ("x", "y", "z")]) / dt
            # Cross-check replay positions to reject zero-velocity teleports.
            holding = displacement <= threshold + 1.0
            if not holding:
                quality["displacement_rejected_intervals"] += 1
        if holding:
            pending.append((prior_label, previous, dt))
        else:
            if sum(x[2] for x in pending) + 1e-9 >= minimum:
                yield pending
            pending = []
        previous = row
    if sum(x[2] for x in pending) + 1e-9 >= minimum:
        yield pending


def bin_position(row, xy=64, z=32):
    return tuple(math.floor(row[key] / size) for key, size in [("x", xy), ("y", xy), ("z", z)])


def aggregate(streams, threshold=20.0, minimum=0.5, xy=64, z=32):
    cells = {}
    totals = {label: {"episodes": 0, "dwell_s": 0.0, "rounds": set(), "matches": set(),
                      "povs": set(), "holding_rounds": set(), "holding_matches": set(),
                      "observed_rounds": set()} for label in
              [(side, phase) for side in ("ct", "t") for phase in ("preplant", "postplant")]}
    quality = Counter({name: 0 for name in ("tick_rows", "eligible_alive_rows", "invalid_state_rows",
        "gap_intervals", "displacement_rejected_intervals", "excluded_weapon_rows", "missing_input_rows",
        "movement_input_rows", "busy_input_rows", "firearm_idle_rows")})
    exposure = Counter()
    weapon_rows = Counter()
    for rows, round_row, pov in streams:
        match_id = pov["match_id"]
        round_id = (match_id, pov["round"])
        for phase in ("preplant", "postplant"):
            if phase == "postplant" and round_row["bomb_plant_tick"] is None:
                continue
            total = totals[(pov["player_side"].lower(), phase)]
            total["rounds"].add(round_id)
            total["matches"].add(match_id)
            total["povs"].add((match_id, pov["round"], pov["player_slot"]))
        observed = set()
        for episode in episodes(rows, round_row, pov, threshold, minimum, quality, exposure,
                                observed, weapon_rows):
            label = episode[0][0]
            total = totals[label]
            total["episodes"] += 1
            duration = sum(interval[2] for interval in episode)
            total["dwell_s"] += duration
            total["holding_rounds"].add(round_id)
            total["holding_matches"].add(match_id)
            binned = defaultdict(list)
            for _, row, dt in episode:
                binned[bin_position(row, xy, z)].append((row, dt))
            anchor = min(binned, key=lambda key: (-sum(dt for _, dt in binned[key]), key))
            for grid, intervals in binned.items():
                key = (*label, *grid)
                cell = cells.setdefault(key, {"episode_visits": 0, "episode_anchors": 0,
                    "dwell_s": 0.0, "matches": set(), "rounds": set(), "xyz_sum": [0.0] * 3})
                cell["episode_visits"] += 1
                cell["episode_anchors"] += int(grid == anchor)
                cell["matches"].add(match_id)
                cell["rounds"].add(round_id)
                for row, dt in intervals:
                    cell["dwell_s"] += dt
                    for axis, name in enumerate(("x", "y", "z")):
                        cell["xyz_sum"][axis] += row[name] * dt
        for label in observed:
            totals[label]["observed_rounds"].add(round_id)
    output_cells = []
    for key, cell in sorted(cells.items()):
        output_cells.append({"side": key[0], "context": key[1], "bin": list(key[2:]),
            "episodes": cell["episode_visits"], "episodeAnchors": cell["episode_anchors"],
            "seconds": round(cell["dwell_s"], 6), "matches": len(cell["matches"]),
            "rounds": len(cell["rounds"]), "roundKeys": round_keys(cell["rounds"]),
            "position": [round(v / cell["dwell_s"], 3) for v in cell["xyz_sum"]]})
    layers = []
    for label, total in sorted(totals.items()):
        layers.append({"side": label[0], "context": label[1], "episodes": total["episodes"],
            "seconds": round(total["dwell_s"], 6), "observedAliveSeconds": round(exposure[label], 6),
            "matches": len(total["matches"]), "rounds": len(total["rounds"]),
            "roundKeys": round_keys(total["rounds"]),
            "observedRounds": len(total["observed_rounds"]),
            "observedRoundKeys": round_keys(total["observed_rounds"]),
            "holdingRoundKeys": round_keys(total["holding_rounds"]),
            "povs": len(total["povs"]), "roundsWithHolds": len(total["holding_rounds"]),
            "matchesWithHolds": len(total["holding_matches"])})
    return {"layers": layers, "cells": output_cells, "quality": dict(sorted(quality.items())),
            "weaponAudit": [{"weapon": weapon, "weaponId": weapon_id, "eligibleAliveRows": count,
                "inFirearmAllowlist": weapon in FIREARMS,
                "excludedByPreviousAllowlist": weapon in FIREARMS and weapon not in LEGACY_FIREARMS}
                for (weapon, weapon_id), count in sorted(weapon_rows.items(),
                    key=lambda item: (str(item[0][0]), str(item[0][1])))],
            "totalEpisodes": sum(t["episodes"] for t in totals.values()),
            "totalSeconds": round(sum(t["dwell_s"] for t in totals.values()), 6)}


def validated_ticks(connection, cache, pov):
    path = cache / tick_path(pov["ticks_parquet_path"])
    result = connection.execute(f"SELECT {','.join(TICK_COLUMNS)} FROM read_parquet(?) ORDER BY tick", [str(path)])
    rows = [dict(zip(TICK_COLUMNS, values)) for values in result.fetchall()]
    if not rows:
        raise ValueError(f"Empty ticks: {path}")
    for row in rows:
        if (row["match_id"] != pov["match_id"] or row["map_name"] != "de_dust2"
                or int(row["round"]) != pov["round"] or int(row["player"]) != pov["player_slot"]):
            raise ValueError(f"Tick identity mismatch: {path}")
        if row["t"] is not None and abs(row["t"] - (row["tick"] - pov["capture_start_tick"]) / HZ) > 0.0001:
            raise ValueError(f"Unexpected timestamp clock: {path}")
    if rows[0]["tick"] != pov["capture_start_tick"] or rows[-1]["tick"] < pov["capture_end_tick"] - 1:
        raise ValueError(f"Truncated POV capture: {path}")
    return rows


def reserve_tick_sizes(povs, remaining):
    sizes = [p["sidecar_bytes"] for p in povs]
    if any(not isinstance(size, int) or isinstance(size, bool) or size <= 0 for size in sizes):
        raise ValueError("Invalid published sidecar byte reservation")
    if sum(sizes) > remaining:
        raise ValueError("Published sidecar sizes exceed the remaining sample byte cap")
    return sizes


def run(args):
    cache = args.cache.resolve()
    budget = [args.max_mib * 1024 * 1024]
    manifest_path = cache / "sample-manifest.json"
    previous_manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
    if previous_manifest and previous_manifest["revision"] != REVISION:
        raise ValueError("Cached manifest has a different revision")
    expected = {f["path"]: f["sha256"] for f in previous_manifest["files"]} if previous_manifest else {}
    sources = [fetch(cache, path, budget, sha, args.download) for path, sha in PINNED.items()]
    readme = (cache / "README.md").read_text(encoding="utf-8")
    if "license: cc-by-4.0" not in readme or "CC-BY-4.0" not in readme:
        raise ValueError("Pinned README license declaration missing")
    connection = parquet_reader()
    match_index, round_index, pov_index = [index_rows(connection, cache, name)
                                         for name in ("matches", "rounds", "pov_rounds")]
    planted = [r for r in round_index if r["bomb_plant_tick"] is not None]
    diagnostics = {
        "dust2_planted_rounds": len(planted),
        "raw_plant_site_labels": dict(sorted(Counter(r["bomb_site"] for r in planted).items())),
        "raw_plant_site_ids": dict(sorted(Counter(str(r["bomb_site_id"]) for r in planted).items())),
        "site_conditioning_available": False,
        "site_warning": "Pinned Dust2 index labels every plant bombsite_b and every site ID 0; labels are unusable, not verified site observations",
    }
    matches, rounds, povs, population = select_sample(match_index, round_index, pov_index, args.matches, args.rounds)
    print(json.dumps({"selected_matches": [m["match_id"] for m in matches],
        "rounds": len(rounds), "tick_downloads": len(povs),
        "estimated_tick_bytes": sum(p["sidecar_bytes"] for p in povs), "population": population}), flush=True)
    sizes = reserve_tick_sizes(povs, budget[0])
    def verify(pov):
        path = tick_path(pov["ticks_parquet_path"])
        # Each worker has a reserved slice of the cap; no shared-budget race.
        source = fetch(cache, path, [pov["sidecar_bytes"]], expected.get(path), args.download)
        return source
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, source in enumerate(pool.map(verify, povs)):
            sources.append(source)
            if (i + 1) % 20 == 0:
                print(f"Verified {i + 1}/{len(povs)} tick files", flush=True)
    diagnostics["sidecar_size_metadata_mismatches"] = sum(
        source["bytes"] != pov["sidecar_bytes"] for source, pov in zip(sources[4:], povs))
    diagnostics["published_sidecar_bytes"] = sum(sizes)
    diagnostics["actual_sidecar_bytes"] = sum(source["bytes"] for source in sources[4:])
    same_inputs = previous_manifest and previous_manifest["files"] == sources
    acquired = previous_manifest["acquired_at_utc"] if same_inputs else datetime.now(timezone.utc).isoformat()
    manifest = {"revision": REVISION, "seed": SEED, "acquired_at_utc": acquired, "files": sources}
    round_lookup = {(r["match_id"], r["round"]): r for r in rounds}
    def streams():
        for i, pov in enumerate(povs):
            yield validated_ticks(connection, cache, pov), round_lookup[(pov["match_id"], pov["round"])], pov
            if (i + 1) % 128 == 0:
                print(f"Aggregated {i + 1}/{len(povs)} POVs", flush=True)
    result = aggregate(streams(), args.speed, args.min_dwell, args.xy_bin, args.z_bin)
    diagnostics["weapon_columns"] = ["input_weapon", "input_weapon_id"]
    diagnostics["eligible_alive_weapon_rows"] = result.pop("weaponAudit")
    diagnostics["previous_allowlist_excluded_firearm_rows"] = sum(
        entry["eligibleAliveRows"] for entry in diagnostics["eligible_alive_weapon_rows"]
        if entry["excludedByPreviousAllowlist"])
    output = {"schemaVersion": 1, "mapId": "de_dust2", "status": "empirical_bounded_sample",
        "coordinate_system": "Source xyz; floor-indexed bins; no browser transform or spawn validation",
        "probability_claim": "Unique sampled-round support for qualifying holds; regional unions divided by matching side/phase sampled rounds are descriptive sample frequencies, not opponent-presence or population probabilities",
        "source": {"author": "Julien Blanchon", "title": "OpenCS2 Dataset", "dataset": DATASET,
            "url": f"https://huggingface.co/datasets/{DATASET}/tree/{REVISION}",
            "bucket_url": f"https://huggingface.co/buckets/{DATASET}",
            "revision": REVISION, "license": "CC-BY-4.0",
            "license_caveat": "Author declares renders/metadata CC-BY-4.0; HLTV demo source subject to original tournament terms; independent rights clearance not established",
            "acquired_at_utc": acquired, "reader": "duckdb==1.4.4",
            "files": [[f["path"], f["bytes"], f["sha256"]] for f in sources]},
        "method": {"selection_seed": SEED, "selection": "SHA-256 ranked complete matches, then ranked rounds; all ten POVs",
            "speed_max_u_s": args.speed, "displacement_max_u_s": args.speed + 1,
            "min_episode_s": args.min_dwell, "tick_hz": HZ, "max_tick_gap": 1,
            "bin_size_xyz": [args.xy_bin, args.xy_bin, args.z_bin], "bin_origin_xyz": [0, 0, 0],
            "dwell_allocation": "Left endpoint of adjacent eligible intervals; no terminal extrapolation",
            "episode_anchor": "Greatest-dwell bin; lexicographic tie-break; visits may span bins",
            "round_support": "Unique match_id/round keys; union cells before counting regional support",
            "primary_signal": "Union nearby same-side/phase cell roundKeys, intersect layer roundKeys; episodes, anchors and dwell are diagnostic, not the regional support numerator",
            "training_weight_interpretation": "Parent normalizes 1 + unique nearby supported rounds within each validated course; unknowns retain exploration weight; bots/run is a separate training setting",
            "layer_round_denominator": "roundKeys: sampled phase-potential rounds; observedRoundKeys: rounds with adjacent alive intervals",
            "weapon_column": "input_weapon; input_weapon_id retained for measured name/ID audit; no separate equipped-weapon column in sidecars",
            "firearm_allowlist": sorted(FIREARMS), "movement_inputs_excluded": sorted(MOVEMENT_INPUTS),
            "busy_inputs_excluded": sorted(BUSY_INPUTS),
            "excluded": ["freeze", "dead/health<=0", "round-end/post-round", "invalid state", "nonadjacent ticks", "phase-crossing intervals", "inconsistent side", "knife/utility/C4/unknown weapon", "movement input", "busy or missing input"]},
        "sample": {**population, "matches": len(matches), "rounds": len(rounds), "povs": len(povs),
            "plant_rounds": sum(r["bomb_plant_tick"] is not None for r in rounds),
            "source_bytes": sum(f["bytes"] for f in sources),
            "match_metadata": [{k: m[k] for k in ("match_id", "match_date", "event", "team1", "team2", "match_url")} for m in matches],
            "round_metadata": [{k: r[k] for k in ("match_id", "round", "freeze_end_tick", "round_end_tick", "bomb_plant_tick")} for r in rounds]},
        "source_diagnostics": diagnostics,
        "confidence": {"level": "low/exploratory", "independent_match_clusters": len(matches),
            "cell_support": "Union roundKeys for unique observed round support; rounds within matches and repeated teams remain correlated",
            "population_probability": None, "confidence_interval": None,
            "limitations": ["Small nonrepresentative tournament sample", "Low speed does not prove angle-holding intent", "T preplant includes attacking pauses", "CT postplant includes retakes and saves", "Bin/threshold/map-version sensitivity", "Unusable upstream bomb-site labels; no site conditioning", "No line-of-sight, economy, weapon, stance, or route conditioning", "No FACEIT population evidence"]},
        **result}
    # Publish only after the full selection has passed tick validation and aggregation.
    atomic_json(manifest_path, manifest)
    atomic_json(args.output, output, compact=True)
    print(json.dumps({"output": str(args.output), "cells": len(result["cells"]),
        "totalEpisodes": result["totalEpisodes"], "totalSeconds": result["totalSeconds"],
        "layers": [{k: v for k, v in layer.items() if not k.endswith("Keys")}
                   for layer in result["layers"]], "quality": result["quality"]}), flush=True)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Explicit opt-in to bounded metadata/ticks network access")
    parser.add_argument("--cache", type=Path, default=ROOT / "research" / "prefire-statistics")
    parser.add_argument("--output", type=Path, default=ROOT / "src/range/prefire/data/dust2-hold-density.json")
    parser.add_argument("--matches", type=int, default=MAX_MATCHES)
    parser.add_argument("--rounds", type=int, default=MAX_ROUNDS, help="Complete sampled rounds per match")
    parser.add_argument("--max-mib", type=int, default=MAX_MIB)
    parser.add_argument("--workers", type=int, default=4, help="1..4 bounded sidecar verification/download workers")
    parser.add_argument("--speed", type=float, default=20.0)
    parser.add_argument("--min-dwell", type=float, default=0.5)
    parser.add_argument("--xy-bin", type=int, default=64)
    parser.add_argument("--z-bin", type=int, default=32)
    args = parser.parse_args(argv)
    if not (1 <= args.matches <= MAX_MATCHES and 1 <= args.rounds <= MAX_ROUNDS
            and 1 <= args.max_mib <= MAX_MIB and 1 <= args.workers <= MAX_WORKERS):
        parser.error("Bounded importer allows 1..32 matches, 1..8 rounds/match, 1..1024 MiB, 1..4 workers")
    if not all(math.isfinite(v) and v > 0 for v in (args.speed, args.min_dwell, args.xy_bin, args.z_bin)):
        parser.error("Thresholds and bin sizes must be positive finite numbers")
    return args


def main():
    args = parse_args()
    try:
        run(args)
    except (ValueError, OSError) as error:
        print(f"Import blocked: {error}. No fabricated aggregate written.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
