"""Offline feasibility audit, not an encounter extractor or a probability fit.

Read one already sampled complete OpenCS2 round; never download or modify density.
Same-tick coverage is diagnostic. Missing source build, stance, reviewed pockets,
rights and approach-arrival measurements cannot be supplied by geometry or inputs.
"""

import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hold_importer", ROOT / "tools/import-prefire-holds.py")
HOLDS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOLDS)


def joint_tick_coverage(streams, round_row):
    """Resolve live states only at the exact tick; an indexed death is absorbing."""
    if len(streams) != 10 or sorted(pov["player_slot"] for pov, _ in streams) != list(range(10)):
        raise ValueError("Require all ten distinct POV slots")
    if Counter(pov["player_side"].lower() for pov, _ in streams) != {"ct": 5, "t": 5}:
        raise ValueError("Require five recorded players on each side")
    indexed = []
    for pov, rows in streams:
        by_tick = {row["tick"]: row for row in rows}
        if len(by_tick) != len(rows):
            raise ValueError("Duplicate source ticks")
        indexed.append((pov, by_tick))
    start, end = round_row["freeze_end_tick"], round_row["round_end_tick"]
    if not isinstance(start, int) or not isinstance(end, int) or not 0 < end - start <= 64 * 300:
        raise ValueError("Require a positive round window of at most 300 seconds")
    totals = {side: {"resolvedTicks": 0, "unresolvedTicks": 0, "aliveCountTicks": Counter()} for side in ("ct", "t")}
    for tick in range(start, end):
        for side in totals:
            alive, resolved = 0, True
            for pov, rows in indexed:
                if pov["player_side"].lower() != side:
                    continue
                death = pov["death_tick"]
                if death is not None and tick >= death:
                    continue
                row = rows.get(tick)
                if (row is None or not HOLDS.finite_state(row) or row["is_alive"] is not True or
                        not isinstance(row["health"], (int, float)) or row["health"] <= 0 or
                        row["team_num"] != {"ct": 3, "t": 2}[side]):
                    resolved = False
                else:
                    alive += 1
            total = totals[side]
            total["resolvedTicks" if resolved else "unresolvedTicks"] += 1
            if resolved:
                total["aliveCountTicks"][str(alive)] += 1
    return {side: {**total, "aliveCountTicks": dict(sorted(total["aliveCountTicks"].items()))} for side, total in totals.items()}


def audit(cache, match_id, round_number):
    manifest_path = cache / "sample-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["revision"] != HOLDS.REVISION:
        raise ValueError("Unrecognized source revision")
    files = {entry["path"]: entry for entry in manifest["files"]}
    if len(files) != len(manifest["files"]):
        raise ValueError("Duplicate manifest input paths")
    verified = []

    def verify(relative):
        if relative not in HOLDS.PINNED:
            HOLDS.tick_path(relative)
        entry = files.get(relative)
        path = cache / relative
        sha = HOLDS.fingerprint(path)
        if not entry or entry["sha256"] != sha or entry["bytes"] != path.stat().st_size:
            raise ValueError(f"Manifest fingerprint mismatch: {relative}")
        if relative in HOLDS.PINNED and sha != HOLDS.PINNED[relative]:
            raise ValueError(f"Pinned input mismatch: {relative}")
        verified.append(entry)

    for relative in HOLDS.PINNED:
        verify(relative)
    connection = HOLDS.parquet_reader()
    try:
        matches, rounds, povs = [HOLDS.index_rows(connection, cache, name) for name in ("matches", "rounds", "pov_rounds")]
        _, sampled_rounds, sampled_povs, _ = HOLDS.select_sample(matches, rounds, povs, 32, 8)
        selected = [r for r in sampled_rounds if (r["match_id"], r["round"]) == (match_id, round_number)]
        if len(selected) != 1:
            raise ValueError("Requested round is not in the frozen complete-round sample")
        round_row = selected[0]
        group = [p for p in sampled_povs if (p["match_id"], p["round"]) == (match_id, round_number)]
        streams, schemas, episodes, seconds, tick_rows = [], {}, 0, 0.0, 0
        for pov in group:
            relative = HOLDS.tick_path(pov["ticks_parquet_path"])
            verify(relative)
            schema = connection.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(cache / relative)]).fetchall()
            schemas[relative] = [column[0] for column in schema]
            rows = HOLDS.validated_ticks(connection, cache, pov)
            streams.append((pov, rows))
            tick_rows += len(rows)
            retained = list(HOLDS.episodes(rows, round_row, pov))
            episodes += len(retained)
            seconds += sum(interval[2] for episode in retained for interval in episode)
        metadata_schemas = {name: [column[0] for column in connection.execute(
            "DESCRIBE SELECT * FROM read_parquet(?)", [str(cache / "index" / f"{name}.parquet")]).fetchall()]
            for name in ("matches", "rounds", "pov_rounds")}
        return {"schemaVersion": 1, "status": "diagnostic-only", "mapId": "de_dust2", "matchId": str(match_id),
            "roundId": str(round_number), "sourceRevision": HOLDS.REVISION,
            "sourceManifestSha256": HOLDS.fingerprint(manifest_path),
            "extractorSha256": HOLDS.fingerprint(Path(__file__)),
            "holdImporterSha256": HOLDS.fingerprint(ROOT / "tools/import-prefire-holds.py"),
            "inputs": verified, "metadataSchemas": metadata_schemas, "tickSchemas": schemas,
            "tickRows": tick_rows, "retainedHoldEpisodes": episodes, "retainedHoldSeconds": seconds,
            "roundWindowTicks": round_row["round_end_tick"] - round_row["freeze_end_tick"],
            "sameTickCoverage": joint_tick_coverage(streams, round_row),
            "sourceGameBuild": None, "measuredStance": None, "jointEncounterProbabilities": None,
            "publicationBlockers": ["No source map-build/geometry compatibility proof",
                "No measured physical stance; DUCK input is not crouch amount",
                "No preregistered observed approach-arrival events or eligible-opportunity denominator",
                "No reviewed raw-foot same-pocket assignments or conservation audit",
                "No independent underlying tournament-demo rights clearance",
                "No independently verified equipped-weapon semantics"],
            "interpretation": "Tick counts measure cache coverage, not independent encounters or frequencies at authored holds. No interpolation, forward fill, centroid matching, weights or runtime evidence is exported."}
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / "research/prefire-statistics")
    parser.add_argument("--match", type=int, required=True)
    parser.add_argument("--round", type=int, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.output and (args.output.resolve().is_relative_to((ROOT / "src").resolve()) or
                            args.output.resolve().is_relative_to((ROOT / "public").resolve()) or
                            args.output.resolve().is_relative_to(args.cache.resolve())):
            raise ValueError("Diagnostic output must not overwrite runtime data or the source cache")
        report = audit(args.cache, args.match, args.round)
        if args.output:
            HOLDS.atomic_json(args.output, report)
        print(json.dumps({key: value for key, value in report.items() if key not in ("inputs", "metadataSchemas", "tickSchemas")}, indent=2))
    except (ValueError, OSError) as error:
        parser.exit(1, f"Cache audit blocked: {error}\n")


if __name__ == "__main__":
    main()
