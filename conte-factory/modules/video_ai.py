"""Étape moteur vidéo IA — génération réelle depuis le storyboard.

Provider recommandé :
  **i2v** = Wan 2.1 Fun 1.3B Image-to-Video (vraie animation locale RTX)
  Legacy : talking (Wav2Lip), pinokio (T2V), images (Ken Burns), fal (cloud)
"""

from __future__ import annotations

import hashlib
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
    PINOKIO_I2V_HEIGHT,
    PINOKIO_I2V_WIDTH,
    PINOKIO_WAN_ENGINE,
    PINOKIO_WAN_FRAMES,
    PINOKIO_WAN_PYTHON,
    PINOKIO_WAN_RESOLUTION,
    PINOKIO_WAN_STEPS,
    PINOKIO_WAN_URL,
    ROOT,
    TARGET_DURATION_MIN,
    VIDEO_PROVIDER,
    WAN_CLIP_SPAN_SEC,
    wan_clip_budget,
)
from db.database import get_video, log_event, resolve_project_dir, update_video
from modules.creative_options import format_size
from modules.image_ai import generate_scene_image, set_image_output_size
from modules.progress import set_progress
from modules.storyboard import enrich_board_visual_prompts, visual_prompt_for_scene
from modules.youth_spec import normalize_age, youth_profile

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
    # INSTALL-NVIDIA : app/env/Scripts/python.exe
    for rel in (
        Path("env") / "Scripts" / "python.exe",
        Path("env") / "bin" / "python",
        Path("env") / "bin" / "python3",
        Path("..") / "env" / "Scripts" / "python.exe",
        Path("..") / "env" / "bin" / "python",
        Path("..") / "env" / "bin" / "python3",
    ):
        candidate = (engine.parent / rel).resolve()
        if candidate.exists():
            return str(candidate)
    return sys.executable


def pinokio_wan_health(deep: bool = False) -> dict[str, Any]:
    """État réel Wan sur PINOKIO_WAN_URL (dashboard 8501 ↔ moteur 7860)."""
    info: dict[str, Any] = {
        "provider": "pinokio",
        "model": "Wan 2.1 T2V 1.3B",
        "gradio_url": PINOKIO_WAN_URL,
        "gradio_up": False,
        "gradio_title": None,
        "cuda": None,
        "device": None,
        "engine": None,
        "engine_ok": False,
        "ready_for_pipeline": False,
    }
    try:
        resp = requests.get(PINOKIO_WAN_URL.rstrip("/") + "/", timeout=2)
        info["gradio_up"] = resp.status_code < 500
        info["gradio_status_code"] = resp.status_code
    except Exception as exc:
        info["gradio_error"] = str(exc)

    if info["gradio_up"]:
        try:
            cfg = requests.get(PINOKIO_WAN_URL.rstrip("/") + "/config", timeout=2).json()
            info["gradio_title"] = cfg.get("title") or cfg.get("space_id")
        except Exception:
            pass

    try:
        engine = resolve_wan_engine()
        info["engine"] = str(engine)
        if deep or not info["gradio_up"]:
            py = resolve_wan_python(engine)
            out = subprocess.check_output(
                [py, str(engine), "check"],
                text=True,
                timeout=180,
                stderr=subprocess.STDOUT,
                env={**os.environ, "SULPHUR_SNAPDRAGON": "", "SULPHUR_ALLOW_CPU": "0"},
            )
            check = json.loads(out.strip().splitlines()[-1] if out.strip() else "{}")
            info["engine_check"] = check
            info["engine_ok"] = bool(check.get("ok", True))
            info["cuda"] = check.get("cuda")
            info["device"] = check.get("device")
    except Exception as exc:
        info["engine_error"] = str(exc)

    info["ready_for_pipeline"] = bool(info["gradio_up"] or info["engine_ok"])
    return info


def _discover_gradio_api_names(client: Any) -> list[str]:
    """Liste les endpoints Gradio disponibles (Gradio 4/5)."""
    names: list[str] = ["/generate", "/run_generation", "/predict"]
    try:
        info = client.view_api(return_format="dict")
        endpoints = (info or {}).get("named_endpoints") or {}
        for key in endpoints:
            name = str(key)
            if not name.startswith("/"):
                name = f"/{name}"
            if name not in names:
                names.insert(0, name)
    except Exception:
        pass
    return names


def _generate_via_gradio(prompt: str, dest: Path) -> Path:
    """Appelle Wan Gradio (ex: http://127.0.0.1:7860) — lien direct avec le dashboard."""
    try:
        from gradio_client import Client
    except ImportError as exc:
        raise RuntimeError("Installez gradio_client : pip install gradio_client") from exc

    client = Client(PINOKIO_WAN_URL)
    last_err: Exception | None = None
    result = None
    api_names = _discover_gradio_api_names(client)
    for api_name in api_names:
        try:
            result = client.predict(
                prompt,
                PINOKIO_WAN_RESOLUTION,
                int(PINOKIO_WAN_FRAMES),
                int(PINOKIO_WAN_STEPS),
                0,
                api_name=api_name,
            )
            break
        except Exception as exc:
            last_err = exc
            continue
    if result is None:
        # Dernier essai sans api_name (certains clients Gradio)
        try:
            result = client.predict(
                prompt,
                PINOKIO_WAN_RESOLUTION,
                int(PINOKIO_WAN_FRAMES),
                int(PINOKIO_WAN_STEPS),
                0,
            )
        except Exception as exc:
            last_err = exc
    if result is None:
        raise RuntimeError(f"Appel Gradio Wan échoué (apis={api_names}): {last_err}")

    video_path = result[0] if isinstance(result, (list, tuple)) else result
    if not video_path or not Path(str(video_path)).exists():
        raise RuntimeError(f"Gradio n'a pas renvoyé de fichier: {result}")
    shutil.copy2(str(video_path), dest)
    return dest


