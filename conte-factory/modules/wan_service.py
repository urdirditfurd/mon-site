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


def _wan_root_dir() -> Path:
    return _wan_app_dir().parent


def _read_pid() -> int | None:
    if not PID_FILE.exists():
        return None
    try:
        data = json.loads(PID_FILE.read_text(encoding="utf-8"))
        pid = int(data.get("pid", 0))
        return pid if pid > 0 else None
    except Exception:
        return None


def _write_pid(pid: int | None) -> None:
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


def _log_tail(lines: int = 30) -> str:
    if not LOG_FILE.exists():
        return ""
    try:
        content = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return ""
    return "\n".join(content[-lines:])


def _preflight() -> dict[str, Any]:
    engine = resolve_wan_engine()
    py = Path(resolve_wan_python(engine))
    wan_root = _wan_root_dir()
    service_bat = wan_root / "LANCER-WAN-SERVICE.bat"
    nvidia_bat = wan_root / "LANCER-WAN-NVIDIA.bat"
    info: dict[str, Any] = {
        "engine": str(engine),
        "python": str(py),
        "python_exists": py.exists(),
        "service_bat": str(service_bat),
        "service_bat_exists": service_bat.exists(),
        "nvidia_bat_exists": nvidia_bat.exists(),
    }
    if not py.exists():
        info["error"] = (
            "Python Wan introuvable. Relance INSTALL-NVIDIA.ps1 "
            f"(attendu: {engine.parent / 'env' / 'Scripts' / 'python.exe'})"
        )
    elif "conte-factory" in str(py).replace("\\", "/").lower():
        info["error"] = (
            "Mauvais Python selectionne (venv conte-factory). "
            "Relance INSTALL-NVIDIA.ps1 pour creer app/env."
        )
    return info


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
        "log_tail": _log_tail(12),
    }


def _start_wan_windows(wan_root: Path) -> None:
    service_bat = wan_root / "LANCER-WAN-SERVICE.bat"
    fallback_bat = wan_root / "LANCER-WAN-NVIDIA.bat"
    bat = service_bat if service_bat.exists() else fallback_bat
    if not bat.exists():
        raise FileNotFoundError(f"Aucun lanceur Wan trouve dans {wan_root}")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as log_handle:
        log_handle.write(f"\n--- start_wan {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")
        log_handle.write(f"launcher: {bat}\n")

    env = os.environ.copy()
    env["WAN_SERVICE_LOG"] = str(LOG_FILE)
    env["SULPHUR_SNAPDRAGON"] = ""
    env["SULPHUR_ALLOW_CPU"] = "0"
    env["WAN_MODEL_CACHE"] = str(wan_root / "models")
    env["GRADIO_SERVER_PORT"] = PINOKIO_WAN_URL.rsplit(":", 1)[-1].rstrip("/") or "7860"

    # start /min : fenetre minimisee, stable avec chemins I&B (pas DETACHED_PROCESS)
    subprocess.Popen(
        ["cmd.exe", "/c", "start", "/min", "Wan21", str(bat)],
        cwd=str(wan_root),
        env=env,
    )
    _write_pid(None)


def _start_wan_posix(wan_dir: Path, py: str, gradio_script: Path) -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log_handle = LOG_FILE.open("a", encoding="utf-8")
    log_handle.write(f"\n--- start_wan {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")
    log_handle.flush()

    env = os.environ.copy()
    env["SULPHUR_SNAPDRAGON"] = ""
    env["SULPHUR_ALLOW_CPU"] = "0"
    env["WAN_MODEL_CACHE"] = str(wan_dir.parent / "models")
    env["GRADIO_SERVER_PORT"] = PINOKIO_WAN_URL.rsplit(":", 1)[-1].rstrip("/") or "7860"

    proc = subprocess.Popen(
        [py, str(gradio_script)],
        cwd=str(wan_dir),
        env=env,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    _write_pid(proc.pid)
    return proc.pid


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
            "message": "Wan deja en ligne",
            **status,
        }

    preflight = _preflight()
    if preflight.get("error"):
        return {
            "ok": False,
            "started": False,
            "error": preflight["error"],
            "preflight": preflight,
            "log_tail": _log_tail(),
        }

    pid = status.get("pid")
    if pid and status.get("process_alive"):
        return _wait_for_gradio(
            wait_seconds, poll_interval, started=False, pid=pid, track_pid=True
        )

    wan_dir = _wan_app_dir()
    gradio_script = wan_dir / "gradio_server.py"
    if not gradio_script.exists():
        raise FileNotFoundError(f"gradio_server.py introuvable : {gradio_script}")

    if sys.platform == "win32":
        _start_wan_windows(_wan_root_dir())
        return _wait_for_gradio(
            wait_seconds, poll_interval, started=True, pid=None, track_pid=False
        )

    py = resolve_wan_python(resolve_wan_engine())
    proc_pid = _start_wan_posix(wan_dir, py, gradio_script)
    return _wait_for_gradio(
        wait_seconds, poll_interval, started=True, pid=proc_pid, track_pid=True
    )


def _wait_for_gradio(
    wait_seconds: int,
    poll_interval: float,
    *,
    started: bool,
    pid: int | None,
    track_pid: bool,
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
                "message": "Wan pret" if started else "Wan deja en cours de demarrage",
                **last_health,
            }
        if track_pid and pid and not _is_process_alive(pid):
            _clear_pid()
            return {
                "ok": False,
                "started": started,
                "error": "Le processus Wan s'est arrete avant d'etre pret",
                "log_file": str(LOG_FILE),
                "log_tail": _log_tail(),
                "pid": pid,
            }
        time.sleep(poll_interval)

    return {
        "ok": False,
        "started": started,
        "error": f"Timeout ({wait_seconds}s) — Wan pas joignable sur {PINOKIO_WAN_URL}",
        "log_file": str(LOG_FILE),
        "log_tail": _log_tail(),
        "pid": pid,
        **last_health,
    }


def stop_wan() -> dict[str, Any]:
    """Arrête le processus Wan géré par ce module (si connu)."""
    pid = _read_pid()
    if not pid:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/FI", "WINDOWTITLE eq Wan21*", "/T", "/F"],
                check=False,
                capture_output=True,
            )
        return {"ok": True, "stopped": False, "message": "Aucun processus Wan gere"}

    if not _is_process_alive(pid):
        _clear_pid()
        return {"ok": True, "stopped": False, "message": "Processus deja arrete"}

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
