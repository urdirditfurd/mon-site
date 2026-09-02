"""Démarrage et supervision de ComfyUI pour LTX Studio."""

from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"

_candidate_comfy = BASE_DIR.parent / "ComfyUI-ARM-Windows"
COMFY_DIR = _candidate_comfy if _candidate_comfy.is_dir() else Path(r"C:\ComfyUI-ARM\ComfyUI-ARM-Windows")
COMFY_PYTHON = COMFY_DIR / "venv" / "Scripts" / "python.exe"
COMFY_HTTP = "http://127.0.0.1:8190"

_comfy_process: subprocess.Popen[Any] | None = None
_last_start_mode = "normal"


def log(msg: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with (LOG_DIR / "boot.log").open("a", encoding="utf-8") as f:
        f.write(f"{msg}\n")


def read_log_tail(name: str, lines: int = 15) -> str:
    path = LOG_DIR / name
    if not path.is_file():
        return ""
    return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])


def is_ready() -> bool:
    req = urllib.request.Request(f"{COMFY_HTTP}/system_stats", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            if resp.status != 200:
                return False
            import json

            body = json.loads(resp.read().decode())
            return isinstance(body.get("system"), dict)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return False


def _comfy_env() -> dict[str, str]:
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = "-1"
    env["PYTHONUNBUFFERED"] = "1"
    env["HF_HUB_DISABLE_TELEMETRY"] = "1"
    return env


def _popen_kwargs() -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "cwd": str(COMFY_DIR),
        "env": _comfy_env(),
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    return kwargs


def start_comfyui(*, visible: bool = False) -> subprocess.Popen[Any] | None:
    global _comfy_process, _last_start_mode

    if not COMFY_PYTHON.is_file():
        log(f"ERREUR python introuvable: {COMFY_PYTHON}")
        return None
    if not (COMFY_DIR / "main.py").is_file():
        log(f"ERREUR ComfyUI introuvable: {COMFY_DIR}")
        return None

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / "comfyui.log"
    log_handle = log_path.open("a", encoding="utf-8")

    cmd = [
        str(COMFY_PYTHON),
        "main.py",
        "--cpu",
        "--force-fp16",
        "--port",
        "8190",
        "--disable-auto-launch",
    ]

    _last_start_mode = "visible" if visible else "normal"
    log(f"Démarrage ComfyUI ({_last_start_mode}): {' '.join(cmd)}")

    kwargs = _popen_kwargs()
    kwargs["stdout"] = log_handle
    kwargs["stderr"] = subprocess.STDOUT
    if visible and sys.platform == "win32":
        kwargs.pop("creationflags", None)

    _comfy_process = subprocess.Popen(cmd, **kwargs)
    return _comfy_process


def process_alive() -> bool:
    return _comfy_process is not None and _comfy_process.poll() is None


def process_exit_code() -> int | None:
    if _comfy_process is None:
        return None
    return _comfy_process.poll()


def is_fatal_log(tail: str) -> bool:
    u = tail.upper()
    markers = (
        "TORCH NOT COMPILED WITH CUDA",
        "ASSERTIONERROR",
        "MODULENOTFOUNDERROR",
        "NO MODULE NAMED",
        "FLOAT64",
    )
    return any(m in u for m in markers)


def diagnose() -> str:
    tail = read_log_tail("comfyui.log", 25)
    if not COMFY_PYTHON.is_file():
        return f"Python ComfyUI introuvable : {COMFY_PYTHON}"
    if not COMFY_DIR.is_dir():
        return f"Dossier ComfyUI introuvable : {COMFY_DIR}"
    if is_fatal_log(tail):
        if "CUDA" in tail.upper():
            return "ComfyUI crash CUDA. Lancez LTX_Studio_Debug.bat pour voir l'erreur."
        return "ComfyUI a crashé au démarrage. Lancez LTX_Studio_Debug.bat."
    code = process_exit_code()
    if code is not None:
        return f"ComfyUI arrêté (code {code}). Patientez ou lancez LTX_Studio_Debug.bat."
    if process_alive():
        return "ComfyUI démarre… 1ère fois = 5 à 10 minutes sur CPU."
    if is_ready():
        return "ComfyUI prêt."
    return "ComfyUI ne répond pas encore. Attendez ou lancez LTX_Studio_Debug.bat."


def wait_until_ready(timeout_seconds: int = 900, *, visible: bool = False) -> bool:
    if is_ready():
        log("ComfyUI déjà actif.")
        return True

    if not process_alive():
        start_comfyui(visible=visible)

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if is_ready():
            log("ComfyUI prêt.")
            return True
        code = process_exit_code()
        if code is not None:
            tail = read_log_tail("comfyui.log", 10)
            log(f"ComfyUI exit {code}: {tail[-200:]}")
            if is_fatal_log(read_log_tail("comfyui.log", 30)):
                return False
            start_comfyui(visible=visible)
        time.sleep(3)

    log("Timeout ComfyUI")
    return False


def install_requirements() -> None:
    if not COMFY_PYTHON.is_file():
        return
    req = BASE_DIR / "requirements.txt"
    if not req.is_file():
        return
    log("Installation dépendances LTX Studio…")
    subprocess.run(
        [str(COMFY_PYTHON), "-m", "pip", "install", "-r", str(req), "-q"],
        cwd=str(BASE_DIR),
        capture_output=True,
        text=True,
    )
