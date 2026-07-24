"""Étape 6 — Publication YouTube (optionnelle, manuelle par défaut)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from config import AUTO_PUBLISH, YOUTUBE_PRIVACY
from db.database import get_video, log_event, update_video


def prepare_publish_package(video_id: int) -> dict[str, Any]:
    """Prépare le paquet (sans uploader) — prêt pour validation humaine."""
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    projet = Path(video["chemin_projet"])
    meta_path = projet / "publish.json"
    if not meta_path.exists():
        raise FileNotFoundError("publish.json manquant — terminez le montage.")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["privacy"] = YOUTUBE_PRIVACY
    meta["auto_publish"] = AUTO_PUBLISH
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    log_event(video_id, "info", "Paquet de publication prêt (validation manuelle).")
    return meta


def publish_youtube(video_id: int, force: bool = False) -> dict[str, Any]:
    """
    Upload YouTube Data API v3.
    Nécessite client_secrets.json + token OAuth dans conte-factory/secrets/.
    Par défaut : ne publie que si AUTO_PUBLISH=1 ou force=True.

    Si les libs / secrets manquent : on ne plante pas le pipeline —
    la vidéo reste prête en local (statut pret).
    """
    if not AUTO_PUBLISH and not force:
        meta = prepare_publish_package(video_id)
        return {
            "ok": True,
            "skipped": True,
            "reason": "Publication désactivée. Validez dans le dashboard.",
            "meta": meta,
        }

    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    projet = Path(video["chemin_projet"])
    meta = json.loads((projet / "publish.json").read_text(encoding="utf-8"))
    video_file = Path(meta["video"])
    if not video_file.exists():
        raise FileNotFoundError(f"Fichier vidéo introuvable: {video_file}")

    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError:
        prepared = prepare_publish_package(video_id)
        msg = (
            "Libs YouTube absentes — video prete en local. "
            "Pour publier plus tard: pip install google-api-python-client "
            "google-auth-oauthlib google-auth-httplib2"
        )
        log_event(video_id, "warn", msg)
        return {
            "ok": True,
            "skipped": True,
            "reason": msg,
            "meta": prepared,
        }

    secrets_dir = Path(__file__).resolve().parent.parent / "secrets"
    client = secrets_dir / "client_secrets.json"
    token = secrets_dir / "token.json"
    scopes = ["https://www.googleapis.com/auth/youtube.upload"]

    if not client.exists():
        prepared = prepare_publish_package(video_id)
        msg = (
            f"client_secrets.json manquant dans {secrets_dir} — "
            "video prete en local, publication YouTube ignoree."
        )
        log_event(video_id, "warn", msg)
        return {
            "ok": True,
            "skipped": True,
            "reason": msg,
            "meta": prepared,
        }

    creds = None
    if token.exists():
        creds = Credentials.from_authorized_user_file(str(token), scopes)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(client), scopes)
            creds = flow.run_local_server(port=0)
        token.write_text(creds.to_json(), encoding="utf-8")

    youtube = build("youtube", "v3", credentials=creds)
    body = {
        "snippet": {
            "title": meta["titre"][:100],
            "description": meta.get("description") or "",
            "tags": meta.get("tags") or [],
            "categoryId": "1",  # Film & Animation
        },
        "status": {
            "privacyStatus": meta.get("privacy") or YOUTUBE_PRIVACY,
            "selfDeclaredMadeForKids": True,
        },
    }
    media = MediaFileUpload(str(video_file), chunksize=8 * 1024 * 1024, resumable=True)
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)
    response = None
    while response is None:
        _, response = request.next_chunk()
    yt_id = response["id"]
    from datetime import datetime, timezone

    update_video(
        video_id,
        statut="publie",
        youtube_id=yt_id,
        date_publication=datetime.now(timezone.utc).isoformat(),
    )
    log_event(video_id, "info", f"Publié sur YouTube : {yt_id}")
    return {"ok": True, "youtube_id": yt_id, "url": f"https://youtu.be/{yt_id}"}
