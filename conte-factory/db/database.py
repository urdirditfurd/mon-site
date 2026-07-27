"""Base SQLite légère : suivi des vidéos, anti-doublons, pause, erreurs."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from config import DB_PATH, ensure_dirs


SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre TEXT NOT NULL,
    titre_original TEXT NOT NULL,
    theme TEXT,
    hash_script TEXT NOT NULL UNIQUE,
    statut TEXT NOT NULL DEFAULT 'nouveau',
    duree_sec REAL,
    chemin_projet TEXT,
    chemin_video TEXT,
    youtube_id TEXT,
    erreur TEXT,
    date_creation TEXT NOT NULL,
    date_publication TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    cle TEXT PRIMARY KEY,
    valeur TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER,
    niveau TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(video_id) REFERENCES videos(id)
);
"""

STATUTS = (
    "nouveau",
    "script_ok",
    "storyboard_ok",
    "audio_ok",
    "images_ok",
    "montage_ok",
    "pret",
    "publie",
    "erreur",
    "pause",
)

STATUT_LABELS = {
    "nouveau": "Nouveau",
    "script_ok": "Script pret",
    "storyboard_ok": "Storyboard pret",
    "audio_ok": "Audio pret",
    "images_ok": "Clips IA prets",
    "montage_ok": "Montage OK",
    "pret": "Pret a publier",
    "publie": "Publie YouTube",
    "erreur": "Erreur",
    "pause": "Pause",
    "histoire_generee": "Histoire generee",
    "storyboard_pret": "Storyboard pret",
    "clips_generes": "Clips generes",
    "video_prete": "Video prete",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def fingerprint(text: str) -> str:
    normalized = " ".join(text.lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    ensure_dirs()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {str(r["name"]) for r in rows}


def _migrate(conn: sqlite3.Connection) -> None:
    """Ajoute les colonnes manquantes (compat Qwen / anciennes bases)."""
    cols = _table_columns(conn, "videos")
    needed = {
        "titre": "TEXT",
        "titre_original": "TEXT",
        "theme": "TEXT",
        "hash_script": "TEXT",
        "statut": "TEXT",
        "duree_sec": "REAL",
        "chemin_projet": "TEXT",
        "chemin_video": "TEXT",
        "youtube_id": "TEXT",
        "erreur": "TEXT",
        "date_creation": "TEXT",
        "date_publication": "TEXT",
        "notes": "TEXT",
        "nombre_scenes": "INTEGER",
        "script_complet": "TEXT",
    }
    for name, typ in needed.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE videos ADD COLUMN {name} {typ}")

    # Remplir titre depuis titre_original / theme si vide
    conn.execute(
        """
        UPDATE videos
        SET titre = COALESCE(NULLIF(titre, ''), titre_original, theme, 'Sans titre')
        WHERE titre IS NULL OR titre = ''
        """
    )
    conn.execute(
        """
        UPDATE videos
        SET titre_original = COALESCE(NULLIF(titre_original, ''), titre, theme, 'Sans titre')
        WHERE titre_original IS NULL OR titre_original = ''
        """
    )


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.execute(
            "INSERT OR IGNORE INTO settings(cle, valeur) VALUES(?, ?)",
            ("pipeline_pause", "0"),
        )


def video_title(video: dict[str, Any] | None) -> str:
    """Titre robuste quelle que soit la version de la base."""
    if not video:
        return "Sans titre"
    return str(
        video.get("titre")
        or video.get("titre_original")
        or video.get("theme")
        or f"Video #{video.get('id', '?')}"
    )


def normalize_video(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    out = dict(row)
    out["titre"] = video_title(out)
    if not out.get("titre_original"):
        out["titre_original"] = out["titre"]
    return out


def is_paused() -> bool:
    with connect() as conn:
        row = conn.execute(
            "SELECT valeur FROM settings WHERE cle = ?", ("pipeline_pause",)
        ).fetchone()
    return bool(row and row["valeur"] == "1")


def set_paused(paused: bool) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO settings(cle, valeur) VALUES(?, ?) "
            "ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur",
            ("pipeline_pause", "1" if paused else "0"),
        )


def find_by_hash(hash_script: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM videos WHERE hash_script = ?", (hash_script,)
        ).fetchone()
    return normalize_video(dict(row) if row else None)


def create_video(
    titre: str,
    titre_original: str,
    theme: str,
    hash_script: str,
    chemin_projet: str,
) -> int:
    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO videos(
                titre, titre_original, theme, hash_script, statut,
                chemin_projet, date_creation
            ) VALUES (?, ?, ?, ?, 'nouveau', ?, ?)
            """,
            (titre, titre_original, theme, hash_script, chemin_projet, _now()),
        )
        video_id = int(cur.lastrowid)
    log_event(video_id, "info", f"Projet créé : {titre}")
    return video_id


def update_video(video_id: int, **fields: Any) -> None:
    if not fields:
        return
    allowed = {
        "titre",
        "titre_original",
        "theme",
        "statut",
        "duree_sec",
        "chemin_projet",
        "chemin_video",
        "youtube_id",
        "erreur",
        "date_publication",
        "notes",
        "nombre_scenes",
        "script_complet",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    cols = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [video_id]
    with connect() as conn:
        conn.execute(f"UPDATE videos SET {cols} WHERE id = ?", values)


def get_video(video_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()
    return normalize_video(dict(row) if row else None)


def ensure_video_registered(video_id: int) -> dict[str, Any] | None:
    """Retrouve une video en DB ou la re-enregistre depuis data/videos/video_XXXX."""
    init_db()
    existing = get_video(video_id)
    if existing:
        return existing

    projet = project_dir(video_id)
    story_path = projet / "story.json"
    board_path = projet / "storyboard.json"
    if not story_path.exists() and not board_path.exists():
        return None

    titre = f"Video #{video_id}"
    theme = ""
    statut = "nouveau"
    for path in (story_path, board_path):
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            titre = str(data.get("titre") or titre)
            theme = str(data.get("theme") or theme)
            statut = "storyboard_ok" if path == board_path else "script_ok"
        except Exception:
            pass

    if (projet / "audio" / "narration.mp3").exists():
        statut = "audio_ok"
    if (projet / "ai_clips").exists():
        statut = "images_ok"

    hash_script = fingerprint(f"disk-recover-{video_id}-{projet}")
    chemin = str(projet.resolve())
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO videos(
                id, titre, titre_original, theme, hash_script, statut,
                chemin_projet, date_creation
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (video_id, titre, titre, theme, hash_script, statut, chemin, _now()),
        )
        row = conn.execute("SELECT MAX(id) FROM videos").fetchone()
        max_id = int(row[0] or video_id)
        conn.execute(
            "INSERT OR REPLACE INTO sqlite_sequence(name, seq) VALUES('videos', ?)",
            (max(max_id, video_id),),
        )
    log_event(video_id, "info", "Projet recupere depuis le disque")
    return get_video(video_id)


def list_videos(limit: int = 50) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM videos ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [normalize_video(dict(r)) for r in rows if r]  # type: ignore[misc]


def list_events(video_id: int, limit: int = 50) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM events
            WHERE video_id = ?
            ORDER BY id ASC
            LIMIT ?
            """,
            (video_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def creation_duration_sec(video_id: int) -> float | None:
    """Duree estimee de creation = 1er event → dernier event."""
    events = list_events(video_id, limit=500)
    if len(events) < 2:
        return None
    start = _parse_iso(events[0].get("created_at"))
    end = _parse_iso(events[-1].get("created_at"))
    if not start or not end:
        return None
    return max(0.0, (end - start).total_seconds())


def video_process_detail(video_id: int) -> dict[str, Any]:
    """Caracteristiques techniques d'une video pour l'onglet Technique."""
    video = get_video(video_id)
    if not video:
        return {"ok": False, "error": "introuvable"}

    projet = Path(video.get("chemin_projet") or "")
    detail: dict[str, Any] = {
        "ok": True,
        "video": video,
        "titre": video_title(video),
        "statut_label": STATUT_LABELS.get(str(video.get("statut")), str(video.get("statut"))),
        "sous_titres": False,  # choix projet : audio suffit
        "audio": False,
        "storyboard": False,
        "clips_ia": 0,
        "montage": False,
        "script_apercu": "",
        "scenes": 0,
        "duree_creation_sec": creation_duration_sec(video_id),
        "events": list_events(video_id, 30),
        "fichiers": {},
    }

    if projet.exists():
        story_path = projet / "story.json"
        board_path = projet / "storyboard.json"
        narration = projet / "audio" / "narration.mp3"
        clips_dir = projet / "ai_clips"
        publish = projet / "publish.json"

        if story_path.exists():
            try:
                story = json.loads(story_path.read_text(encoding="utf-8"))
                script = str(story.get("script") or story.get("script_complet") or "")
                detail["script_apercu"] = script[:800]
                detail["scenes"] = len(story.get("scenes") or []) or int(
                    video.get("nombre_scenes") or 0
                )
            except Exception:
                detail["script_apercu"] = story_path.read_text(encoding="utf-8")[:800]

        if board_path.exists():
            detail["storyboard"] = True
            try:
                board = json.loads(board_path.read_text(encoding="utf-8"))
                detail["scenes"] = len(board.get("scenes") or [])
            except Exception:
                pass

        if narration.exists():
            detail["audio"] = True
            detail["fichiers"]["audio"] = str(narration)

        if clips_dir.exists():
            clips = list(clips_dir.glob("*.mp4"))
            detail["clips_ia"] = len(clips)

        if video.get("chemin_video") and Path(str(video["chemin_video"])).exists():
            detail["montage"] = True
            detail["fichiers"]["video"] = video["chemin_video"]

        if publish.exists():
            detail["fichiers"]["publish"] = str(publish)

    return detail


def stats() -> dict[str, Any]:
    with connect() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM videos").fetchone()["c"]
        publiees = conn.execute(
            "SELECT COUNT(*) AS c FROM videos WHERE statut = 'publie'"
        ).fetchone()["c"]
        erreurs = conn.execute(
            "SELECT COUNT(*) AS c FROM videos WHERE statut = 'erreur'"
        ).fetchone()["c"]
        pretes = conn.execute(
            """
            SELECT COUNT(*) AS c FROM videos
            WHERE statut IN ('pret', 'montage_ok', 'video_prete')
            """
        ).fetchone()["c"]
        en_cours = conn.execute(
            """
            SELECT COUNT(*) AS c FROM videos
            WHERE statut NOT IN ('publie', 'erreur', 'pret', 'montage_ok', 'video_prete')
            """
        ).fetchone()["c"]
        derniere = conn.execute(
            "SELECT * FROM videos ORDER BY id DESC LIMIT 1"
        ).fetchone()
        events = conn.execute(
            """
            SELECT * FROM events
            WHERE niveau IN ('error', 'warn')
            ORDER BY id DESC LIMIT 10
            """
        ).fetchall()
        rows = conn.execute("SELECT id FROM videos ORDER BY id DESC LIMIT 40").fetchall()

    durations = []
    for r in rows:
        d = creation_duration_sec(int(r["id"]))
        if d and d > 0:
            durations.append(d)

    avg_creation = sum(durations) / len(durations) if durations else None

    return {
        "total": total,
        "publiees": publiees,
        "erreurs": erreurs,
        "pretes": pretes,
        "en_cours": en_cours,
        "derniere": normalize_video(dict(derniere) if derniere else None),
        "alertes": [dict(e) for e in events],
        "pause": is_paused(),
        "duree_creation_moyenne_sec": avg_creation,
        "vues_youtube": None,  # besoin API Analytics — lien YouTube affiche a la place
    }


def log_event(video_id: int | None, niveau: str, message: str) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO events(video_id, niveau, message, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (video_id, niveau, message, _now()),
        )


def similar_title_exists(titre: str) -> bool:
    """Anti-doublon simple : même titre normalisé déjà vu."""
    key = " ".join(titre.lower().split())
    with connect() as conn:
        rows = conn.execute(
            "SELECT titre, titre_original FROM videos"
        ).fetchall()
    for row in rows:
        for field in ("titre", "titre_original"):
            raw = row[field] if field in row.keys() else None
            if not raw:
                continue
            existing = " ".join(str(raw).lower().split())
            if existing == key or (key and key in existing) or (existing and existing in key):
                return True
    return False


def project_dir(video_id: int) -> Path:
    from config import VIDEOS_DIR

    path = VIDEOS_DIR / f"video_{video_id:04d}"
    path.mkdir(parents=True, exist_ok=True)
    return path
