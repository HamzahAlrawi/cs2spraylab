"""Synthetic cache-coverage fixtures, never shipping CS2 observations."""

import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("cache_audit", Path(__file__).parents[1] / "audit-prefire-encounter-cache.py")
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def fixture():
    streams = []
    for slot in range(10):
        side = "ct" if slot < 5 else "t"
        pov = {"player_slot": slot, "player_side": side, "death_tick": None}
        rows = [{"tick": tick, "t": tick / 64, "x": slot * 100, "y": 0, "z": 0,
                 "velocity_x": 0, "velocity_y": 0, "velocity_z": 0, "team_num": 3 if side == "ct" else 2,
                 "is_alive": True, "health": 100} for tick in range(3)]
        streams.append((pov, rows))
    return streams, {"freeze_end_tick": 0, "round_end_tick": 3}


class CacheCoverageTests(unittest.TestCase):
    def test_exact_synchronized_ticks_are_not_independent_matches(self):
        streams, window = fixture()
        for side in AUDIT.joint_tick_coverage(streams, window).values():
            self.assertEqual(side, {"resolvedTicks": 3, "unresolvedTicks": 0, "aliveCountTicks": {"5": 3}})

    def test_missing_live_tick_is_not_forward_filled_or_counted_empty(self):
        streams, window = fixture()
        streams[0][1].pop(1)
        result = AUDIT.joint_tick_coverage(streams, window)
        self.assertEqual(result["ct"]["unresolvedTicks"], 1)
        self.assertEqual(result["ct"]["aliveCountTicks"], {"5": 2})
        self.assertEqual(result["t"]["resolvedTicks"], 3)

    def test_indexed_deaths_are_absorbing_but_missing_predeath_rows_are_unknown(self):
        streams, window = fixture()
        for pov, rows in streams[:5]:
            pov["death_tick"] = 1
            rows.clear()
        result = AUDIT.joint_tick_coverage(streams, window)["ct"]
        self.assertEqual(result, {"resolvedTicks": 2, "unresolvedTicks": 1, "aliveCountTicks": {"0": 2}})

    def test_invalid_feet_and_unknown_side_do_not_form_complete_rosters(self):
        for field, value in [("x", float("nan")), ("team_num", 0), ("is_alive", None)]:
            streams, window = fixture()
            streams[0][1][0][field] = value
            self.assertEqual(AUDIT.joint_tick_coverage(streams, window)["ct"]["unresolvedTicks"], 1)

    def test_duplicate_ticks_partial_slots_and_wrong_side_counts_fail(self):
        streams, window = fixture()
        streams[0][1].append(streams[0][1][0])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            AUDIT.joint_tick_coverage(streams, window)
        streams, window = fixture()
        with self.assertRaisesRegex(ValueError, "ten distinct"):
            AUDIT.joint_tick_coverage(streams[:-1], window)
        streams[0][0]["player_side"] = "t"
        with self.assertRaisesRegex(ValueError, "five recorded"):
            AUDIT.joint_tick_coverage(streams, window)


if __name__ == "__main__":
    unittest.main()
