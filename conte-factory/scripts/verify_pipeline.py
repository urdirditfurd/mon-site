"""Verification avant lancement — compile, imports, tests smoke."""

from __future__ import annotations

import compileall
import importlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SKIP_DIRS = {".venv", "venv", "__pycache__", "pinokio", "node_modules"}


def _compile_all() -> list[str]:
    errors: list[str] = []
    for path in ROOT.rglob("*.py"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        try:
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        except SyntaxError as exc:
            errors.append(f"syntax {path.relative_to(ROOT)}: {exc}")
    return errors


def _import_modules() -> list[str]:
    errors: list[str] = []
    modules = (
        "db.database",
        "modules.sourcing",
        "modules.storyboard",
        "modules.audio",
        "modules.i2v_pipeline",
        "modules.clip_prompts",
        "modules.clip_postprocess",
        "modules.montage",
        "modules.progress",
        "main",
    )
    for name in modules:
        try:
            importlib.import_module(name)
        except Exception as exc:
            errors.append(f"import {name}: {exc}")
    return errors


def _test_ensure_story_files() -> list[str]:
    errors: list[str] = []
    try:
        import os

        import config as cfg
        from db.database import create_video, fingerprint, get_video, init_db
        from modules.sourcing import ensure_story_files

        with tempfile.TemporaryDirectory() as tmp:
            os.environ["CONTE_DATA_DIR"] = tmp
            importlib.reload(cfg)
            import db.database as db_mod

            importlib.reload(db_mod)
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
    return errors


def _run_smoke_tests() -> list[str]:
    errors: list[str] = []
    try:
        test_mod = importlib.import_module("tests.test_smoke")
        suite = unittest.defaultTestLoader.loadTestsFromModule(test_mod)
        result = unittest.TextTestRunner(verbosity=0).run(suite)
        if not result.wasSuccessful():
            errors.append(
                f"test_smoke: {len(result.failures)} echec(s), {len(result.errors)} erreur(s)"
            )
    except Exception as exc:
        errors.append(f"test_smoke: {exc}")
    return errors


def _main_help() -> list[str]:
    errors: list[str] = []
    try:
        proc = subprocess.run(
            [sys.executable, str(ROOT / "main.py"), "--help"],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(ROOT),
        )
        if proc.returncode != 0:
            errors.append(f"main.py --help: code {proc.returncode}\n{proc.stderr[:300]}")
    except Exception as exc:
        errors.append(f"main.py --help: {exc}")
    return errors


def main() -> int:
    errors: list[str] = []
    errors.extend(_compile_all())
    errors.extend(_import_modules())
    if not errors:
        errors.extend(_test_ensure_story_files())
    if not errors:
        errors.extend(_run_smoke_tests())
    if not errors:
        errors.extend(_main_help())

    if errors:
        print("VERIFICATION ECHEC:")
        for err in errors:
            print(f"  - {err}")
        return 1

    print("VERIFICATION OK — pipeline pret.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
