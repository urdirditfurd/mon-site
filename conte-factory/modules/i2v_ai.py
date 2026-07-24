"""Client Image-to-Video local (Wan Fun 1.3B InP via Gradio / CLI)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import requests

from config import ROOT

PINOKIO_I2V_URL = os.getenv("PINOKIO_I2V_URL", "http://127.0.0.1:7861")
PINOKIO_I2V_ENGINE = os.getenv("PINOKIO_I2V_ENGINE", "")
PINOKIO_I2V_PYTHON = os.getenv("PINOKIO_I2V_PYTHON", "")
PINOKIO_I2V_FRAMES = min(97, int(os.getenv("PINOKIO_I2V_FRAMES", "81")))
PINOKIO_I2V_STEPS = min(20, int(os.getenv("PINOKIO_I2V_STEPS", "16")))
PINOKIO_I2V_RESOLUTION = os.getenv("PINOKIO_I2V_RESOLUTION", "480p 16:9")
PINOKIO_I2V_GUIDANCE = float(os.getenv("PINOKIO_I2V_GUIDANCE", "5.5"))
WAN_I2V_BACKEND = os.getenv("WAN_I2V_BACKEND", "ltx")

MOTION_PROMPT = (
    "character natural movement, breathing, blinking eyes, gentle head tilt, "
    "cinematic camera pan, lively background, smooth 24fps animation"
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
        # Reuse Wan T2V env
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
    }
    try:
        resp = requests.get(PINOKIO_I2V_URL.rstrip("/") + "/", timeout=2)
        info["gradio_up"] = resp.status_code < 500
    except Exception:
        info["gradio_up"] = False
    engine = resolve_i2v_engine()
    if engine:
        info["engine"] = str(engine)
    if info["gradio_up"]:
        info["ready"] = True
        info["mode"] = "gradio"
    elif engine:
        info["ready"] = True
        info["mode"] = "cli"
    return info


def _discover_gradio_api_names(client: Any) -> list[str]:
    names: list[str] = ["/generate", "/predict", "/run", "/i2v"]
    try:
        info = getattr(client, "view_api", None)
        raw = info(return_format="dict") if callable(info) else None
        if isinstance(raw, dict):
            for key in ("named_endpoints", "endpoints"):
                block = raw.get(key) or {}
                if isinstance(block, dict):
                    for name in block.keys():
                        n = str(name)
                        if not n.startswith("/"):
                            n = "/" + n
                        if n not in names:
                            names.insert(0, n)
    except Exception:
        pass
    # Déduplique en gardant l'ordre
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

    for api_name in api_names:
        try:
            result = client.predict(*args, api_name=api_name)
            return _save_result(result)
        except Exception as exc:
            last_err = exc
            continue
    # Dernier essai sans api_name
    try:
        result = client.predict(*args)
        return _save_result(result)
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
    proc = subprocess.run(
        cmd,
        cwd=str(engine.parent),
        capture_output=True,
        text=True,
        timeout=60 * 45,
        env={
            **os.environ,
            "WAN_DTYPE": os.environ.get("WAN_DTYPE", "float16"),
            "SULPHUR_CPU_OFFLOAD": os.environ.get("SULPHUR_CPU_OFFLOAD", "1"),
            "CONTE_I2V_LOWVRAM": os.environ.get("CONTE_I2V_LOWVRAM", "1"),
            "WAN_I2V_BACKEND": os.environ.get("WAN_I2V_BACKEND", WAN_I2V_BACKEND),
            "PINOKIO_I2V_FRAMES": str(PINOKIO_I2V_FRAMES),
            "PINOKIO_I2V_STEPS": str(PINOKIO_I2V_STEPS),
            "PINOKIO_I2V_GUIDANCE": str(PINOKIO_I2V_GUIDANCE),
            "PYTHONUNBUFFERED": "1",
        },
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "i2v failed")[-2500:])
    if not dest.exists():
        # parse JSON stdout
        try:
            data = json.loads(proc.stdout.strip().splitlines()[-1])
            alt = Path(str(data.get("outputPath") or ""))
            if alt.exists():
                dest.write_bytes(alt.read_bytes())
        except Exception as exc:
            raise RuntimeError("I2V n'a pas produit de MP4") from exc
    if not dest.exists():
        raise RuntimeError("I2V n'a pas produit de MP4")
    return {"ok": True, "outputPath": str(dest), "mode": "cli_i2v"}


def animate_scene_i2v(
    image: Path,
    dest: Path,
    *,
    prompt: str = "",
    seed: int | None = None,
) -> dict[str, Any]:
    """Image scene → clip MP4 anime (mouvement reel)."""
    if dest.exists() and dest.stat().st_size > 5000:
        return {"ok": True, "outputPath": str(dest), "mode": "cached"}
    motion = (prompt or "").strip()
    if MOTION_PROMPT.lower() not in motion.lower():
        motion = f"{motion}, {MOTION_PROMPT}".strip(", ")

    health = i2v_health()
    errors: list[str] = []
    if health.get("gradio_up"):
        try:
            return _via_gradio(image, motion, dest, seed=seed)
        except Exception as exc:
            errors.append(f"gradio: {exc}")
    if health.get("engine") or resolve_i2v_engine():
        try:
            return _via_cli(image, motion, dest, seed=seed)
        except Exception as exc:
            errors.append(f"cli: {exc}")
    detail = " | ".join(errors) if errors else "aucun moteur"
    raise RuntimeError(
        "Moteur I2V indisponible. Installe pinokio/wan-i2v (INSTALL-I2V.ps1), "
        "relance LANCER-I2V.bat (port 7861). "
        f"Detail: {detail}"
    )