def _generate_via_engine(prompt: str, dest: Path) -> Path:
    """Appelle directement wan_engine.py (même venv NVIDIA)."""
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
        "--steps",
        str(int(PINOKIO_WAN_STEPS)),
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=60 * 60,
        env={**os.environ, "SULPHUR_SNAPDRAGON": "", "SULPHUR_ALLOW_CPU": "0"},
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or f"exit {proc.returncode}")[-2000:])
    if not dest.exists():
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

    # Préférer Gradio vivant ; si l'API échoue (ex: /predict absent) → wan_engine
    try:
        resp = requests.get(PINOKIO_WAN_URL, timeout=2)
        if resp.status_code < 500:
            try:
                return _generate_via_gradio(prompt, dest)
            except Exception:
                pass
    except Exception:
        pass

    return _generate_via_engine(prompt, dest)


# ---------------------------------------------------------------------------
# Orchestration scènes
# ---------------------------------------------------------------------------

def _clips_needed(duration_sec: float, provider: str, remaining_budget: int, span_sec: float) -> int:
    """Nombre de clips Wan distincts selon le rythme jeunesse (plans 2–10 s)."""
    if provider == "images":
        return 1
    if remaining_budget <= 0:
        return 0
    span = max(2.0, float(span_sec))
    n = max(1, int(math.ceil(float(duration_sec) / span)))
    # 1-3 ans : plans longs → moins de cuts ; 7-10 : plus de plans
    n = min(n, 4)
    return min(n, remaining_budget)


# ---------------------------------------------------------------------------
# Parametres I2V anti-deformation visage (appliques via config / i2v_engine)
# ---------------------------------------------------------------------------
I2V_FACE_SAFE = {
    "guidance_scale": 3.5,  # MAX 4.0 — au-dela le visage fond
    "motion_scale": 0.3,  # 0.2-0.4 : respiration / yeux / tete seulement
    "width": 848,
    "height": 480,
    "negative_prompt": (
        "deformed face, blurry, distortion, bad anatomy, morphing, melted face, "
        "glitch, artifacts, morphing face, face warp, warped face"
    ),
}


