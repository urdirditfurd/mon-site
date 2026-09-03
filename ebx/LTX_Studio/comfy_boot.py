"""
Self-healing ComfyUI boot — Snapdragon X Elite (Windows ARM + Python x64).
"""

from __future__ import annotations

import json
import os
import shutil
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
    if "CLIPTOKENIZER" in u:
        return "clip_tokenizer_broken"
    if (
        "TORCHAUDIO" in u
        or "TORCH_LIBRARY_IMPL" in u
        or "0XC0000139" in u
        or "ENTRYPOINT" in u
        or "_TORCHAUDIO.PYD" in u
    ):
        return "torchaudio_abi"
    if "HUGGINGFACE-HUB" in u and ("REQUIRED" in u or "IMPORTERROR" in u):
        return "hf_hub_conflict"
    if "UNRECOGNIZED ARGUMENTS" in u or "UNRECOGNIZED ARGUMENT" in u:
        return "bad_flag"
    if "TORCH NOT COMPILED WITH CUDA" in u or ("ASSERTIONERROR" in u and "CUDA" in u):
        return "cuda_assert"
    if "FLOAT64" in u:
        return "float64"
    if "MODULENOTFOUNDERROR" in u or "NO MODULE NAMED" in u or "CANNOT IMPORT NAME" in u:
        return "missing_module"
    if "ADDRESS ALREADY IN USE" in u or "ERRNO 10048" in u:
        return "port_busy"
    if tail.strip():
        return "unknown_crash"
    return "silent_exit"


_TORCHAUDIO_PROBE = r"""
import ctypes
import sys
try:
    ctypes.windll.kernel32.SetErrorMode(0x0001 | 0x0002)
except Exception:
    pass
try:
    import torchaudio
    print("OK", getattr(torchaudio, "__version__", "?"))
except Exception as exc:
    print("FAIL", type(exc).__name__, exc)
    sys.exit(1)
"""

_COMFY_BOOTSTRAP = r"""
import ctypes
import runpy
import sys
try:
    ctypes.windll.kernel32.SetErrorMode(0x0001 | 0x0002)
except Exception:
    pass
sys.argv = ["main.py"] + sys.argv[1:]
runpy.run_path("main.py", run_name="__main__")
"""


def _pip(cmd_tail: list[str], timeout: int = 600) -> int:
    cmd = [str(COMFY_PYTHON), "-m", "pip", *cmd_tail]
    try:
        print(" ", " ".join(cmd_tail))
        result = subprocess.run(cmd, cwd=str(COMFY_DIR), timeout=timeout, capture_output=True, text=True)
        log(f"pip {' '.join(cmd_tail)} -> {result.returncode}")
        if result.returncode != 0:
            log((result.stderr or result.stdout or "")[-500:])
        return result.returncode
    except Exception as exc:  # noqa: BLE001
        log(f"pip failed: {exc}")
        return 1


def _probe_torchaudio() -> bool:
    probe = subprocess.run(
        [str(COMFY_PYTHON), "-c", _TORCHAUDIO_PROBE],
        cwd=str(COMFY_DIR),
        capture_output=True,
        text=True,
        timeout=90,
    )
    out = (probe.stdout or "") + (probe.stderr or "")
    return probe.returncode == 0 and "OK" in out


def repair_torchaudio() -> bool:
    """
    Corrige l'ABI torchaudio vs torch (popup Windows torch_library_impl / 0xc0000139).
    LTX Video n'a pas besoin de torchaudio (ACE/MMAudio seulement) :
    si la reinstall echoue, on desinstalle pour un import propre (ModuleNotFoundError).
    """
    if not COMFY_PYTHON.is_file():
        return False

    if _probe_torchaudio():
        log("torchaudio deja compatible")
        return True

    log("Reparation torchaudio (ABI incompatible avec torch)")
    print("Reparation torchaudio (DLL torch_library_impl)...")

    _pip(["uninstall", "-y", "torchaudio"])

    torch_ver = ""
    try:
        tv = subprocess.run(
            [
                str(COMFY_PYTHON),
                "-c",
                "import torch; print(torch.__version__.split('+')[0].strip())",
            ],
            cwd=str(COMFY_DIR),
            capture_output=True,
            text=True,
            timeout=60,
        )
        torch_ver = (tv.stdout or "").strip()
    except Exception as exc:  # noqa: BLE001
        log(f"lecture torch version: {exc}")

    if torch_ver:
        # Meme serie que torch 2.4.1+cpu
        _pip(
            [
                "install",
                "--no-cache-dir",
                f"torchaudio=={torch_ver}",
                "--index-url",
                "https://download.pytorch.org/whl/cpu",
            ],
            timeout=900,
        )
        if _probe_torchaudio():
            log(f"torchaudio=={torch_ver} OK")
            print("torchaudio reinstalle et OK.")
            return True
        log("reinstall torchaudio toujours casse — desinstallation finale")
        _pip(["uninstall", "-y", "torchaudio"])

    # Sans torchaudio : ComfyUI loggue "ACE/MMAudio will be broken" mais LTX Video tourne.
    log("torchaudio retire (non requis pour LTX Video)")
    print("torchaudio retire — OK pour LTX Video (pas d'audio ACE/MMAudio).")
    return True


