"""Gestion du serveur Wan 2.1 — démarrage automatique sans LANCER-WAN-NVIDIA.bat manuel."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from config import DATA_DIR, PINOKIO_WAN_URL
from modules.video_ai import pinokio_wan_health, resolve_wan_engine, resolve_wan_python

PID_FILE = DATA_DIR / "wan_server.pid"
LOG_FILE = DATA_DIR / "wan_server.log"


def _wan_app_dir() -> Path:
    return resolve_wan_engine().parent


def _read_pid() -> int | None:
    if not PID_FILE.exists():
        return None
    try:
        data = json.loads(PID_FILE.read_text(encoding="utf-8"))
        pid = int(data.get("pid", 0))
        return pid if pid > 0 else None
    except Exception:
        return None


def _write_pid(pid: int) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(
        json.dumps({"pid": pid, "url": PINOKIO_WAN_URL}, indent=2),
        encoding="utf-8",
    )


def _clear_pid() -> None:
    if PID_FILE.exists():
        PID_FILE.unlink()


def _is_process_alive(pid: int) -> bool:
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


def wan_status() -> dict[str, Any]:
    """État combiné : santé Gradio + processus local."""
    health = pinokio_wan_health(deep=False)
    pid = _read_pid()
    alive = _is_process_alive(pid) if pid else False
    if pid and not alive:
        _clear_pid()
        pid = None
    return {
        **health,
        "pid": pid,
        "process_alive": alive,
        "log_file": str(LOG_FILE),
        "managed": bool(pid and alive),
    }


def start_wan(wait_seconds: int = 300, poll_interval: float = 5.0) -> dict[str, Any]:
    """
    Démarre Wan en arrière-plan si absent.
    Retourne l'état final (gradio_up, pid, etc.).
    """
    status = wan_status()
    if status.get("gradio_up"):
        return {
            "ok": True,
            "started": False,
            "already_running": True,
            "message": "Wan déjà en ligne",
            **status,
        }

    pid = status.get("pid")
    if pid and status.get("process_alive"):
        # Processus présent mais Gradio pas encore prêt — on attend
        return _wait_for_gradio(wait_seconds, poll_interval, started=False, pid=pid)

    engine = resolve_wan_engine()
    wan_dir = _wan_app_dir()
    py = resolve_wan_python(engine)
    gradio_script = wan_dir / "gradio_server.py"
    if not gradio_script.exists():
        raise FileNotFoundError(f"gradio_server.py introuvable : {gradio_script}")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log_handle = LOG_FILE.open("a", encoding="utf-8")
    log_handle.write(f"\n--- start_wan {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")
    log_handle.flush()

    env = os.environ.copy()
    env["SULPHUR_SNAPDRAGON"] = ""
    env["SULPHUR_ALLOW_CPU"] = "0"
    env["WAN_MODEL_CACHE"] = str(wan_dir.parent / "models")
    env["GRADIO_SERVER_PORT"] = PINOKIO_WAN_URL.rsplit(":", 1)[-1].rstrip("/") or "7860"

    popen_kwargs: dict[str, Any] = {
        "cwd": str(wan_dir),
        "env": env,
        "stdout": log_handle,
        "stderr": subprocess.STDOUT,
    }
    if sys.platform == "win32":
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS  # type: ignore[attr-defined]
    else:
        popen_kwargs["start_new_session"] = True

    proc = subprocess.Popen([py, str(gradio_script)], **popen_kwargs)
    _write_pid(proc.pid)
    log_handle.write(f"PID {proc.pid}\n")
    log_handle.flush()

    return _wait_for_gradio(wait_seconds, poll_interval, started=True, pid=proc.pid)


def _wait_for_gradio(
    wait_seconds: int,
    poll_interval: float,
    *,
    started: bool,
    pid: int | None,
) -> dict[str, Any]:
    deadline = time.time() + wait_seconds
    last_health: dict[str, Any] = {}
    while time.time() < deadline:
        last_health = pinokio_wan_health(deep=False)
        if last_health.get("gradio_up"):
            return {
                "ok": True,
                "started": started,
                "already_running": not started,
                "pid": pid,
                "message": "Wan prêt" if started else "Wan déjà en cours de démarrage",
                **last_health,
            }
        if pid and not _is_process_alive(pid):
            _clear_pid()
            return {
                "ok": False,
                "started": started,
                "error": "Le processus Wan s'est arrêté avant d'être prêt",
                "log_file": str(LOG_FILE),
                "pid": pid,
            }
        time.sleep(poll_interval)

    return {
        "ok": False,
        "started": started,
        "error": f"Timeout ({wait_seconds}s) — Wan pas joignable sur {PINOKIO_WAN_URL}",
        "log_file": str(LOG_FILE),
        "pid": pid,
        **last_health,
    }


def stop_wan() -> dict[str, Any]:
    """Arrête le processus Wan géré par ce module (si connu)."""
    pid = _read_pid()
    if not pid:
        return {"ok": True, "stopped": False, "message": "Aucun processus Wan géré"}

    if not _is_process_alive(pid):
        _clear_pid()
        return {"ok": True, "stopped": False, "message": "Processus déjà arrêté"}

    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                check=False,
                capture_output=True,
            )
        else:
            os.kill(pid, 15)
    except Exception as exc:
        return {"ok": False, "stopped": False, "error": str(exc), "pid": pid}

    _clear_pid()
    return {"ok": True, "stopped": True, "pid": pid}


def ensure_wan_running(wait_seconds: int = 300) -> dict[str, Any]:
    """Utilisé par le pipeline et le planificateur — démarre Wan si besoin."""
    return start_wan(wait_seconds=wait_seconds)
