"""Étape 3b / Module 3 — Moteur vidéo IA (génération réelle depuis le script/storyboard).

Provider par défaut : FAL.ai (Kling text-to-video).
Chaque scène du storyboard produit un ou plusieurs clips IA, puis bouclés
pour coller à la durée audio de la scène.
"""

from __future__ import annotations

import json
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests

from config import (
    AI_CLIP_SEC,
    ASPECT_RATIO,
    FAL_CONCURRENCY,
    FAL_KEY,
    FAL_MODEL,
    VIDEO_PROVIDER,
)
from db.database import get_video, log_event, update_video

FAL_QUEUE = "https://queue.fal.run"


def _fal_headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Key {key}", "Content-Type": "application/json"}


def _fal_request(method: str, url: str, key: str, payload: dict | None = None) -> dict:
    resp = requests.request(
        method,
        url,
        headers=_fal_headers(key),
        json=payload,
        timeout=120,
    )
    try:
        body = resp.json() if resp.text else {}
    except Exception:
        body = {"raw": resp.text}
    if not resp.ok:
        msg = body.get("detail") or body.get("message") or body.get("error") or resp.text
        raise RuntimeError(f"FAL {resp.status_code}: {msg}")
    return body if isinstance(body, dict) else {"data": body}


def _poll_fal(key: str, model: str, request_id: str, max_attempts: int = 180) -> str:
    status_url = f"{FAL_QUEUE}/{model}/requests/{request_id}/status"
    result_url = f"{FAL_QUEUE}/{model}/requests/{request_id}"
    for _ in range(max_attempts):
        status = _fal_request("GET", status_url, key)
        state = str(status.get("status") or "").upper()
        if state == "COMPLETED":
            result = _fal_request("GET", result_url, key)
            url = (
                (result.get("video") or {}).get("url")
                or ((result.get("data") or {}).get("video") or {}).get("url")
                or ((result.get("output") or {}).get("video") or {}).get("url")
                or ((result.get("response") or {}).get("video") or {}).get("url")
            )
            if not url:
                raise RuntimeError("URL vidéo absente dans la réponse FAL")
            return str(url)
        if state in {"FAILED", "ERROR"}:
            raise RuntimeError(status.get("error") or "Échec génération clip FAL")
        time.sleep(4)
    raise TimeoutError("Timeout génération clip FAL")


def _download(url: str, dest: Path) -> None:
    with requests.get(url, stream=True, timeout=300) as resp:
        resp.raise_for_status()
        with dest.open("wb") as fh:
            for chunk in resp.iter_content(chunk_size=1024 * 256):
                if chunk:
                    fh.write(chunk)


def _clips_needed(duration_sec: float) -> int:
    clip = max(5, AI_CLIP_SEC)
    return max(1, int(math.ceil(float(duration_sec) / clip)))


def _generate_one_fal_clip(prompt: str, dest: Path, key: str, model: str) -> Path:
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    duration = "5" if AI_CLIP_SEC <= 7 else "10"
    submit = _fal_request(
        "POST",
        f"{FAL_QUEUE}/{model}",
        key,
        {
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": ASPECT_RATIO,
        },
    )
    request_id = submit.get("request_id")
    if not request_id:
        raise RuntimeError(f"Pas de request_id FAL: {submit}")
    video_url = _poll_fal(key, model, str(request_id))
    _download(video_url, dest)
    return dest


def generate_scene_videos(video_id: int) -> dict[str, Any]:
    """Génère les clips vidéo IA pour toutes les scènes du storyboard."""
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")

    if VIDEO_PROVIDER != "fal":
        raise RuntimeError(
            f"Provider '{VIDEO_PROVIDER}' non branché ici. Utilisez CONTE_VIDEO_PROVIDER=fal "
            "(ComfyUI/AnimateDiff local = Phase 2 GPU)."
        )
    if not FAL_KEY:
        raise RuntimeError(
            "FAL_KEY manquant. Ajoute ta clé FAL.ai dans conte-factory/.env "
            "(obligatoire pour la génération vidéo IA)."
        )

    projet = Path(video["chemin_projet"])
    board_path = projet / "storyboard.json"
    board = json.loads(board_path.read_text(encoding="utf-8"))
    clips_dir = projet / "ai_clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    jobs: list[tuple[int, int, str, Path]] = []
    for scene in board["scenes"]:
        idx = int(scene["index"])
        dur = float(scene.get("duration_sec") or scene.get("target_duration_sec") or AI_CLIP_SEC)
        n = _clips_needed(dur)
        prompt = scene["visual_prompt"]
        scene_files: list[str] = []
        for part in range(n):
            out = clips_dir / f"scene_{idx:03d}_part{part:02d}.mp4"
            # Légère variation de prompt pour éviter des clips identiques
            part_prompt = (
                f"{prompt}, shot variation {part + 1}, continuous storytelling motion"
            )
            jobs.append((idx, part, part_prompt, out))
            scene_files.append(out.name)
        scene["ai_clip_files"] = scene_files
        scene["ai_clips_planned"] = n

    update_video(video_id, statut="images_ok")  # statut historique: génération visuelle en cours
    log_event(
        video_id,
        "info",
        f"Génération vidéo IA : {len(jobs)} clips (concurrence {FAL_CONCURRENCY}).",
    )

    errors: list[str] = []

    def _worker(item: tuple[int, int, str, Path]) -> None:
        _idx, _part, prompt, out = item
        _generate_one_fal_clip(prompt, out, FAL_KEY, FAL_MODEL)

    with ThreadPoolExecutor(max_workers=max(1, FAL_CONCURRENCY)) as pool:
        futures = {pool.submit(_worker, job): job for job in jobs}
        done = 0
        for fut in as_completed(futures):
            done += 1
            job = futures[fut]
            try:
                fut.result()
                if done % 5 == 0 or done == len(jobs):
                    log_event(video_id, "info", f"Clips IA : {done}/{len(jobs)}")
            except Exception as exc:
                errors.append(f"scene {job[0]} part {job[1]}: {exc}")

    if errors:
        update_video(video_id, statut="erreur", erreur="; ".join(errors[:5]))
        log_event(video_id, "error", f"{len(errors)} clip(s) en échec")
        raise RuntimeError(f"Échecs génération IA ({len(errors)}): {errors[0]}")

    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="images_ok")
    log_event(video_id, "info", f"Vidéo IA prête : {len(jobs)} clips.")
    return {
        "ok": True,
        "provider": "fal",
        "model": FAL_MODEL,
        "clips": len(jobs),
        "dir": str(clips_dir),
    }
