"""Base SQLite légère : suivi des vidéos, anti-doublons, pause, erreurs."""

from __future__ import annotations

import hashlib
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


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        conn.execute(
            "INSERT OR IGNORE INTO settings(cle, valeur) VALUES(?, ?)",
            ("pipeline_pause", "0"),
        )


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
    return dict(row) if row else None


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
        "statut",
        "duree_sec",
        "chemin_projet",
        "chemin_video",
        "youtube_id",
        "erreur",
        "date_publication",
        "notes",
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
    return dict(row) if row else None


def list_videos(limit: int = 50) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM videos ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def stats() -> dict[str, Any]:
    with connect() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM videos").fetchone()["c"]
        publiees = conn.execute(
            "SELECT COUNT(*) AS c FROM videos WHERE statut = 'publie'"
        ).fetchone()["c"]
        erreurs = conn.execute(
            "SELECT COUNT(*) AS c FROM videos WHERE statut = 'erreur'"
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
    return {
        "total": total,
        "publiees": publiees,
        "erreurs": erreurs,
        "derniere": dict(derniere) if derniere else None,
        "alertes": [dict(e) for e in events],
        "pause": is_paused(),
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
        rows = conn.execute("SELECT titre FROM videos").fetchall()
    for row in rows:
        existing = " ".join(str(row["titre"]).lower().split())
        if existing == key or (key and key in existing) or (existing and existing in key):
            return True
    return False


def project_dir(video_id: int) -> Path:
    from config import VIDEOS_DIR

    path = VIDEOS_DIR / f"video_{video_id:04d}"
    path.mkdir(parents=True, exist_ok=True)
    return path
