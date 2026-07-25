"""Client Image-to-Video local (LTX / Wan Fun 1.3B via CLI prioritaire, Gradio optionnel)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from pathlib import Path
from typing import Any

import requests

from config import ROOT

PINOKIO_I2V_URL = os.getenv("PINOKIO_I2V_URL", "http://127.0.0.1:7861")
PINOKIO_I2V_ENGINE = os.getenv("PINOKIO_I2V_ENGINE", "")
PINOKIO_I2V_PYTHON = os.getenv("PINOKIO_I2V_PYTHON", "")
# Plafonds anti-deformation visage : CFG 3.5, motion 0.3, 848x480
PINOKIO_I2V_FRAMES = min(81, int(os.getenv("PINOKIO_I2V_FRAMES", "33")))
PINOKIO_I2V_STEPS = min(25, int(os.getenv("PINOKIO_I2V_STEPS", "22")))
PINOKIO_I2V_RESOLUTION = os.getenv("PINOKIO_I2V_RESOLUTION", "848p 16:9")
PINOKIO_I2V_GUIDANCE = min(4.0, float(os.getenv("PINOKIO_I2V_GUIDANCE", "3.5")))
WAN_I2V_BACKEND = os.getenv("WAN_I2V_BACKEND", "ltx")
# CLI = plus fiable ; batch = 1 chargement modele pour N scenes
PREFER_CLI = os.getenv("CONTE_I2V_PREFER_CLI", "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
USE_BATCH = os.getenv("CONTE_I2V_USE_BATCH", "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
GRADIO_TIMEOUT_SEC = int(os.getenv("CONTE_I2V_GRADIO_TIMEOUT_SEC", "900"))
CLI_TIMEOUT_SEC = int(os.getenv("CONTE_I2V_CLI_TIMEOUT", "900"))
BATCH_SCENE_TIMEOUT_SEC = int(os.getenv("CONTE_I2V_BATCH_SCENE_TIMEOUT", "300"))
MOTION_PROMPT = (
    "VERY subtle motion only: soft breathing, tiny head tilt, gentle eye blink, "
    "stable identity, same face locked, sharp facial features, no camera whip, "
    "preserve original face exactly"
)


def resolve_i2v_engine() -> Path | None:
    if PINOKIO_I2V_ENGINE:
        p = Path(PINOKIO_I2V_ENGINE)
        if p.exists():
            return p
    candidates = [
        ROOT.parent / "pinokio" / "wan-i2v" / "app" / "i2v_engine.py",
        Path(r"C:\ConteFactory\pinokio\wan-i2v\app\i2v_engine.py"),
        Path.home() / "pinokio" / "api" / "wan-i2v.git" / "app" / "i2v_engine.py",
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def resolve_i2v_python(engine: Path | None = None) -> str:
    if PINOKIO_I2V_PYTHON and Path(PINOKIO_I2V_PYTHON).exists():
        return PINOKIO_I2V_PYTHON
    engine = engine or resolve_i2v_engine()
    if engine:
        local = engine.parent / "env" / "Scripts" / "python.exe"
        if local.exists():
            return str(local)
        t2v = (
            engine.parent.parent.parent
            / "wan-snapdragon-arm"
            / "app"
            / "env"
            / "Scripts"
            / "python.exe"
        )
        if t2v.exists():
            return str(t2v)
        alt = Path(r"C:\ConteFactory\pinokio\wan-snapdragon-arm\app\env\Scripts\python.exe")
        if alt.exists():
            return str(alt)
    return sys.executable


def i2v_health() -> dict[str, Any]:
    info: dict[str, Any] = {
        "url": PINOKIO_I2V_URL,
        "gradio_up": False,
        "engine": None,
        "ready": False,
        "mode": "missing",
        "prefer_cli": PREFER_CLI,
    }
    try:
        resp = requests.get(PINOKIO_I2V_URL.rstrip("/") + "/", timeout=2)
        info["gradio_up"] = resp.status_code < 500
    except Exception:
        info["gradio_up"] = False
    engine = resolve_i2v_engine()
    if engine:
        info["engine"] = str(engine)
    if engine:
        info["ready"] = True
        info["mode"] = "cli" if PREFER_CLI or not info["gradio_up"] else "gradio"
    elif info["gradio_up"]:
        info["ready"] = True
        info["mode"] = "gradio"
    return info


def _discover_gradio_api_names(client: Any) -> list[str]:
    # /run = endpoint reel observe sur Gradio+queue (Windows utilisateur)
    names: list[str] = ["/run", "/generate", "/predict", "/i2v"]
    try:
        info = getattr(client, "view_api", None)
        raw = info(return_format="dict") if callable(info) else None
        if isinstance(raw, dict):
            discovered: list[str] = []
            for key in ("named_endpoints", "endpoints"):
                block = raw.get(key) or {}
                if isinstance(block, dict):
                    for name in block.keys():
                        n = str(name)
                        if not n.startswith("/"):
                            n = "/" + n
                        discovered.append(n)
            # Endpoints decouverts en tete
            names = discovered + names
    except Exception:
        pass
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _via_gradio(image: Path, prompt: str, dest: Path, seed: int | None = None) -> dict[str, Any]:
    from gradio_client import Client, handle_file

    client = Client(PINOKIO_I2V_URL)
    last_err: Exception | None = None
    seed_val = float(seed if seed is not None else 42)
    args = (
        handle_file(str(image)),
        prompt,
        float(PINOKIO_I2V_FRAMES),
        float(PINOKIO_I2V_STEPS),
        seed_val,
    )
    api_names = _discover_gradio_api_names(client)

    def _save_result(result: Any) -> dict[str, Any]:
        video_path = result[0] if isinstance(result, (list, tuple)) else result
        if not video_path:
            raise RuntimeError("Gradio I2V sans fichier video")
        src = Path(str(video_path))
        if not src.exists():
            raise FileNotFoundError(src)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(src.read_bytes())
        return {"ok": True, "outputPath": str(dest), "mode": "gradio_i2v"}

    def _try_one(api_name: str | None) -> dict[str, Any]:
        if api_name:
            result = client.predict(*args, api_name=api_name)
        else:
            result = client.predict(*args)
        return _save_result(result)

    for api_name in api_names:
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                fut = pool.submit(_try_one, api_name)
                return fut.result(timeout=GRADIO_TIMEOUT_SEC)
        except FuturesTimeout:
            last_err = TimeoutError(
                f"Gradio timeout {GRADIO_TIMEOUT_SEC}s sur {api_name}"
            )
            continue
        except Exception as exc:
            last_err = exc
            continue
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            fut = pool.submit(_try_one, None)
            return fut.result(timeout=GRADIO_TIMEOUT_SEC)
    except Exception as exc:
        last_err = exc
    raise RuntimeError(f"Gradio I2V echoue: {last_err}")


def _via_cli(image: Path, prompt: str, dest: Path, seed: int | None = None) -> dict[str, Any]:
    engine = resolve_i2v_engine()
    if not engine:
        raise FileNotFoundError("i2v_engine.py introuvable — lance INSTALL-I2V.ps1")
    py = resolve_i2v_python(engine)
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        py,
        str(engine),
        "generate",
        "--image",
        str(image),
        "--prompt",
        prompt,
        "--output",
        str(dest),
        "--resolution",
        PINOKIO_I2V_RESOLUTION,
        "--frames",
        str(PINOKIO_I2V_FRAMES),
        "--fps",
        "24",
        "--steps",
        str(PINOKIO_I2V_STEPS),
    ]
    if seed is not None:
        cmd.extend(["--seed", str(seed)])
    env = _cli_env()
    proc = subprocess.run(
        cmd,
        cwd=str(engine.parent),
        capture_output=True,
        text=True,
        timeout=CLI_TIMEOUT_SEC,
        env=env,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "i2v failed")[-2500:])
    if not dest.exists():
        try:
            lines = [ln for ln in (proc.stdout or "").strip().splitlines() if ln.strip()]
            data = json.loads(lines[-1]) if lines else {}
            alt = Path(str(data.get("outputPath") or ""))
            if alt.exists():
                dest.write_bytes(alt.read_bytes())
        except Exception as exc:
            raise RuntimeError("I2V n'a pas produit de MP4") from exc
    if not dest.exists():
        raise RuntimeError("I2V n'a pas produit de MP4")
    return {"ok": True, "outputPath": str(dest), "mode": "cli_i2v"}


def _cli_env() -> dict[str, str]:
    return {
        **os.environ,
        "WAN_DTYPE": os.environ.get("WAN_DTYPE", "float16"),
        "SULPHUR_CPU_OFFLOAD": os.environ.get("SULPHUR_CPU_OFFLOAD", "1"),
        "CONTE_I2V_LOWVRAM": os.environ.get("CONTE_I2V_LOWVRAM", "1"),
        "WAN_I2V_BACKEND": os.environ.get("WAN_I2V_BACKEND", WAN_I2V_BACKEND),
        "PINOKIO_I2V_FRAMES": str(PINOKIO_I2V_FRAMES),
        "PINOKIO_I2V_STEPS": str(PINOKIO_I2V_STEPS),
        "PINOKIO_I2V_GUIDANCE": str(PINOKIO_I2V_GUIDANCE),
        "PINOKIO_I2V_WIDTH": os.environ.get("PINOKIO_I2V_WIDTH", "848"),
        "PINOKIO_I2V_HEIGHT": os.environ.get("PINOKIO_I2V_HEIGHT", "480"),
        "PINOKIO_I2V_MOTION_SCALE": os.environ.get("PINOKIO_I2V_MOTION_SCALE", "0.3"),
        "PINOKIO_I2V_SCHEDULER": os.environ.get("PINOKIO_I2V_SCHEDULER", "dpmpp_2m"),
        "PINOKIO_I2V_GUIDANCE": str(PINOKIO_I2V_GUIDANCE),
        "PYTHONUNBUFFERED": "1",
        "PYTHONIOENCODING": "utf-8",
    }


def animate_scenes_i2v_batch(
    jobs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Anime N scènes avec UN SEUL process CLI (= 1 chargement modèle).
    Chaque job : image (Path), dest (Path), prompt?, seed?
    """
    if not jobs:
        return []

    results: list[dict[str, Any]] = []
    pending: list[dict[str, Any]] = []
    pending_idx: list[int] = []

    for i, job in enumerate(jobs):
        dest = Path(job["dest"])
        if dest.exists() and dest.stat().st_size > 5000:
            results.append({"ok": True, "outputPath": str(dest), "mode": "cached"})
            continue
        results.append({})  # placeholder
        pending_idx.append(i)
        motion = str(job.get("prompt") or "").strip()
        if MOTION_PROMPT.lower() not in motion.lower():
            motion = f"{motion}, {MOTION_PROMPT}".strip(", ")
        pending.append(
            {
                "image": str(Path(job["image"]).resolve()),
                "prompt": motion,
                "output": str(dest.resolve()),
                "seed": job.get("seed"),
            }
        )
        dest.parent.mkdir(parents=True, exist_ok=True)

    if not pending:
        return results

    engine = resolve_i2v_engine()
    if not engine:
        # Fallback scène par scène (Gradio / CLI unitaire)
        for j, pi in enumerate(pending_idx):
            job = jobs[pi]
            results[pi] = animate_scene_i2v(
                Path(job["image"]),
                Path(job["dest"]),
                prompt=str(job.get("prompt") or ""),
                seed=job.get("seed"),
            )
        return results

    if not USE_BATCH or len(pending) == 1:
        for j, pi in enumerate(pending_idx):
            job = jobs[pi]
            results[pi] = animate_scene_i2v(
                Path(job["image"]),
                Path(job["dest"]),
                prompt=str(job.get("prompt") or ""),
                seed=job.get("seed"),
            )
        return results

    py = resolve_i2v_python(engine)
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        prefix="conte_i2v_batch_",
        delete=False,
        encoding="utf-8",
    ) as fh:
        json.dump(pending, fh, ensure_ascii=False)
        jobs_path = Path(fh.name)

    timeout = max(600, BATCH_SCENE_TIMEOUT_SEC * len(pending) + 300)
    cmd = [
        py,
        str(engine),
        "batch",
        "--jobs",
        str(jobs_path),
        "--resolution",
        PINOKIO_I2V_RESOLUTION,
        "--frames",
        str(PINOKIO_I2V_FRAMES),
        "--fps",
        "24",
        "--steps",
        str(PINOKIO_I2V_STEPS),
    ]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(engine.parent),
            capture_output=True,
            text=True,
            timeout=timeout,
            env=_cli_env(),
        )
    finally:
        try:
            jobs_path.unlink(missing_ok=True)
        except OSError:
            pass

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "batch failed")[-3000:]
        # Fallback unitaire si batch plante
        for pi in pending_idx:
            if results[pi]:
                continue
            job = jobs[pi]
            try:
                results[pi] = animate_scene_i2v(
                    Path(job["image"]),
                    Path(job["dest"]),
                    prompt=str(job.get("prompt") or ""),
                    seed=job.get("seed"),
                )
            except Exception as exc:
                results[pi] = {
                    "ok": False,
                    "error": f"batch+cli: {err[:400]} | {exc}",
                }
        return results

    # Parser stdout JSON du batch (1 ligne compacte ; logs sur stderr)
    batch_data: dict[str, Any] = {}
    try:
        lines = [ln for ln in (proc.stdout or "").strip().splitlines() if ln.strip()]
        for ln in reversed(lines):
            text = ln.strip()
            if text.startswith("{") and text.endswith("}"):
                batch_data = json.loads(text)
                break
        if not batch_data and (proc.stdout or "").strip().startswith("{"):
            batch_data = json.loads(proc.stdout.strip())
    except Exception:
        batch_data = {}

    per_results = batch_data.get("results") if isinstance(batch_data, dict) else None
    for j, pi in enumerate(pending_idx):
        dest = Path(jobs[pi]["dest"])
        if dest.exists() and dest.stat().st_size > 5000:
            mode = "cli_i2v_batch"
            if isinstance(per_results, list) and j < len(per_results):
                mode = str(per_results[j].get("mode") or mode)
            results[pi] = {"ok": True, "outputPath": str(dest), "mode": mode}
        elif isinstance(per_results, list) and j < len(per_results):
            r = per_results[j]
            if r.get("ok") and Path(str(r.get("outputPath") or "")).exists():
                src = Path(str(r["outputPath"]))
                if src != dest:
                    dest.write_bytes(src.read_bytes())
                results[pi] = {
                    "ok": True,
                    "outputPath": str(dest),
                    "mode": str(r.get("mode") or "cli_i2v_batch"),
                }
            else:
                results[pi] = {
                    "ok": False,
                    "error": str(r.get("error") or "batch scene failed")[:500],
                }
        else:
            results[pi] = {"ok": False, "error": "batch: sortie manquante"}

    return results


