"""Smoke test — pipeline court sans réseau image (mode demo)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config import ensure_dirs
from db.database import fingerprint, init_db, similar_title_exists
from modules.storyboard import _split_paragraphs


class TestBasics(unittest.TestCase):
    def setUp(self) -> None:
        ensure_dirs()
        init_db()

    def test_fingerprint_stable(self) -> None:
        a = fingerprint("Hello   World")
        b = fingerprint("hello world")
        self.assertEqual(a, b)

    def test_split_paragraphs(self) -> None:
        text = "A. B. C. D. E. F. G. H. I. J."
        parts = _split_paragraphs(text)
        self.assertGreaterEqual(len(parts), 1)

    def test_similar_title(self) -> None:
        # Ne doit pas planter sur base vide
        self.assertFalse(similar_title_exists("titre-inexistant-xyz-999"))


if __name__ == "__main__":
    unittest.main()
