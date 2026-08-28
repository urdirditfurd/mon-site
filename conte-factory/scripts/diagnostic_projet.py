"""Diagnostic projets sur disque + re-enregistrement DB."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db.database import (
    ensure_video_registered,
    get_video,
    init_db,
    list_disk_projects,
    project_has_artifacts,
    project_path,
)


def _print_project(vid: int) -> None:
    p = project_path(vid)
    db = get_video(vid)
    ok = project_has_artifacts(p)
    print(f"--- Projet #{vid} ---")
    print(f"  chemin: {p}")
    print(f"  existe: {p.is_dir()}  contenu: {ok}")
    if p.is_dir():
        for name in ("story.json", "storyboard.json", "audio/narration.mp3"):
            f = p / name
            print(f"  {name}: {'oui' if f.exists() else 'non'}")
    print(f"  DB: {'oui' if db else 'non'}" + (f" ({db.get('statut')})" if db else ""))


def main() -> int:
    init_db()
    args = sys.argv[1:]

    if not args or args[0] in {"--scan", "--scan-all", "-a"}:
        projects = list_disk_projects()
        print(f"Projets avec contenu sur disque: {len(projects)}")
        for item in projects:
            vid = int(item["video_id"])
            reg = ensure_video_registered(vid)
            print(
                f"  #{vid}: story={item['has_story']} board={item['has_board']} "
                f"audio={item['has_audio']} DB={'ok' if reg else 'echec'}"
            )
        if not projects:
            print("Aucun projet trouve dans data/videos/video_XXXX avec story/audio.")
            print("Lancez un nouveau conte depuis Creation ou:")
            print('  python main.py --theme "petit chaperon rouge" --duration 5 --age 7-10 --no-publish')
        return 0

    if args[0] == "--register-all":
        n = 0
        for item in list_disk_projects():
            if ensure_video_registered(int(item["video_id"])):
                n += 1
        print(f"Enregistres: {n}")
        return 0

    vid = int(args[0])
    _print_project(vid)
    if project_has_artifacts(project_path(vid)):
        reg = ensure_video_registered(vid)
        print(f"  -> enregistre en DB: {'oui' if reg else 'non'}")
    else:
        print("  -> dossier vide ou sans story/audio — impossible de reprendre ce numero.")
        print("  Utilisez --scan-all pour voir les projets disponibles.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
