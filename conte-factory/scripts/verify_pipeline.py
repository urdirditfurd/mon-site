"""Verification rapide avant lancement pipeline (imports + smoke)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    errors: list[str] = []

    modules = (
        "modules.sourcing",
        "modules.storyboard",
        "modules.audio",
        "modules.i2v_pipeline",
        "modules.clip_prompts",
        "modules.clip_postprocess",
        "modules.montage",
        "main",
    )
    for name in modules:
        try:
            __import__(name)
        except Exception as exc:
            errors.append(f"import {name}: {exc}")

    if not errors:
        try:
            import importlib
            import os

            import config as cfg
            from db.database import create_video, fingerprint, get_video, init_db
            from modules.sourcing import ensure_story_files

            with tempfile.TemporaryDirectory() as tmp:
                os.environ["CONTE_DATA_DIR"] = tmp
                importlib.reload(cfg)
                init_db()
                h = fingerprint(f"verify-{tmp}")
                vid = create_video("Test", "Test", "verify theme", h, "")
                path = ensure_story_files(vid, duration_min=1, age_group="7-10")
                if not (path / "story.json").is_file():
                    errors.append("ensure_story_files: story.json absent")
                if not get_video(vid):
                    errors.append("ensure_story_files: video DB absente")
        except Exception as exc:
            errors.append(f"ensure_story_files: {exc}")

    if not errors:
        suite = unittest.defaultTestLoader.discover(
            str(ROOT / "tests"), pattern="test_smoke.py", top_level_dir=str(ROOT)
        )
        result = unittest.TextTestRunner(verbosity=0).run(suite)
        if not result.wasSuccessful():
            errors.append(
                f"tests: {len(result.failures)} echec(s), {len(result.errors)} erreur(s)"
            )

    if errors:
        print("VERIFICATION ECHEC:")
        for err in errors:
            print(f"  - {err}")
        return 1

    print("VERIFICATION OK — pipeline pret.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
