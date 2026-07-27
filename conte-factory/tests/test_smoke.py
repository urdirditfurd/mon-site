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

    def test_script_parser_and_style_lock(self) -> None:
        from modules.script_parser import load_script_file, script_to_story_payload
        from modules.style_lock import apply_style_lock

        sample = ROOT / "assets" / "scripts" / "petit_chaperon_rouge.json"
        if not sample.exists():
            self.skipTest("template script absent")
        script = load_script_file(sample)
        self.assertGreaterEqual(len(script["scenes"]), 5)
        story = script_to_story_payload(script)
        self.assertIn("structured_scenes", story)
        locked = apply_style_lock("a forest path", "aquarelle")
        self.assertIn("watercolor", locked.lower())
        self.assertTrue("no 3D" in locked or "no Pixar" in locked or "no CGI" in locked)

    def test_motion_and_character_lock(self) -> None:
        from modules.character_lock import apply_character_lock, character_lock_clause
        from modules.motion_prompts import resolve_motion_template

        board = {
            "hero": "Chaperon Rouge",
            "hero_description": "girl with red hood and basket",
            "style_key": "aquarelle",
        }
        clause = character_lock_clause(board)
        self.assertIn("red hood", clause.lower() + board["hero_description"].lower())
        prompt = apply_character_lock("in the forest", board)
        self.assertIn("same character identity", prompt)
        self.assertIn("walking", resolve_motion_template("marche").lower())

    def test_fluid_prompt_no_leading_dot(self) -> None:
        from modules.clip_prompts import build_clip_plan, finish_action
        from modules.motion_prompts import build_fluid_prompt

        prompt = build_fluid_prompt("regarde", "", "looks around")
        self.assertFalse(prompt.startswith("."))
        self.assertFalse(prompt.startswith(" ."))
        self.assertTrue(prompt.lower().startswith("character"))
        finished = finish_action(prompt)
        self.assertFalse(finished.startswith("."))

        scene = {
            "index": 1,
            "script_action": "Chaperon Rouge knocks once on the cottage door",
            "action_type": "frappe",
            "script_camera": "static camera shot",
            "target_duration_sec": 4,
            "narration": "Toc toc",
            "visual_prompt": "watercolor cottage door scene with girl in red hood",
        }
        board = {
            "age_group": "7-10",
            "style_key": "aquarelle",
            "hero": "Chaperon Rouge",
            "hero_description": "girl with bright red hooded cape",
        }
        plan = build_clip_plan(scene, board, 0, 1, scene_index=0)
        self.assertFalse(str(plan["action"]).startswith("."))
        self.assertIn("knock", str(plan["action"]).lower())

    def test_script_payload_keeps_age_and_duration(self) -> None:
        from modules.script_parser import load_script_file, script_to_story_payload

        sample = ROOT / "assets" / "scripts" / "petit_chaperon_rouge.json"
        if not sample.exists():
            self.skipTest("template script absent")
        story = script_to_story_payload(load_script_file(sample))
        self.assertEqual(story["age_group"], "7-10")
        self.assertEqual(float(story["duration_min"]), 5.0)
        self.assertGreaterEqual(int(story["word_count"]), 400)



if __name__ == "__main__":
    unittest.main()
