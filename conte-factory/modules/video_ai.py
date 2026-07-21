"""Étape moteur vidéo IA — génération réelle depuis le storyboard.

Provider recommandé pour ce projet (Pinokio) :
  **Wan 2.1 T2V 1.3B** via `pinokio/wan-snapdragon-arm`
  → local (CPU/Snapdragon) ou Gradio Pinokio sur le port configuré.

Fallback cloud optionnel : FAL/Kling (`CONTE_VIDEO_PROVIDER=fal`).
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
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
    PINOKIO_WAN_ENGINE,
    PINOKIO_WAN_FRAMES,
    PINOKIO_WAN_PYTHON,
    PINOKIO_WAN_RESOLUTION,
    PINOKIO_WAN_STEPS,
    PINOKIO_WAN_URL,
    ROOT,
    VIDEO_PROVIDER,
)
from db.database import get_video, log_event, update_video

FAL_QUEUE = "https://queue.fal.run"


# ---------------------------------------------------------------------------
# FAL (cloud, optionnel)
# ---------------------------------------------------------------------------

def _fal_headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Key {key}", "Content-Type": "application/json"}


def _fal_request(method: str, url: str, key: str, payload: dict | None = None) -> dict:
    resp = requests.request(
        method, url, headers=_fal_headers(key), json=payload, timeout=120
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


def _generate_one_fal_clip(prompt: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    if not FAL_KEY:
        raise RuntimeError("FAL_KEY manquant")
    duration = "5" if AI_CLIP_SEC <= 7 else "10"
    submit = _fal_request(
        "POST",
        f"{FAL_QUEUE}/{FAL_MODEL}",
        FAL_KEY,
        {"prompt": prompt, "duration": duration, "aspect_ratio": ASPECT_RATIO},
    )
    request_id = submit.get("request_id")
    if not request_id:
        raise RuntimeError(f"Pas de request_id FAL: {submit}")
    video_url = _poll_fal(FAL_KEY, FAL_MODEL, str(request_id))
    _download(video_url, dest)
    return dest


# ---------------------------------------------------------------------------
# Pinokio — Wan 2.1 (recommandé)
# ---------------------------------------------------------------------------

def resolve_wan_engine() -> Path:
    if PINOKIO_WAN_ENGINE:
        path = Path(PINOKIO_WAN_ENGINE)
        if path.exists():
            return path
    candidates = [
        ROOT.parent / "pinokio" / "wan-snapdragon-arm" / "app" / "wan_engine.py",
        Path(os.path.expandvars(r"%USERPROFILE%\pinokio\api\wan-snapdragon-arm.git\app\wan_engine.py")),
        Path(r"C:\pinokio\api\wan-snapdragon-arm.git\app\wan_engine.py"),
        Path.home() / "pinokio" / "api" / "wan-snapdragon-arm.git" / "app" / "wan_engine.py",
    ]
    for path in candidates:
        if path.exists():
            return path
    raise FileNotFoundError(
        "wan_engine.py introuvable. Installez l'app Pinokio "
        "`pinokio/wan-snapdragon-arm` ou définissez PINOKIO_WAN_ENGINE."
    )


def resolve_wan_python(engine: Path) -> str:
    if PINOKIO_WAN_PYTHON:
        return PINOKIO_WAN_PYTHON
    # Env Pinokio typique : ../env/Scripts/python.exe (Windows) ou ../env/bin/python
    for rel in (
        Path("..") / "env" / "Scripts" / "python.exe",
        Path("..") / "env" / "bin" / "python",
        Path("..") / "env" / "bin" / "python3",
    ):
        candidate = (engine.parent / rel).resolve()
        if candidate.exists():
            return str(candidate)
    return sys.executable


def pinokio_wan_health() -> dict[str, Any]:
    """État du moteur Pinokio Wan (Gradio + engine local)."""
    info: dict[str, Any] = {
        "provider": "pinokio",
        "model": "Wan 2.1 T2V 1.3B",
        "gradio_url": PINOKIO_WAN_URL,
        "gradio_up": False,
        "engine": None,
        "engine_ok": False,
    }
    try:
        resp = requests.get(PINOKIO_WAN_URL, timeout=3)
        info["gradio_up"] = resp.status_code < 500
    except Exception as exc:
        info["gradio_error"] = str(exc)
    try:
        engine = resolve_wan_engine()
        info["engine"] = str(engine)
        py = resolve_wan_python(engine)
        out = subprocess.check_output(
            [py, str(engine), "check"], text=True, timeout=120, stderr=subprocess.STDOUT
        )
        info["engine_check"] = json.loads(out.strip().splitlines()[-1] if out.strip() else "{}")
        info["engine_ok"] = bool(info["engine_check"].get("ok", True))
    except Exception as exc:
        info["engine_error"] = str(exc)
    return info


def _generate_via_gradio(prompt: str, dest: Path) -> Path:
    """Appelle l'UI Gradio Pinokio (Wan Snapdragon) si elle tourne."""
    try:
        from gradio_client import Client
    except ImportError as exc:
        raise RuntimeError(
            "Installez gradio_client : pip install gradio_client"
        ) from exc

    client = Client(PINOKIO_WAN_URL)
    # Signature Gradio : prompt, resolution, num_frames, steps, seed
    result = client.predict(
        prompt,
        PINOKIO_WAN_RESOLUTION,
        int(PINOKIO_WAN_FRAMES),
        int(PINOKIO_WAN_STEPS),
        0,
        api_name="/predict",
    )
    # result = (video_path, status) ou path seul
    if isinstance(result, (list, tuple)):
        video_path = result[0]
    else:
        video_path = result
    if not video_path or not Path(str(video_path)).exists():
        raise RuntimeError(f"Gradio n'a pas renvoyé de fichier: {result}")
    shutil.copy2(str(video_path), dest)
    return dest


