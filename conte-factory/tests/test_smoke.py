"""Smoke test — pipeline court sans réseau image (mode demo)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config import ensure_dirs
from db.database import fingerprint, init_db, project_path, similar_title_exists
from modules.audio import _normalize_tts_pitch, _normalize_tts_rate
from modules.sourcing import _hero_short_name


class TestBasics(unittest.TestCase):
    def setUp(self) -> None:
        ensure_dirs()
        init_db()

    def test_fingerprint_stable(self) -> None:
        a = fingerprint("Hello   World")
        b = fingerprint("hello world")
        self.assertEqual(a, b)

    def test_hero_short_name(self) -> None:
        name = _hero_short_name(
            "dragon violet foncé qui vole dans les nuages et qui chante"
        )
        self.assertEqual(name, "dragon violet foncé")

    def test_tts_pitch_signed(self) -> None:
        # Edge-TTS refuse '0Hz' sans signe
        self.assertEqual(_normalize_tts_pitch("0Hz"), "+0Hz")
        self.assertEqual(_normalize_tts_pitch("-1Hz"), "-1Hz")
        self.assertEqual(_normalize_tts_rate("8%"), "-8%")

    def test_similar_title(self) -> None:
        # Ne doit pas planter sur base vide
        self.assertFalse(similar_title_exists("titre-inexistant-xyz-999"))

    def test_project_path_create(self) -> None:
        p = project_path(9876, create=True)
        self.assertTrue(p.is_dir())
        story = p / "story.json"
        story.write_text("{}", encoding="utf-8")
        self.assertTrue(story.is_file())
        story.unlink(missing_ok=True)
        p.rmdir()

    def test_sourcing_module_imports(self) -> None:
        from modules.sourcing import ensure_story_files, write_story_to_project

        self.assertTrue(callable(ensure_story_files))
        self.assertTrue(callable(write_story_to_project))

    def test_main_cli_help(self) -> None:
        import subprocess

        r = subprocess.run(
            [sys.executable, str(ROOT / "main.py"), "--help"],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(ROOT),
        )
        self.assertEqual(0, r.returncode, msg=r.stderr[:500])
        self.assertIn("--resume", r.stdout)


if __name__ == "__main__":
    unittest.main()
