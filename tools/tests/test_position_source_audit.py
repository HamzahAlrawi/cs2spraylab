import csv
import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("position_audit", Path(__file__).resolve().parents[1]/"audit-position-source.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class SourceAuditTests(unittest.TestCase):
    def fixture(self, rows):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name)/"positions.csv"
        fields = ["kill_id", "match_id", "map_name", "attacker_side", "victim_side"]
        fields += [f"{role}_{axis}" for role in ["attacker", "victim"] for axis in "XYZ"]
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for patch in rows:
                writer.writerow({"kill_id": "event1", "match_id": "m1", "map_name": "de_dust2",
                    "attacker_side": "ct", "victim_side": "t", **{f"{role}_{axis}": 0 for role in ["attacker", "victim"] for axis in "XYZ"}, **patch})
        return path, hashlib.sha256(path.read_bytes()).hexdigest()

    def test_rejects_wrong_revision_and_duplicate_engagement(self):
        path, sha = self.fixture([{}, {}])
        with self.assertRaisesRegex(ValueError, "checksum"):
            audit.read_encounters(path, "0"*64)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            audit.read_encounters(path, sha)

    def test_excludes_incomplete_pairs_without_inventing_coordinates(self):
        path, sha = self.fixture([{}, {"kill_id": "event2", "victim_Z": ""}])
        rows, _, diagnostics = audit.read_encounters(path, sha)
        self.assertEqual(len(rows), 1)
        self.assertEqual(diagnostics, {"sourceRows": 2, "excludedIncompletePairs": 1})

    def test_keeps_paired_roles_and_reports_source_overlap(self):
        path, sha = self.fixture([{"victim_X": 500}, {"kill_id": "event2", "victim_X": 510}])
        rows, _, _ = audit.read_encounters(path, sha)
        result = audit.coverage(rows, [[0, 0, 0]], ["m1"])
        self.assertEqual(result["engagements"], 2)
        self.assertEqual(result["coordinateSamples"], 4)
        self.assertEqual(result["nearAuthoredCoordinateSamples"], 2)
        self.assertEqual(result["overlappingPriorMatches"], ["m1"])
        self.assertEqual(result["uncoveredLeads"][0]["events"], 2)
        self.assertEqual(result["uncoveredLeads"][0]["sample"]["position"], [500, 0, 0])


if __name__ == "__main__":
    unittest.main()