def animate_scene_i2v(
    image: Path,
    dest: Path,
    *,
    prompt: str = "",
    seed: int | None = None,
) -> dict[str, Any]:
    """Image scene → clip MP4 anime (mouvement reel). Prefere CLI pour stabilite."""
    if dest.exists() and dest.stat().st_size > 5000:
        return {"ok": True, "outputPath": str(dest), "mode": "cached"}
    motion = (prompt or "").strip()
    if MOTION_PROMPT.lower() not in motion.lower():
        motion = f"{motion}, {MOTION_PROMPT}".strip(", ")

    health = i2v_health()
    errors: list[str] = []
    order: list[str] = []
    if PREFER_CLI and (health.get("engine") or resolve_i2v_engine()):
        order = ["cli", "gradio"]
    elif health.get("gradio_up"):
        order = ["gradio", "cli"]
    else:
        order = ["cli", "gradio"]

    for mode in order:
        if mode == "cli" and (health.get("engine") or resolve_i2v_engine()):
            try:
                return _via_cli(image, motion, dest, seed=seed)
            except Exception as exc:
                errors.append(f"cli: {exc}")
        elif mode == "gradio" and health.get("gradio_up"):
            try:
                return _via_gradio(image, motion, dest, seed=seed)
            except Exception as exc:
                errors.append(f"gradio: {exc}")

    detail = " | ".join(errors) if errors else "aucun moteur"
    raise RuntimeError(
        "Moteur I2V indisponible. Installe pinokio/wan-i2v (INSTALL-I2V.ps1), "
        "relance LANCER-I2V.bat si besoin. "
        f"Detail: {detail[:800]}"
    )
