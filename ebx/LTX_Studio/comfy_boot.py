"""
Self-healing ComfyUI boot for Snapdragon X Elite (Windows ARM + Python x64).

Causes racines (historique session) :
- AssertionError: Torch not compiled with CUDA enabled
- Float64 / DirectML incompatible Adreno
- Plantages silencieux / port 8190 occupé
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"
ERROR_REPORT = BASE_DIR / "error_report.txt"

_candidate = BASE_DIR.parent / "ComfyUI-ARM-Windows"
COMFY_DIR = _candidate if _candidate.is_dir() else Path(r"C:\ComfyUI-ARM\ComfyUI-ARM-Windows")
COMFY_PYTHON = COMFY_DIR / "venv" / "Scripts" / "python.exe"
COMFY_HTTP = "http://127.0.0.1:8190"
COMFY_PORT = 8190

READY_MARKERS = (
    "to see the gui go to",
    "starting server",
    "listening on",
    f"127.0.0.1:{COMFY_PORT}",
)

_comfy_process: subprocess.Popen[Any] | None = None
_active_profile: str = "none"
_attempt_history: list[str] = []


@dataclass
class LaunchProfile:
    name: str
    args: list[str]
    env: dict[str, str] = field(default_factory=dict)
    matches: tuple[str, ...] = ()


PROFILES: list[LaunchProfile] = [
    LaunchProfile(
        name="cpu_fp16_safe",
        args=["--cpu", "--force-fp16", "--port", "8190", "--disable-auto-launch"],
        env={
            "CUDA_VISIBLE_DEVICES": "-1",
            "TORCH_DEVICE": "cpu",
            "PYTORCH_ENABLE_MPS_FALLBACK": "0",
        },
        matches=("CUDA", "TORCH NOT COMPILED", "DIRECTML", "FLOAT64", "DLL", "WINERROR"),
    ),
    LaunchProfile(
        name="cpu_fp16_lowmem",
        args=[
            "--cpu",
            "--force-fp16",
            "--port",
            "8190",
            "--disable-auto-launch",
            "--disable-smart-memory",
            "--reserve-vram",
            "0",
        ],
        env={
            "CUDA_VISIBLE_DEVICES": "-1",
            "TORCH_DEVICE": "cpu",
            "OMP_NUM_THREADS": "4",
        },
        matches=("OUT OF MEMORY", "MEMORYERROR", "ALLOCATED", "SMART-MEMORY", "TIMEOUT"),
    ),
    LaunchProfile(
        name="cpu_fp16_nocustom",
        args=[
            "--cpu",
            "--force-fp16",
            "--port",
            "8190",
            "--disable-auto-launch",
            "--disable-all-custom-nodes",
        ],
        env={
            "CUDA_VISIBLE_DEVICES": "-1",
            "TORCH_DEVICE": "cpu",
        },
        matches=("CUSTOM_NODES", "IMPORTERROR", "MODULENOTFOUND", "NO MODULE NAMED"),
    ),
]


def log(msg: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with (LOG_DIR / "boot.log").open("a", encoding="utf-8") as handle:
        handle.write(f"[{stamp}] {msg}\n")


def read_log_tail(name: str = "comfyui.log", lines: int = 50) -> str:
    path = LOG_DIR / name
    if not path.is_file():
        return ""
    return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])


def append_comfy_log(text: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with (LOG_DIR / "comfyui.log").open("a", encoding="utf-8") as handle:
        handle.write(text)


def port_in_use(port: int = COMFY_PORT) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def is_ready() -> bool:
    req = urllib.request.Request(f"{COMFY_HTTP}/system_stats", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            if resp.status != 200:
                return False
            body = json.loads(resp.read().decode())
            return isinstance(body.get("system"), dict)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return False


def log_looks_ready(tail: str) -> bool:
    lower = tail.lower()
    return any(marker in lower for marker in READY_MARKERS)


def classify_error(tail: str) -> str:
    u = tail.upper()
    if "TORCH NOT COMPILED WITH CUDA" in u or ("ASSERTIONERROR" in u and "CUDA" in u):
        return "cuda_assert"
    if "FLOAT64" in u:
        return "float64"
    if "MODULENOTFOUNDERROR" in u or "NO MODULE NAMED" in u:
        return "missing_module"
    if "ADDRESS ALREADY IN USE" in u or "ERRNO 10048" in u or "ONLY ONE USAGE OF EACH SOCKET" in u:
        return "port_busy"
    if "OUT OF MEMORY" in u or "MEMORYERROR" in u:
        return "oom"
    if "DLL" in u or "WINERROR" in u:
        return "dll_conflict"
    if "CHECKPOINT" in u and ("NOT FOUND" in u or "NO SUCH FILE" in u):
        return "missing_model"
    if "T5" in u and ("NOT FOUND" in u or "NO SUCH FILE" in u):
        return "missing_t5"
    if tail.strip():
        return "unknown_crash"
    return "silent_exit"


def pick_profile(attempt: int, last_error_class: str, log_tail: str = "") -> LaunchProfile:
    haystack = f"{last_error_class}\n{log_tail}".upper()
    class_map = {
        "cuda_assert": "cpu_fp16_safe",
        "float64": "cpu_fp16_safe",
        "dll_conflict": "cpu_fp16_safe",
        "oom": "cpu_fp16_lowmem",
        "missing_module": "cpu_fp16_nocustom",
        "port_busy": "cpu_fp16_safe",
        "silent_exit": "cpu_fp16_safe",
        "timeout": "cpu_fp16_lowmem",
        "unknown_crash": "cpu_fp16_lowmem",
    }

    preferred = class_map.get(last_error_class)
    unused = [p for p in PROFILES if p.name not in _attempt_history]
    if not unused:
        return PROFILES[min(attempt, len(PROFILES) - 1)]

    if preferred:
        for profile in unused:
            if profile.name == preferred:
                return profile

    for profile in unused:
        if any(marker in haystack for marker in profile.matches):
            return profile

    return unused[0]


def kill_port(port: int = COMFY_PORT) -> None:
    if sys.platform != "win32":
        return
    try:
        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                (
                    f"$c=Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue;"
                    "if($c){$c.OwningProcess|Sort-Object -Unique|ForEach-Object{"
                    "Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue}}"
                ),
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
        log(f"kill_port({port}) rc={result.returncode}")
    except Exception as exc:  # noqa: BLE001
        log(f"kill_port failed: {exc}")


def stop_comfy() -> None:
    global _comfy_process
    if _comfy_process is None:
        return
    try:
        if _comfy_process.poll() is None:
            _comfy_process.terminate()
            try:
                _comfy_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _comfy_process.kill()
    except Exception as exc:  # noqa: BLE001
        log(f"stop_comfy: {exc}")
    _comfy_process = None


def build_env(extra: dict[str, str]) -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["HF_HUB_DISABLE_TELEMETRY"] = "1"
    env["PYTHONUTF8"] = "1"
    env.update(extra)
    return env


def start_with_profile(profile: LaunchProfile) -> subprocess.Popen[Any] | None:
    global _comfy_process, _active_profile

    if not COMFY_PYTHON.is_file():
        log(f"Python introuvable: {COMFY_PYTHON}")
        return None
    if not (COMFY_DIR / "main.py").is_file():
        log(f"ComfyUI introuvable: {COMFY_DIR}")
        return None

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / "comfyui.log"
    append_comfy_log(f"\n===== PROFILE {profile.name} @ {time.strftime('%H:%M:%S')} =====\n")

    cmd = [str(COMFY_PYTHON), "main.py", *profile.args]
    _active_profile = profile.name
    log(f"Launch profile={profile.name} cmd={' '.join(cmd)}")

    log_handle = log_path.open("a", encoding="utf-8")
    kwargs: dict[str, Any] = {
        "cwd": str(COMFY_DIR),
        "env": build_env(profile.env),
        "stdout": log_handle,
        "stderr": subprocess.STDOUT,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    _comfy_process = subprocess.Popen(cmd, **kwargs)
    return _comfy_process


def process_alive() -> bool:
    return _comfy_process is not None and _comfy_process.poll() is None


def process_exit_code() -> int | None:
    if _comfy_process is None:
        return None
    return _comfy_process.poll()


def write_error_report(reason: str) -> None:
    tail = read_log_tail("comfyui.log", 50)
    error_class = classify_error(tail)
    report = (
        "LTX Studio — Rapport d'erreur auto-diagnostic\n"
        "============================================\n"
        f"Raison          : {reason}\n"
        f"Classe erreur   : {error_class}\n"
        f"Profil actif    : {_active_profile}\n"
        f"Tentatives      : {' | '.join(_attempt_history) or 'aucune'}\n"
        f"Python          : {COMFY_PYTHON}\n"
        f"ComfyUI dir     : {COMFY_DIR}\n"
        f"Python existe   : {COMFY_PYTHON.is_file()}\n"
        f"ComfyUI existe  : {(COMFY_DIR / 'main.py').is_file()}\n"
        f"Port 8190 libre : {not port_in_use()}\n"
        "\n--- Dernières lignes comfyui.log ---\n"
        f"{tail or '(log vide)'}\n"
    )
    ERROR_REPORT.write_text(report, encoding="utf-8")
    log(f"error_report écrit: {ERROR_REPORT}")


def diagnose() -> str:
    if ERROR_REPORT.is_file():
        for line in ERROR_REPORT.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("Classe erreur") or line.startswith("Raison"):
                return line
    if not COMFY_PYTHON.is_file():
        return f"Python ComfyUI introuvable : {COMFY_PYTHON}"
    if not COMFY_DIR.is_dir():
        return f"Dossier ComfyUI introuvable : {COMFY_DIR}"
    if is_ready():
        return "ComfyUI prêt."
    if process_alive():
        return "ComfyUI démarre… 1ère fois = 5 à 10 minutes sur CPU Snapdragon."
    return "ComfyUI hors ligne après auto-correction."


def install_requirements() -> None:
    if not COMFY_PYTHON.is_file():
        return
    req = BASE_DIR / "requirements.txt"
    if not req.is_file():
        return
    log("pip install requirements.txt")
    try:
        subprocess.run(
            [str(COMFY_PYTHON), "-m", "pip", "install", "-r", str(req), "-q"],
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True,
            timeout=300,
        )
    except Exception as exc:  # noqa: BLE001
        log(f"pip install failed: {exc}")


def wait_until_ready(timeout_seconds: int = 900, max_attempts: int = 3) -> bool:
    """Boucle auto-cicatrisante : jusqu'à max_attempts profils différents."""
    global _attempt_history
    _attempt_history = []

    if is_ready():
        log("ComfyUI déjà actif.")
        if ERROR_REPORT.is_file():
            ERROR_REPORT.unlink(missing_ok=True)
        return True

    if port_in_use() and not is_ready():
        log("Port 8190 occupé sans API valide — nettoyage.")
        kill_port(COMFY_PORT)
        time.sleep(2)

    last_error = ""
    last_tail = ""
    for attempt in range(max_attempts):
        profile = pick_profile(attempt, last_error, last_tail)
        stop_comfy()
        if port_in_use() and not is_ready():
            kill_port(COMFY_PORT)
            time.sleep(1)

        proc = start_with_profile(profile)
        _attempt_history.append(profile.name)
        if proc is None:
            last_error = "python_or_path_missing"
            continue

        per_attempt = max(90, timeout_seconds // max_attempts)
        deadline = time.monotonic() + per_attempt
        crashed = False
        while time.monotonic() < deadline:
            if is_ready():
                log(f"ComfyUI prêt (profil={profile.name})")
                if ERROR_REPORT.is_file():
                    ERROR_REPORT.unlink(missing_ok=True)
                return True

            last_tail = read_log_tail("comfyui.log", 40)
            if log_looks_ready(last_tail) and is_ready():
                log(f"Marker ready + API OK (profil={profile.name})")
                return True

            code = process_exit_code()
            if code is not None:
                last_error = classify_error(last_tail)
                log(f"Crash profil={profile.name} exit={code} class={last_error}")
                crashed = True
                break

            time.sleep(2)

        if not crashed:
            if process_alive() and is_ready():
                return True
            last_tail = read_log_tail("comfyui.log", 40)
            last_error = classify_error(last_tail) or "timeout"
            log(f"Timeout profil={profile.name} class={last_error}")
            stop_comfy()

    write_error_report(f"Échec après {max_attempts} profils. Dernière classe={last_error}")
    return False