def _generate_via_engine(prompt: str, dest: Path) -> Path:
    """Appelle directement wan_engine.py (même modèle que Pinokio)."""
    engine = resolve_wan_engine()
    py = resolve_wan_python(engine)
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        py,
        str(engine),
        "generate",
        "--prompt",
        prompt,
        "--output",
        str(dest),
        "--resolution",
        PINOKIO_WAN_RESOLUTION,
        "--frames",
        str(int(PINOKIO_WAN_FRAMES)),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60 * 60)
    if proc.returncode != 0:
        raise RuntimeError(
            (proc.stderr or proc.stdout or f"exit {proc.returncode}")[-2000:]
        )
    if not dest.exists():
        # parfois le JSON stdout contient outputPath
        try:
            body = json.loads(proc.stdout.strip().splitlines()[-1])
            src = Path(body.get("outputPath") or "")
            if src.exists():
                shutil.copy2(src, dest)
        except Exception:
            pass
    if not dest.exists():
        raise RuntimeError("wan_engine n'a pas produit le MP4")
    return dest


def _generate_one_pinokio_clip(prompt: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 1000:
        return dest

    # 1) Gradio Pinokio si allumé (Run dans Pinokio)
    try:
        resp = requests.get(PINOKIO_WAN_URL, timeout=2)
        if resp.status_code < 500:
            return _generate_via_gradio(prompt, dest)
    except Exception:
        pass

    # 2) Moteur local (même app Pinokio, sans UI)
    return _generate_via_engine(prompt, dest)


# ---------------------------------------------------------------------------
# Orchestration scènes
# ---------------------------------------------------------------------------

def _clips_needed(duration_sec: float) -> int:
    clip = max(5, AI_CLIP_SEC)
    return max(1, int(math.ceil(float(duration_sec) / clip)))


def generate_scene_videos(video_id: int) -> dict[str, Any]:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")

    provider = VIDEO_PROVIDER.lower().strip()
    if provider in {"pinokio", "wan", "wan21", "wan-snapdragon"}:
        provider = "pinokio"
    elif provider != "fal":
        raise RuntimeError(
            f"Provider inconnu: {VIDEO_PROVIDER}. Utilisez pinokio (recommandé) ou fal."
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
            part_prompt = (
                f"{prompt}, shot variation {part + 1}, continuous storytelling motion, "
                f"gentle animation for children"
            )
            jobs.append((idx, part, part_prompt, out))
            scene_files.append(out.name)
        scene["ai_clip_files"] = scene_files
        scene["ai_clips_planned"] = n

    log_event(
        video_id,
        "info",
        f"Génération vidéo IA ({provider}) : {len(jobs)} clips.",
    )

    # Pinokio Wan : souvent 1 job à la fois (RAM/CPU). FAL : concurrence configurable.
    workers = 1 if provider == "pinokio" else max(1, FAL_CONCURRENCY)
    errors: list[str] = []

    def _worker(item: tuple[int, int, str, Path]) -> None:
        _idx, _part, prompt, out = item
        if provider == "pinokio":
            _generate_one_pinokio_clip(prompt, out)
        else:
            _generate_one_fal_clip(prompt, out)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_worker, job): job for job in jobs}
        done = 0
        for fut in as_completed(futures):
            done += 1
            job = futures[fut]
            try:
                fut.result()
                log_event(video_id, "info", f"Clips IA : {done}/{len(jobs)}")
            except Exception as exc:
                errors.append(f"scene {job[0]} part {job[1]}: {exc}")

    if errors:
        update_video(video_id, statut="erreur", erreur="; ".join(errors[:5]))
        log_event(video_id, "error", f"{len(errors)} clip(s) en échec")
        raise RuntimeError(f"Échecs génération IA ({len(errors)}): {errors[0]}")

    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="images_ok")
    log_event(video_id, "info", f"Vidéo IA prête ({provider}) : {len(jobs)} clips.")
    return {
        "ok": True,
        "provider": provider,
        "model": "Wan 2.1 T2V 1.3B" if provider == "pinokio" else FAL_MODEL,
        "clips": len(jobs),
        "dir": str(clips_dir),
    }