def repair_transformers() -> bool:
    """Reparation transformers/tokenizers/huggingface-hub (+ dossiers ~okenizers)."""
    if not COMFY_PYTHON.is_file():
        return False

    probe = subprocess.run(
        [str(COMFY_PYTHON), "-c", "from transformers import CLIPTokenizer; print('OK')"],
        cwd=str(COMFY_DIR),
        capture_output=True,
        text=True,
        timeout=60,
    )
    if probe.returncode == 0 and "OK" in (probe.stdout or ""):
        log("transformers/CLIPTokenizer deja OK")
        return True

    log("Reparation FORCEE: tokenizers + transformers + huggingface-hub")
    print("Reparation transformers/tokenizers (CLIPTokenizer)...")

    site = COMFY_DIR / "venv" / "Lib" / "site-packages"
    if site.is_dir():
        for item in site.iterdir():
            name = item.name.lower()
            if name.startswith("~") or name in {"~okenizers", "~ransformers", "~uggingface_hub"}:
                try:
                    if item.is_dir():
                        shutil.rmtree(item, ignore_errors=True)
                    else:
                        item.unlink(missing_ok=True)
                    log(f"Supprime package corrompu: {item.name}")
                except Exception as exc:  # noqa: BLE001
                    log(f"Nettoyage {item.name}: {exc}")

    _pip(["uninstall", "-y", "transformers", "tokenizers", "huggingface-hub"])
    _pip(
        [
            "install",
            "--force-reinstall",
            "--no-cache-dir",
            "huggingface-hub==0.26.5",
            "tokenizers==0.20.3",
            "transformers==4.46.3",
        ]
    )

    verify = subprocess.run(
        [str(COMFY_PYTHON), "-c", "from transformers import CLIPTokenizer; print('OK')"],
        cwd=str(COMFY_DIR),
        capture_output=True,
        text=True,
        timeout=60,
    )
    ok = verify.returncode == 0 and "OK" in (verify.stdout or "")
    if ok:
        log("CLIPTokenizer OK apres reparation")
        print("Reparation transformers OK.")
    else:
        log(f"CLIPTokenizer TOUJOURS CASSE: {(verify.stderr or verify.stdout or '')[-400:]}")
        print("Reparation transformers incomplete — voir logs.")
    return ok


def repair_comfy_deps() -> bool:
    """Repare transformers puis torchaudio. CLIPTokenizer est bloquant ; torchaudio non."""
    if not COMFY_PYTHON.is_file():
        return False
    if ERROR_REPORT.is_file():
        ERROR_REPORT.unlink(missing_ok=True)

    clip_ok = repair_transformers()
    repair_torchaudio()
    return clip_ok


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
    # Bootstrap Windows: masque les MessageBox DLL (0xc0000139) puis lance main.py
    cmd = [str(COMFY_PYTHON), "-u", "-c", _COMFY_BOOTSTRAP, *profile.args]
    _active_profile = profile.name
    log(f"Lancement ComfyUI [{profile.name}]: {COMFY_PYTHON} main.py {' '.join(profile.args)}")

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
                if last_error == "torchaudio_abi":
                    repair_torchaudio()
                break
            time.sleep(1)
        else:
            if is_ready():
                return True
            last_error = classify_error(read_log_tail()) or "timeout"
            log(f"Timeout [{profile.name}] {last_error}")
            if last_error == "torchaudio_abi":
                repair_torchaudio()
            stop_comfy()

    write_error_report(f"Echec apres {max_attempts} essais ({last_error})")
    return False
