"""
Self-healing ComfyUI boot — Snapdragon X Elite (Windows ARM + Python x64).
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, IO

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
)

_comfy_process: subprocess.Popen[Any] | None = None
_active_profile: str = "none"
_attempt_history: list[str] = []
_log_lock = threading.Lock()


class LaunchProfile:
    def __init__(self, name: str, args: list[str], env: dict[str, str] | None = None) -> None:
        self.name = name
        self.args = args
        self.env = env if env is not None else {}


# Uniquement des flags ComfyUI standards (les flags inconnus font crasher au boot).
PROFILES: list[LaunchProfile] = [
    LaunchProfile(
        name="cpu_fp16",
        args=["--cpu", "--force-fp16", "--listen", "127.0.0.1", "--port", "8190"],
        env={"CUDA_VISIBLE_DEVICES": "-1", "PYTHONUNBUFFERED": "1"},
    ),
    LaunchProfile(
        name="cpu_fp16_lowmem",
        args=["--cpu", "--force-fp16", "--listen", "127.0.0.1", "--port", "8190", "--disable-smart-memory"],
        env={"CUDA_VISIBLE_DEVICES": "-1", "PYTHONUNBUFFERED": "1", "OMP_NUM_THREADS": "4"},
    ),
    LaunchProfile(
        name="cpu_fp16_simple",
        args=["--cpu", "--force-fp16", "--port", "8190"],
        env={"CUDA_VISIBLE_DEVICES": "-1", "PYTHONUNBUFFERED": "1"},
    ),
]


def log(msg: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {msg}\n"
    with _log_lock:
        with (LOG_DIR / "boot.log").open("a", encoding="utf-8") as handle:
            handle.write(line)
    print(line, end="", flush=True)


def read_log_tail(name: str = "comfyui.log", lines: int = 50) -> str:
    path = LOG_DIR / name
    if not path.is_file():
        return ""
    return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])


def port_in_use(port: int = COMFY_PORT) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def is_ready() -> bool:
    req = urllib.request.Request(f"{COMFY_HTTP}/system_stats", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=2) as resp:
            if resp.status != 200:
                return False
            body = json.loads(resp.read().decode())
            return isinstance(body.get("system"), dict)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return False


def classify_error(tail: str) -> str:
    u = tail.upper()
    if "HUGGINGFACE-HUB" in u and ("REQUIRED" in u or "IMPORTERROR" in u):
        return "hf_hub_conflict"
    if "UNRECOGNIZED ARGUMENTS" in u or "UNRECOGNIZED ARGUMENT" in u:
        return "bad_flag"
    if "TORCH NOT COMPILED WITH CUDA" in u or ("ASSERTIONERROR" in u and "CUDA" in u):
        return "cuda_assert"
    if "FLOAT64" in u:
        return "float64"
    if "MODULENOTFOUNDERROR" in u or "NO MODULE NAMED" in u:
        return "missing_module"
    if "ADDRESS ALREADY IN USE" in u or "ERRNO 10048" in u:
        return "port_busy"
    if tail.strip():
        return "unknown_crash"
    return "silent_exit"


def repair_comfy_deps() -> None:
    """Corrige le conflit transformers / huggingface-hub (cause actuelle du crash)."""
    if not COMFY_PYTHON.is_file():
        return
    if ERROR_REPORT.is_file():
        ERROR_REPORT.unlink(missing_ok=True)

    log("Reparation deps ComfyUI: huggingface-hub<1.0 + transformers")
    print("Correction du conflit huggingface-hub / transformers...")
    cmds = [
        [str(COMFY_PYTHON), "-m", "pip", "install", "-q", "huggingface-hub>=0.23.2,<1.0"],
        [str(COMFY_PYTHON), "-m", "pip", "install", "-q", "transformers>=4.45.0"],
    ]
    for cmd in cmds:
        try:
            result = subprocess.run(cmd, cwd=str(COMFY_DIR), timeout=300, capture_output=True, text=True)
            log(f"pip {' '.join(cmd[4:])} -> {result.returncode}")
            if result.returncode != 0 and result.stderr:
                log(result.stderr[-400:])
        except Exception as exc:  # noqa: BLE001
            log(f"repair_comfy_deps: {exc}")
    print("Correction terminee.")


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
            timeout=15,
        )
        log(f"kill_port({port}) rc={result.returncode}")
    except Exception as exc:  # noqa: BLE001
        log(f"kill_port failed: {exc}")


def free_studio_ports() -> None:
    """Libère 8191 (UI) et 8190 (ComfyUI) avant démarrage."""
    for port in (8191, 8190):
        if port_in_use(port):
            log(f"Port {port} occupe — liberation...")
            print(f"Liberation du port {port}...")
            kill_port(port)
    time.sleep(1.5)


def stop_comfy() -> None:
    global _comfy_process
    if _comfy_process is None:
        return
    try:
        if _comfy_process.poll() is None:
            _comfy_process.terminate()
            try:
                _comfy_process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                _comfy_process.kill()
    except Exception as exc:  # noqa: BLE001
        log(f"stop_comfy: {exc}")
    _comfy_process = None


def _pump_output(stream: IO[str], log_path: Path) -> None:
    try:
        with log_path.open("a", encoding="utf-8") as handle:
            for line in stream:
                handle.write(line)
                handle.flush()
                print(line, end="", flush=True)
    except Exception:
        return


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
    cmd = [str(COMFY_PYTHON), "-u", "main.py", *profile.args]
    _active_profile = profile.name
    log(f"Lancement ComfyUI [{profile.name}]: {' '.join(cmd)}")

    env = os.environ.copy()
    env.update(profile.env)
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONUTF8"] = "1"

    kwargs: dict[str, Any] = {
        "cwd": str(COMFY_DIR),
        "env": env,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "bufsize": 1,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    _comfy_process = subprocess.Popen(cmd, **kwargs)
    if _comfy_process.stdout is not None:
        threading.Thread(
            target=_pump_output,
            args=(_comfy_process.stdout, log_path),
            daemon=True,
        ).start()
    return _comfy_process


def process_alive() -> bool:
    return _comfy_process is not None and _comfy_process.poll() is None


def process_exit_code() -> int | None:
    if _comfy_process is None:
        return None
    return _comfy_process.poll()


def write_error_report(reason: str) -> None:
    tail = read_log_tail("comfyui.log", 40)
    report = (
        "LTX Studio — Rapport d'erreur\n"
        "=============================\n"
        f"{reason}\n"
        f"Classe     : {classify_error(tail)}\n"
        f"Profil     : {_active_profile}\n"
        f"Tentatives : {' | '.join(_attempt_history) or 'aucune'}\n"
        f"Python     : {COMFY_PYTHON}\n"
        f"ComfyUI    : {COMFY_DIR}\n"
        "\n--- comfyui.log ---\n"
        f"{tail or '(vide)'}\n"
    )
    ERROR_REPORT.write_text(report, encoding="utf-8")
    log(f"Rapport ecrit: {ERROR_REPORT}")


def diagnose() -> str:
    if is_ready():
        return "ComfyUI prêt."
    if process_alive():
        return "ComfyUI démarre… quelques secondes."
    if ERROR_REPORT.is_file():
        for line in ERROR_REPORT.read_text(encoding="utf-8", errors="replace").splitlines()[:6]:
            if line.strip():
                return line
    if not COMFY_PYTHON.is_file():
        return f"Python introuvable : {COMFY_PYTHON}"
    return "ComfyUI hors ligne."


def wait_until_ready(timeout_seconds: int = 180, max_attempts: int = 3) -> bool:
    global _attempt_history
    _attempt_history = []

    if is_ready():
        log("ComfyUI deja actif.")
        if ERROR_REPORT.is_file():
            ERROR_REPORT.unlink(missing_ok=True)
        return True

    if port_in_use() and not is_ready():
        log("Port 8190 occupe — nettoyage.")
        kill_port(COMFY_PORT)
        time.sleep(1)

    last_error = ""
    for attempt in range(max_attempts):
        profile = PROFILES[min(attempt, len(PROFILES) - 1)]
        stop_comfy()
        if port_in_use() and not is_ready():
            kill_port(COMFY_PORT)
            time.sleep(1)

        proc = start_with_profile(profile)
        _attempt_history.append(profile.name)
        if proc is None:
            last_error = "chemin_invalide"
            continue

        deadline = time.monotonic() + max(45, timeout_seconds // max_attempts)
        while time.monotonic() < deadline:
            if is_ready():
                log(f"ComfyUI pret [{profile.name}]")
                if ERROR_REPORT.is_file():
                    ERROR_REPORT.unlink(missing_ok=True)
                return True
            code = process_exit_code()
            if code is not None:
                last_error = classify_error(read_log_tail())
                log(f"Crash [{profile.name}] code={code} {last_error}")
                break
            time.sleep(1)
        else:
            if is_ready():
                return True
            last_error = classify_error(read_log_tail()) or "timeout"
            log(f"Timeout [{profile.name}] {last_error}")
            stop_comfy()

    write_error_report(f"Echec apres {max_attempts} essais ({last_error})")
    return False