def generate_scene_videos(video_id: int) -> dict[str, Any]:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")

    provider = VIDEO_PROVIDER.lower().strip()
    if provider in {"i2v", "wan_i2v", "image2video", "img2vid"}:
        # Force plafonds face-safe (ecrase .env trop agressif)
        os.environ["PINOKIO_I2V_GUIDANCE"] = str(I2V_FACE_SAFE["guidance_scale"])
        os.environ["PINOKIO_I2V_MOTION_SCALE"] = str(I2V_FACE_SAFE["motion_scale"])
        os.environ["PINOKIO_I2V_WIDTH"] = str(I2V_FACE_SAFE["width"])
        os.environ["PINOKIO_I2V_HEIGHT"] = str(I2V_FACE_SAFE["height"])
        os.environ["PINOKIO_I2V_RESOLUTION"] = "848p 16:9"
        # LTX/Wan : jamais dpmpp_2m (crash set_timesteps / custom sigmas)
        os.environ["PINOKIO_I2V_SCHEDULER"] = "default"
        from modules.i2v_pipeline import generate_i2v_videos

        return generate_i2v_videos(video_id)

    if provider in {"talking", "lipsync", "talk", "multitalk", "infinitetalk"}:
        from modules.talking_pipeline import generate_talking_videos

        return generate_talking_videos(video_id)

    if provider in {"pinokio", "wan", "wan21", "wan-snapdragon"}:
        provider = "pinokio"
    elif provider in {"images", "image", "still", "stills", "invideo"}:
        provider = "images"
    elif provider != "fal":
        raise RuntimeError(
            f"Provider inconnu: {VIDEO_PROVIDER}. "
            "Utilisez i2v (recommande), talking, pinokio, images ou fal."
        )

    projet = resolve_project_dir(video_id, video)
    board_path = projet / "storyboard.json"
    board = json.loads(board_path.read_text(encoding="utf-8"))
    clips_dir = projet / "ai_clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    img_w = int(PINOKIO_I2V_WIDTH or 1024)
    img_h = int(PINOKIO_I2V_HEIGHT or 576)
    if str(board.get("aspect") or "16:9") != "16:9":
        aw, ah = format_size(str(board.get("aspect") or "16:9"))
        img_w = min(1024, aw)
        img_h = int(round(img_w * ah / aw))
    set_image_output_size(img_w, img_h)

    n_enriched = enrich_board_visual_prompts(board, force=False)
    if n_enriched:
        board_path.write_text(
            json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        log_event(video_id, "info", f"Prompts visuels EN enrichis : {n_enriched}.")

    theme_key = str(board.get("theme") or board.get("hero") or "conte")
    base_seed = int(hashlib.md5(theme_key.encode("utf-8")).hexdigest()[:8], 16) % 1_000_000
    duration_min = float(board.get("duration_min") or TARGET_DURATION_MIN)
    budget = wan_clip_budget(duration_min) if provider in {"pinokio", "fal"} else 10_000
    remaining = budget

    age = normalize_age(str(board.get("age_group") or "1-10"))
    yprofile = youth_profile(age)
    span_sec = float(
        (board.get("youth_profile") or {}).get("wan_clip_span_sec")
        or yprofile["wan_clip_span_sec"]
        or WAN_CLIP_SPAN_SEC
    )

    story_ctx = {
        "hero": board.get("hero"),
        "theme": board.get("theme"),
        "hero_description": board.get("hero_description") or board.get("theme"),
        "friend": board.get("friend"),
        "place": board.get("place") or "enchanted sky",
        "visual_style": board.get("visual_style"),
        "age_group": age,
    }

    jobs: list[tuple[int, int, str, Path, int]] = []
    for scene in board["scenes"]:
        idx = int(scene["index"])
        dur = float(scene.get("duration_sec") or scene.get("target_duration_sec") or AI_CLIP_SEC)
        n = _clips_needed(dur, provider, remaining, span_sec)
        if provider != "images":
            if n <= 0:
                n = 1 if remaining > 0 else 1
            remaining = max(0, remaining - n)

        dialogue = scene.get("dialogue") or [
            {"speaker": "heros", "text": scene.get("narration") or ""}
        ]
        scene_files: list[str] = []
        for part in range(n):
            # Preferer visual_prompt EN deja enrichi ; sinon regenerer via LLM/fallback
            base_vp = str(scene.get("visual_prompt") or "").strip()
            if part == 0 and base_vp:
                part_prompt = base_vp
            else:
                part_prompt = visual_prompt_for_scene(dialogue, idx - 1, story_ctx, part=part)
            if provider == "images":
                out = clips_dir / f"scene_{idx:03d}_part{part:02d}.png"
                seed = (base_seed + idx * 17 + part) % 1_000_000
            else:
                out = clips_dir / f"scene_{idx:03d}_part{part:02d}.mp4"
                part_prompt += (
                    ", shot continuity, gentle soft motion, sharp focus, "
                    "minimal motion blur, cinematic children's movie frame"
                )
                seed = (base_seed + idx * 31 + part * 7) % 1_000_000
            jobs.append((idx, part, part_prompt, out, seed))
            scene_files.append(out.name)
        scene["ai_clip_files"] = scene_files
        scene["ai_clips_planned"] = n
        scene["visual_prompt"] = scene_files and jobs[-1][2] or scene.get("visual_prompt")
    log_event(
        video_id,
        "info",
        f"Génération visuelle ({provider}) : {len(jobs)} asset(s), budget Wan={budget}.",
    )

    if provider == "images":
        workers = max(1, min(3, FAL_CONCURRENCY))
    elif provider == "pinokio":
        workers = 1
    else:
        workers = max(1, FAL_CONCURRENCY)
    errors: list[str] = []

    def _worker(item: tuple[int, int, str, Path, int]) -> None:
        _idx, _part, prompt, out, seed = item
        if out.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
            generate_scene_image(prompt, out, seed=seed, width=img_w, height=img_h)
        elif provider == "pinokio":
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
                label = "Image" if job[3].suffix.lower() in {".png", ".jpg", ".jpeg"} else "Clip Wan"
                log_event(video_id, "info", f"{label} : {done}/{len(jobs)}")
                try:
                    set_progress(
                        step="video_ai",
                        video_id=video_id,
                        message=f"{label} {done}/{len(jobs)}",
                        clips_done=done,
                        clips_total=len(jobs),
                        detail=f"Scene {job[0]} partie {job[1] + 1}",
                    )
                except Exception:
                    pass
            except Exception as exc:
                errors.append(f"scene {job[0]} part {job[1]}: {exc}")

    if errors:
        update_video(video_id, statut="erreur", erreur="; ".join(errors[:5]))
        log_event(video_id, "error", f"{len(errors)} asset(s) en échec")
        raise RuntimeError(f"Échecs génération IA ({len(errors)}): {errors[0]}")

    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    update_video(video_id, statut="images_ok")
    model_name = {
        "images": "images+kenburns",
        "pinokio": "Wan 2.1 T2V 1.3B",
        "fal": FAL_MODEL,
    }.get(provider, provider)
    log_event(video_id, "info", f"Visuels prêts ({provider}) : {len(jobs)}.")
    return {
        "ok": True,
        "provider": provider,
        "model": model_name,
        "clips": len(jobs),
        "dir": str(clips_dir),
    }
