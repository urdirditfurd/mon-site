"""Auto-start serveur Wan I2V (port 7861)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from config import DATA_DIR
from modules.i2v_ai import (
    PINOKIO_I2V_FRAMES,
    PINOKIO_I2V_GUIDANCE,
    PINOKIO_I2V_STEPS,
    PINOKIO_I2V_URL,
    WAN_I2V_BACKEND,
    i2v_health,
    resolve_i2v_engine,
    resolve_i2v_python,
)

PID_FILE = DATA_DIR / "i2v_server.pid"
LOG_FILE = DATA_DIR / "i2v_server.log"


def ensure_i2v_running(wait_seconds: int = 300) -> dict[str, Any]:
    health = i2v_health()
    if health.get("gradio_up"):
        return {"ok": True, **health}
    engine = resolve_i2v_engine()
    if not engine:
        return {
            "ok": False,
            "error": "i2v_engine introuvable — INSTALL-I2V.ps1",
            **health,
        }
    py = resolve_i2v_python(engine)
    app_dir = engine.parent
    gradio = app_dir / "gradio_server.py"
    if not gradio.exists():
        return {"ok": False, "error": f"gradio_server.py manquant: {gradio}", **health}

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log_f = LOG_FILE.open("a", encoding="utf-8")
    creationflags = 0
    if sys.platform == "win32":
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    proc = subprocess.Popen(
        [py, str(gradio)],
        cwd=str(app_dir),
        stdout=log_f,
        stderr=subprocess.STDOUT,
        env={
            **os.environ,
            "GRADIO_SERVER_PORT": "7861",
            "WAN_DTYPE": os.environ.get("WAN_DTYPE", "float16"),
            "SULPHUR_CPU_OFFLOAD": os.environ.get("SULPHUR_CPU_OFFLOAD", "1"),
            "CONTE_I2V_LOWVRAM": "1",
            "WAN_I2V_BACKEND": os.environ.get("WAN_I2V_BACKEND", WAN_I2V_BACKEND),
            "PINOKIO_I2V_FRAMES": str(PINOKIO_I2V_FRAMES),
            "PINOKIO_I2V_STEPS": str(PINOKIO_I2V_STEPS),
            "PINOKIO_I2V_GUIDANCE": str(PINOKIO_I2V_GUIDANCE),
            "PINOKIO_I2V_WIDTH": os.environ.get("PINOKIO_I2V_WIDTH", "848"),
            "PINOKIO_I2V_HEIGHT": os.environ.get("PINOKIO_I2V_HEIGHT", "480"),
            "PINOKIO_I2V_MOTION_SCALE": os.environ.get("PINOKIO_I2V_MOTION_SCALE", "0.3"),
            "PINOKIO_I2V_SCHEDULER": os.environ.get("PINOKIO_I2V_SCHEDULER", "default"),
            "PYTHONUNBUFFERED": "1",
        },
        creationflags=creationflags,
    )
    PID_FILE.write_text(
        json.dumps({"pid": proc.pid, "url": PINOKIO_I2V_URL}, indent=2),
        encoding="utf-8",
    )
    deadline = time.time() + max(30, int(wait_seconds))
    while time.time() < deadline:
        health = i2v_health()
        if health.get("gradio_up"):
            return {"ok": True, "pid": proc.pid, **health}
        if proc.poll() is not None:
            return {
                "ok": False,
                "error": "Processus I2V termine trop tot — voir data/i2v_server.log",
                "pid": proc.pid,
                **health,
            }
        time.sleep(2)
    return {"ok": False, "error": "Timeout demarrage I2V", "pid": proc.pid, **health}
