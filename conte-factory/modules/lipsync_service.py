"""Démarrage auto du serveur lip-sync Wav2Lip (port 7870)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from config import DATA_DIR, PINOKIO_LIPSYNC_URL
from modules.lipsync_ai import lipsync_health, resolve_lipsync_engine, resolve_lipsync_python
from modules.progress import set_progress

PID_FILE = DATA_DIR / "lipsync_server.pid"
LOG_FILE = DATA_DIR / "lipsync_server.log"


def _app_dir() -> Path | None:
    engine = resolve_lipsync_engine()
    return engine.parent if engine else None


def _read_pid() -> int | None:
    if not PID_FILE.exists():
        return None
    try:
        return int(json.loads(PID_FILE.read_text(encoding="utf-8")).get("pid") or 0) or None
    except Exception:
        return None


def _write_pid(pid: int | None) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(
        json.dumps({"pid": pid, "url": PINOKIO_LIPSYNC_URL}, indent=2), encoding="utf-8"
    )


def _alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            return str(pid) in out
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def ensure_lipsync_running(wait_seconds: int = 300) -> dict[str, Any]:
    health = lipsync_health()
    if health.get("gradio_up"):
        return {"ok": True, "already": True, **health}

    app = _app_dir()
    if not app:
        return {
            "ok": False,
            "error": "Moteur lip-sync introuvable. Installe pinokio/talking-wav2lip "
            "(INSTALL-LIPSYNC.ps1). Fallback portrait actif.",
            **health,
        }

    py = resolve_lipsync_python()
    server = app / "gradio_server.py"
    if not server.exists():
        return {"ok": False, "error": f"gradio_server.py manquant: {server}", **health}

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log_f = LOG_FILE.open("a", encoding="utf-8")
    creationflags = 0
    if sys.platform == "win32":
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

    set_progress(step="video_ai", message="Demarrage moteur lip-sync…", detail="Wav2Lip")
    proc = subprocess.Popen(
        [py, str(server)],
        cwd=str(app),
        stdout=log_f,
        stderr=subprocess.STDOUT,
        creationflags=creationflags,
        env={**os.environ, "GRADIO_SERVER_PORT": "7870", "PYTHONUNBUFFERED": "1"},
    )
    _write_pid(proc.pid)

    deadline = time.time() + max(30, wait_seconds)
    while time.time() < deadline:
        health = lipsync_health()
        if health.get("gradio_up"):
            return {"ok": True, "started": True, "pid": proc.pid, **health}
        if proc.poll() is not None:
            return {
                "ok": False,
                "error": "Processus lipsync termine trop tot — voir data/lipsync_server.log",
                **health,
            }
        time.sleep(2)

    return {"ok": False, "error": "Timeout demarrage lipsync", "pid": proc.pid, **health}
