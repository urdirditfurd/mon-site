"""Supprime ai_clips du projet video_id (force re-animation I2V)."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db.database import get_video, project_dir


def main() -> int:
    vid = int(sys.argv[1]) if len(sys.argv) > 1 else 36
    video = get_video(vid)
    if not video:
        # Fallback chemin conventionnel
        p = project_dir(vid)
        print(f"WARN: video {vid} absente en DB, essai {p}")
    else:
        p = Path(str(video["chemin_projet"]))
    print(f"PROJET={p}")
    clips = p / "ai_clips"
    if clips.exists():
        shutil.rmtree(clips, ignore_errors=True)
        print(f"SUPPRIME={clips}")
    else:
        print("ai_clips deja absent")
    # Aussi invalider export trop long si present
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
