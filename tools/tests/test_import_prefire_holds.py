"""Synthetic importer tests; fixtures are never exported as empirical statistics."""

from collections import Counter
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "import-prefire-holds.py"
SPEC = importlib.util.spec_from_file_location("prefire_holds", MODULE_PATH)
holds = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(holds)


def tick(n, side="ct", **changes):
    row = {"tick": n, "t": n / 64, "is_alive": True, "health": 100,
           "team_num": 3 if side == "ct" else 2, "x": -1.0, "y": 65.0, "z": -33.0,
           "velocity_x": 0.0, "velocity_y": 0.0, "velocity_z": 0.0,
           "input_weapon": "ak47", "active": []}
    return {**row, **changes}


def round_row(**changes):
    return {"match_id": 1, "round": 1, "freeze_end_tick": 0,
            "round_end_tick": 1000, "bomb_plant_tick": None,
            "has_bomb_plant": False, **changes}


def pov(side="ct", **changes):
    return {"match_id": 1, "round": 1, "player_slot": 0, "player_side": side.upper(),
            "capture_start_tick": 0, "capture_end_tick": 1000, "death_tick": None, **changes}


class EpisodeTests(unittest.TestCase):
    def compute(self, rows, r=None, p=None, **kwargs):
        return holds.aggregate([(rows, r or round_row(), p or pov())], **kwargs)

    def test_exact_half_second_and_no_final_extrapolation(self):
        result = self.compute([tick(n) for n in range(33)])
        self.assertEqual(result["totalEpisodes"], 1)
        self.assertEqual(result["totalSeconds"], 0.5)
        self.assertEqual(result["cells"][0]["bin"], [-1, 1, -2])
        self.assertEqual(result["cells"][0]["position"], [-1.0, 65.0, -33.0])

    def test_short_stop_not_hold(self):
        self.assertEqual(self.compute([tick(n) for n in range(32)])["totalEpisodes"], 0)

    def test_freeze_and_post_round_not_holds(self):
        result = self.compute([tick(n) for n in range(200)],
                              round_row(freeze_end_tick=64, round_end_tick=97))
        self.assertEqual(result["totalSeconds"], 0.5)

    def test_dead_and_zero_health_not_holds(self):
        for change in ({"is_alive": False}, {"health": 0}, {"health": None}):
            with self.subTest(change=change):
                rows = [tick(n, **(change if n >= 33 else {})) for n in range(100)]
                self.assertEqual(self.compute(rows)["totalSeconds"], 0.5)

    def test_index_death_tick_clips_false_alive_rows(self):
        result = self.compute([tick(n) for n in range(100)], p=pov(death_tick=33))
        self.assertEqual(result["totalSeconds"], 0.5)

    def test_both_sides_and_both_phases_kept_separate(self):
        r = round_row(bomb_plant_tick=64, has_bomb_plant=True)
        streams = [([tick(n, side) for n in range(129)], r, pov(side)) for side in ("ct", "t")]
        result = holds.aggregate(streams)
        labels = {(c["side"], c["context"]) for c in result["cells"]}
        self.assertEqual(labels, {("ct", "preplant"), ("ct", "postplant"),
                                  ("t", "preplant"), ("t", "postplant")})
        self.assertEqual(result["totalEpisodes"], 4)
        self.assertAlmostEqual(result["totalSeconds"], 2 * (63 / 64 + 1))

    def test_no_hold_bridged_across_phase(self):
        rows = [tick(n) for n in range(33)]
        result = self.compute(rows, round_row(bomb_plant_tick=16, has_bomb_plant=True))
        self.assertEqual(result["totalEpisodes"], 0)

    def test_tick_and_time_gaps_split_short_episodes(self):
        rows = [tick(n) for n in list(range(20)) + list(range(21, 41))]
        result = self.compute(rows)
        self.assertEqual(result["totalEpisodes"], 0)
        self.assertEqual(result["quality"]["gap_intervals"], 1)
        rows = [tick(n, t=n / 64 + (1 if n >= 20 else 0)) for n in range(40)]
        self.assertEqual(self.compute(rows)["totalEpisodes"], 0)

    def test_duplicate_ticks_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.compute([tick(0), tick(0)])

    def test_invalid_state_breaks_episode(self):
        rows = [tick(n, x=float("nan") if n == 20 else -1.0) for n in range(41)]
        result = self.compute(rows)
        self.assertEqual(result["totalEpisodes"], 0)
        self.assertEqual(result["quality"]["invalid_state_rows"], 1)

    def test_speed_boundary_and_vertical_motion(self):
        for speed, expected in ((20, 1), (20.001, 0)):
            rows = [tick(n, velocity_z=speed) for n in range(33)]
            self.assertEqual(self.compute(rows)["totalEpisodes"], expected)

    def test_stationary_teleport_not_integrated(self):
        rows = [tick(n, x=1000.0 if n >= 20 else -1.0) for n in range(40)]
        result = self.compute(rows)
        self.assertEqual(result["totalEpisodes"], 0)
        self.assertEqual(result["quality"]["displacement_rejected_intervals"], 1)

    def test_side_mismatch_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "side"):
            self.compute([tick(n, "t") for n in range(33)])

    def test_knife_utility_c4_and_unknown_weapon_not_holds(self):
        for weapon in ("knife", "knife_butterfly", "m9bayonet", "flashbang", "smokegrenade",
                       "molotov", "c4explosive", "taser", None, "unrecognized"):
            with self.subTest(weapon=weapon):
                result = self.compute([tick(n, input_weapon=weapon, input_weapon_id=1) for n in range(65)])
                self.assertEqual(result["totalEpisodes"], 0)

    def test_zero_speed_with_movement_or_busy_inputs_not_hold(self):
        for button in holds.MOVEMENT_INPUTS | holds.BUSY_INPUTS:
            with self.subTest(button=button):
                result = self.compute([tick(n, active=[button]) for n in range(65)])
                self.assertEqual(result["totalEpisodes"], 0)
        self.assertEqual(self.compute([tick(n, active=None) for n in range(65)])["totalEpisodes"], 0)
        self.assertEqual(self.compute([tick(n, active=["duck", "speed"]) for n in range(65)])["totalEpisodes"], 1)

    def test_weapon_switch_breaks_contiguity(self):
        result = self.compute([tick(n, input_weapon="flashbang" if n == 20 else "ak47") for n in range(41)])
        self.assertEqual(result["totalEpisodes"], 0)

    def test_bin_crossing_conserves_anchors_and_dwell(self):
        rows = [tick(n, x=63.9 + n * 0.01, velocity_x=0.64) for n in range(65)]
        result = self.compute(rows)
        self.assertEqual(len(result["cells"]), 2)
        self.assertEqual(sum(c["episodeAnchors"] for c in result["cells"]), 1)
        self.assertEqual(sum(c["episodes"] for c in result["cells"]), 2)
        self.assertAlmostEqual(sum(c["seconds"] for c in result["cells"]), 1.0)
        self.assertEqual([c["roundKeys"] for c in result["cells"]], [["1/1"], ["1/1"]])
        self.assertTrue(any(c["episodeAnchors"] == 0 and c["roundKeys"] == ["1/1"] for c in result["cells"]))

    def test_match_and_round_support_not_tick_counts(self):
        streams = [([tick(n) for n in range(65)], round_row(), pov(player_slot=slot)) for slot in range(2)]
        result = holds.aggregate(streams)
        self.assertEqual(result["cells"][0]["matches"], 1)
        self.assertEqual(result["cells"][0]["rounds"], 1)
        self.assertEqual(result["cells"][0]["episodes"], 2)
        self.assertEqual(result["cells"][0]["roundKeys"], ["1/1"])

    def test_regional_union_deduplicates_episodes_players_and_cells(self):
        streams = [([tick(n, x=63.9 + n * 0.01) for n in range(65)], round_row(), pov()),
                   ([tick(n, x=70, active=["reload"] if n == 33 else []) for n in range(67)],
                    round_row(), pov(player_slot=1))]
        for match_id, number in ((1, 2), (2, 1)):
            streams.append(([tick(n, x=70) for n in range(33)],
                            round_row(match_id=match_id, round=number),
                            pov(match_id=match_id, round=number)))
        result = holds.aggregate(streams)
        support = set().union(*(set(c["roundKeys"]) for c in result["cells"]))
        self.assertEqual(support, {"1/1", "1/2", "2/1"})
        self.assertGreater(sum(c["rounds"] for c in result["cells"]), len(support))
        layer = next(l for l in result["layers"] if l["side"] == "ct" and l["context"] == "preplant")
        self.assertEqual(layer["roundKeys"], ["1/1", "1/2", "2/1"])
        self.assertEqual(layer["observedRoundKeys"], layer["roundKeys"])
        self.assertEqual(layer["holdingRoundKeys"], layer["roundKeys"])
        self.assertEqual(len(support) / layer["rounds"], 1)

    def test_sampled_denominator_includes_no_hold_and_unobserved_phase(self):
        r = round_row(bomb_plant_tick=64, has_bomb_plant=True)
        result = self.compute([tick(n, active=["forward"]) for n in range(33)], r,
                              pov(death_tick=33))
        layers = {(l["side"], l["context"]): l for l in result["layers"]}
        pre, post = layers[("ct", "preplant")], layers[("ct", "postplant")]
        self.assertEqual(pre["roundKeys"], ["1/1"])
        self.assertEqual(pre["observedRoundKeys"], ["1/1"])
        self.assertEqual(pre["holdingRoundKeys"], [])
        self.assertEqual(post["roundKeys"], ["1/1"])
        self.assertEqual(post["observedRoundKeys"], [])
        self.assertEqual(post["observedRounds"], 0)
        self.assertEqual(layers[("t", "preplant")]["roundKeys"], [])
        self.assertEqual(result["cells"], [])

    def test_all_standard_firearms_are_eligible_without_changing_weapon_data(self):
        expected = {"aug", "sg556", "bizon", "p90", "mp5sd", "ump45", "m249", "negev",
                    "g3sg1", "scar20", "nova", "xm1014", "mag7", "sawedoff", "cz75a", "revolver"}
        self.assertEqual(holds.FIREARMS - holds.LEGACY_FIREARMS, expected)
        for weapon in holds.FIREARMS:
            with self.subTest(weapon=weapon):
                result = self.compute([tick(n, input_weapon=weapon, input_weapon_id=39) for n in range(33)])
                self.assertEqual(result["totalEpisodes"], 1)
                self.assertEqual(result["weaponAudit"][0]["eligibleAliveRows"], 33)
                self.assertEqual(result["weaponAudit"][0]["weaponId"], 39)
        self.assertEqual(self.compute([tick(n, input_weapon="taser") for n in range(33)])["totalEpisodes"], 0)


