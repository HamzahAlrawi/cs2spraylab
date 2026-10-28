"""Offline coverage audit of the attached public Dust2 duel-coordinate source.

Combat-event coordinates are coverage leads, NEVER holding/encounter probabilities.
No game process access or browser runtime dependency.
"""
import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVISION = "04f94b0ad6600c39f019bf65f46a08b13cdce3f1"
EXPECTED_SHA256 = "61d1471513107aa511cb395c7954a618e351087f3f527c9b35edff090c15b134"
SOURCE = "https://github.com/GameOperator13/cs2-dust2-duel-density"


def read_encounters(path, expected_sha=EXPECTED_SHA256):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected_sha:
        raise ValueError("Position-source checksum mismatch; inspect/pin a new revision first")
    rows, ids, incomplete = [], set(), 0
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {"kill_id", "match_id", "map_name", "attacker_side", "victim_side"}
        required |= {f"{role}_{axis}" for role in ["attacker", "victim"] for axis in "XYZ"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("Missing paired combat coordinates")
        for row in reader:
            if row["map_name"] != "de_dust2" or not row["kill_id"] or row["kill_id"] in ids:
                raise ValueError("Wrong map or duplicate engagement identity")
            ids.add(row["kill_id"])
            if any(not row[f"{role}_{axis}"].strip() for role in ["attacker", "victim"] for axis in "XYZ"):
                incomplete += 1
                continue
            points = {}
            for role in ["attacker", "victim"]:
                point = [float(row[f"{role}_{axis}"]) for axis in "XYZ"]
                if not all(math.isfinite(n) and abs(n) <= 32768 for n in point):
                    raise ValueError("Invalid source coordinates")
                side = row[f"{role}_side"].lower()
                if side not in ["ct", "t"]:
                    raise ValueError("Unknown source team")
                points[role] = {"point": point, "side": side}
            rows.append({"id": row["kill_id"], "match": row["match_id"], **points})
    return rows, digest, {"sourceRows": len(ids), "excludedIncompletePairs": incomplete}


def coverage(rows, positions, prior_matches=()):
    cells = defaultdict(lambda: {"events": set(), "matches": set(), "sample": None})
    covered = 0
    for row in rows:
        for role in ["attacker", "victim"]:
            point, side = row[role]["point"], row[role]["side"]
            if any(math.hypot(point[0]-p[0], point[1]-p[1]) <= 96 and abs(point[2]-p[2]) <= 64 for p in positions):
                covered += 1
                continue
            key = (side, *(math.floor(n/128) for n in point))
            cell = cells[key]
            cell["events"].add(row["id"])
            cell["matches"].add(row["match"])
            # An actual source sample, not an invented centroid spawn position.
            if cell["sample"] is None:
                cell["sample"] = {"killId": row["id"], "role": role, "position": point}
    matches = {row["match"] for row in rows}
    return {"engagements": len(rows), "matches": len(matches), "coordinateSamples": 2*len(rows),
            "nearAuthoredCoordinateSamples": covered, "overlappingPriorMatches": sorted(matches & set(prior_matches)),
            "uncoveredLeads": [{"side": key[0], "cell": key[1:], "events": len(value["events"]),
                "matches": len(value["matches"]), "sample": value["sample"]}
                for key, value in sorted(cells.items(), key=lambda entry: (-len(entry[1]["matches"]), -len(entry[1]["events"]), entry[0]))[:40]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT/"research/position-sources/dust2_kills_with_coords.csv")
    parser.add_argument("--output", type=Path, default=ROOT/"research/position-sources/coverage-report.json")
    args = parser.parse_args()
    rows, digest, diagnostics = read_encounters(args.input)
    folder = ROOT/"src/range/prefire/data"
    primary = json.loads((folder/"openprefire-dust2.json").read_text())
    retakes = json.loads((folder/"retakes-dust2.json").read_text())
    authored = json.loads((folder/"authored-dust2.json").read_text())
    combat_leads = json.loads((folder/"combat-dust2-leads.json").read_text())
    pools = json.loads((folder/"dust2-weighted-pools.json").read_text())
    density = json.loads((folder/"dust2-hold-density.json").read_text())
    positions = []
    for identity in sorted({identity for entries in pools["routes"].values() for identity in entries}):
        kind, value = identity.split(":", 1)
        profile, index = value.split("/", 1)
        if kind == "openprefire":
            position = primary["profiles"][profile]["angles"][int(index.split(":")[0])-1]["position"]
        elif kind == "retakes":
            position = retakes["angles"][int(index)-1]["position"]
        elif kind == "spraylab":
            position = next(angle["position"] for angle in authored["angles"] if angle["id"] == index)
        elif kind == "duel-density":
            position = next(angle["position"] for angle in combat_leads["angles"] if angle["id"] == index)
        else:
            raise ValueError(f"Unknown admitted source {kind}")
        positions.append(position)
    prior = [str(match["match_id"]) for match in density.get("sample", {}).get("match_metadata", [])]
    result = {"source": {"url": SOURCE, "revision": REVISION, "sha256": digest, "license": "CC-BY-4.0",
        "lineage": "OpenCS2; not independent of the existing OpenCS2 hold sample"},
        "method": "Paired kill coordinates within 96 horizontal / 64 vertical Source units of admitted practice points; unmatched 128-unit cells are review leads only.",
        "limitations": ["Not holding probabilities", "No visibility, stance, input, economy or route conditioning", "No spawn positions are published automatically", "Attacker/victim samples are paired, not independent events"],
        "admittedUniqueHolds": len(positions), "sourceDiagnostics": diagnostics, **coverage(rows, positions, prior)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ["engagements", "matches", "coordinateSamples", "nearAuthoredCoordinateSamples", "admittedUniqueHolds"]}))


if __name__ == "__main__":
    main()