class InputTests(unittest.TestCase):
    def test_paths_allow_only_dust2_ticks(self):
        valid = "rounds/match_id=123/map_name=de_dust2/round=01/player=00/ticks.parquet"
        self.assertEqual(holds.tick_path(f"hf://datasets/{holds.DATASET}@main/{valid}"), valid)
        for path in (valid.replace("ticks.parquet", "video.mp4"),
                     valid.replace("de_dust2", "de_mirage"), "../ticks.parquet",
                     "https://example.com/ticks.parquet", "events/kills.parquet"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                holds.tick_path(path)

    def test_cache_hash_and_budget_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            (cache / "README.md").write_bytes(b"test")
            expected = hashlib.sha256(b"test").hexdigest()
            source = holds.fetch(cache, "README.md", [4], expected)
            self.assertEqual(source["sha256"], expected)
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                holds.fetch(cache, "README.md", [4], "wrong")
            with self.assertRaisesRegex(ValueError, "max-mib"):
                holds.fetch(cache, "README.md", [3], expected)
            with self.assertRaisesRegex(ValueError, "Missing"):
                holds.fetch(cache, "index/rounds.parquet", [100])

    def test_download_requires_explicit_opt_in_and_never_fetches_media(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(holds.urllib.request, "urlopen") as opened:
            with self.assertRaisesRegex(ValueError, "--download"):
                holds.fetch(Path(directory), "README.md", [100])
            with self.assertRaises(ValueError):
                holds.fetch(Path(directory), "events/kills.parquet", [100], download=True)
            opened.assert_not_called()

    def test_failed_download_cap_or_hash_does_not_promote_partial(self):
        for cap, expected, message in ((3, None, "byte cap"), (10, "wrong", "SHA-256")):
            with self.subTest(cap=cap), tempfile.TemporaryDirectory() as directory:
                response = io.BytesIO(b"test")
                response.headers = {}
                with patch.object(holds.urllib.request, "urlopen", return_value=response):
                    with self.assertRaisesRegex(ValueError, message):
                        holds.fetch(Path(directory), "README.md", [cap], expected, download=True)
                self.assertFalse((Path(directory) / "README.md").exists())
                self.assertFalse((Path(directory) / "README.md.partial").exists())

    def test_atomic_serialization_failure_preserves_previous_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "holds.json"
            output.write_bytes(b"previous measured sample\n")
            with self.assertRaises(ValueError):
                holds.atomic_json(output, {"invalid": float("nan")}, compact=True)
            self.assertEqual(output.read_bytes(), b"previous measured sample\n")
            self.assertFalse(output.with_suffix(".json.partial").exists())

    def test_tick_validation_failure_preserves_output_and_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            (cache / "README.md").write_text("license: cc-by-4.0\nCC-BY-4.0", encoding="utf-8")
            manifest = cache / "sample-manifest.json"
            manifest.write_text(json.dumps({"revision": holds.REVISION, "files": [],
                                           "acquired_at_utc": "prior"}), encoding="utf-8")
            output = cache / "holds.json"
            output.write_bytes(b"previous measured sample\n")
            prior_manifest = manifest.read_bytes()
            p = pov(sidecar_bytes=10, ticks_parquet_path="rounds/match_id=1/map_name=de_dust2/round=01/player=00/ticks.parquet")
            args = holds.parse_args(["--cache", str(cache), "--output", str(output), "--matches", "1", "--rounds", "1"])
            with patch.object(holds, "fetch", side_effect=lambda cache, path, *args: {"path": path, "bytes": 1, "sha256": "hash"}), \
                 patch.object(holds, "parquet_reader"), \
                 patch.object(holds, "index_rows", side_effect=[[{"match_id": 1}], [round_row()], [p]]), \
                 patch.object(holds, "select_sample", return_value=([{"match_id": 1}], [round_row()], [p], {})), \
                 patch.object(holds, "validated_ticks", side_effect=ValueError("Truncated POV capture")), \
                 redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(ValueError, "Truncated"):
                    holds.run(args)
            self.assertEqual(output.read_bytes(), b"previous measured sample\n")
            self.assertEqual(manifest.read_bytes(), prior_manifest)

    def test_cli_larger_defaults_and_hard_bounds(self):
        args = holds.parse_args([])
        self.assertEqual((args.matches, args.rounds, args.max_mib, args.workers), (32, 8, 1024, 4))
        self.assertFalse(args.download)
        for option, value in (("--matches", "33"), ("--rounds", "9"), ("--max-mib", "1025"),
                              ("--workers", "5"), ("--workers", "0"), ("--speed", "nan")):
            with self.subTest(option=option), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                holds.parse_args([option, value])

    def test_larger_byte_reservations_include_cached_inputs(self):
        povs = [{"sidecar_bytes": 170000} for _ in range(2560)]
        self.assertEqual(sum(holds.reserve_tick_sizes(povs, 1024 * 1024 * 1024 - 9000000)), 435200000)
        with self.assertRaisesRegex(ValueError, "remaining sample byte cap"):
            holds.reserve_tick_sizes(povs, 435199999)
        for size in (None, 0, -1, True, 1.5):
            with self.subTest(size=size), self.assertRaisesRegex(ValueError, "Invalid"):
                holds.reserve_tick_sizes([{"sidecar_bytes": size}], 1024 * 1024 * 1024)

    def test_selection_is_deterministic_and_all_players(self):
        matches = [{"match_id": i} for i in range(1, 6)]
        rounds, povs = [], []
        for match in matches:
            for number in range(1, 5):
                rounds.append(round_row(match_id=match["match_id"], round=number))
                for slot in range(10):
                    povs.append(pov("ct" if slot < 5 else "t", match_id=match["match_id"],
                        round=number, player_slot=slot,
                        ticks_parquet_path=f"rounds/match_id={match['match_id']}/map_name=de_dust2/round={number:02}/player={slot:02}/ticks.parquet"))
        first = holds.select_sample(matches, rounds, povs)
        second = holds.select_sample(matches[::-1], rounds[::-1], povs[::-1])
        self.assertEqual(first, second)
        self.assertEqual(len(first[0]), 4)
        self.assertEqual(len(first[1]), 12)
        self.assertEqual(len(first[2]), 120)
        incomplete = [p for p in povs if p["player_slot"] != 9]
        with self.assertRaisesRegex(ValueError, "Insufficient"):
            holds.select_sample(matches, rounds, incomplete)

    def test_full_32_match_eight_round_selection_is_bounded_and_reproducible(self):
        matches = [{"match_id": i} for i in range(1, 35)]
        rounds, povs = [], []
        for match in matches:
            for number in range(1, 10):
                rounds.append(round_row(match_id=match["match_id"], round=number))
                for slot in range(10):
                    povs.append(pov("ct" if slot < 5 else "t", match_id=match["match_id"],
                        round=number, player_slot=slot,
                        ticks_parquet_path=f"rounds/match_id={match['match_id']}/map_name=de_dust2/round={number:02}/player={slot:02}/ticks.parquet"))
        first = holds.select_sample(matches, rounds, povs, 32, 8)
        self.assertEqual(first, holds.select_sample(matches[::-1], rounds[::-1], povs[::-1], 32, 8))
        self.assertEqual(tuple(len(value) for value in first[:3]), (32, 256, 2560))
        self.assertEqual(set(Counter(r["match_id"] for r in first[1]).values()), {8})
        for counts in ((33, 8), (32, 9)):
            with self.assertRaisesRegex(ValueError, "bounded"):
                holds.select_sample(matches, rounds, povs, *counts)


class PublishedAggregateTests(unittest.TestCase):
    def test_empirical_aggregate_provenance_and_conservation(self):
        path = holds.ROOT / "src/range/prefire/data/dust2-hold-density.json"
        if not path.exists():
            self.skipTest("Run importer against real cached ticks first")
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(data["source"]["revision"], holds.REVISION)
        self.assertEqual(data["sample"]["povs"], 10 * data["sample"]["rounds"])
        self.assertEqual(len(data["source"]["files"]), 4 + data["sample"]["povs"])
        self.assertEqual(data["totalEpisodes"], sum(c["episodeAnchors"] for c in data["cells"]))
        self.assertAlmostEqual(data["totalSeconds"], sum(c["seconds"] for c in data["cells"]), places=4)
        self.assertEqual(data["totalEpisodes"], sum(layer["episodes"] for layer in data["layers"]))
        for cell in data["cells"]:
            self.assertIn(cell["side"], ("ct", "t"))
            self.assertIn(cell["context"], ("preplant", "postplant"))
            self.assertGreater(cell["matches"], 0)
            self.assertLessEqual(cell["matches"], data["sample"]["matches"])
            self.assertLessEqual(cell["episodeAnchors"], cell["episodes"])
        self.assertIsNone(data["confidence"]["population_probability"])

    def test_published_round_keys_are_exact_unionable_layer_subsets(self):
        data = json.loads((holds.ROOT / "src/range/prefire/data/dust2-hold-density.json").read_text(encoding="utf-8"))
        if not data["cells"] or "roundKeys" not in data["cells"][0]:
            self.skipTest("Regenerate the real sample with round-key support first")
        self.assertEqual(data["schemaVersion"], 1)
        self.assertEqual((data["sample"]["matches"], data["sample"]["rounds"], data["sample"]["povs"]), (32, 256, 2560))
        layers = {(l["side"], l["context"]): l for l in data["layers"]}
        metadata_keys = {f"{r['match_id']}/{r['round']}" for r in data["sample"]["round_metadata"]}
        planted_keys = {f"{r['match_id']}/{r['round']}" for r in data["sample"]["round_metadata"]
                        if r["bomb_plant_tick"] is not None}
        for label, layer in layers.items():
            keys = set(layer["roundKeys"])
            self.assertEqual(len(keys), layer["rounds"])
            self.assertEqual(len(layer["roundKeys"]), len(keys))
            self.assertLessEqual(keys, metadata_keys)
            self.assertEqual(keys, planted_keys if label[1] == "postplant" else metadata_keys)
            observed = set(layer["observedRoundKeys"])
            self.assertEqual(len(observed), layer["observedRounds"])
            self.assertLessEqual(observed, keys)
            cells = [c for c in data["cells"] if (c["side"], c["context"]) == label]
            support = set().union(*(set(c["roundKeys"]) for c in cells))
            self.assertEqual(support, set(layer["holdingRoundKeys"]))
            self.assertEqual(len(support), layer["roundsWithHolds"])
            for cell in cells:
                self.assertEqual(len(cell["roundKeys"]), cell["rounds"])
                self.assertEqual(len(set(cell["roundKeys"])), cell["rounds"])
                self.assertEqual(len({key.split("/")[0] for key in cell["roundKeys"]}), cell["matches"])
                self.assertLessEqual(set(cell["roundKeys"]), observed)
        audit = data["source_diagnostics"]["eligible_alive_weapon_rows"]
        self.assertEqual(sum(entry["eligibleAliveRows"] for entry in audit), data["quality"]["eligible_alive_rows"])
        self.assertLessEqual(data["sample"]["source_bytes"], holds.MAX_MIB * 1024 * 1024)
        self.assertIn("Unique sampled-round support", data["probability_claim"])
        self.assertIn("diagnostic", data["method"]["primary_signal"])


if __name__ == "__main__":
    unittest.main()
