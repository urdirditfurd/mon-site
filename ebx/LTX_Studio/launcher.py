"""
LTX Studio — Self-Healing Launcher (one-click).

Installe d'abord uvicorn/fastapi dans le venv ComfyUI,
puis démarre ComfyUI et l'interface web.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
REQUIREMENTS = BASE_DIR / "requirements.txt"
LOG_DIR = BASE_DIR / "logs"


def bootstrap_deps() -> None:
    """Installe uvicorn/fastapi AVANT tout import (cause du crash actuel)."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / "setup.log"
    print("Installation des composants de l'interface (premiere fois uniquement)...")
    cmd = [sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS)]
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(f"\n===== pip install @ {time.strftime('%H:%M:%S')} =====\n")
        handle.write(" ".join(cmd) + "\n")
        result = subprocess.run(
            cmd,
            cwd=str(BASE_DIR),
            stdout=handle,
            stderr=subprocess.STDOUT,
            timeout=300,
        )
    if result.returncode != 0:
        print("Echec installation. Consultez logs\\setup.log")
        sys.exit(1)


try:
    import uvicorn
except ModuleNotFoundError:
    bootstrap_deps()
    import uvicorn  # noqa: E402

import comfy_boot  # noqa: E402


def open_browser_later(delay: float = 4.0) -> None:
    time.sleep(delay)
    try:
        webbrowser.open("http://127.0.0.1:8191")
    except Exception as exc:  # noqa: BLE001
        comfy_boot.log(f"browser open failed: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    comfy_boot.LOG_DIR.mkdir(parents=True, exist_ok=True)
    comfy_boot.log("=" * 60)
    comfy_boot.log("LTX Studio Self-Healing Launcher")
    comfy_boot.log(f"Python  = {sys.executable}")
    comfy_boot.log(f"ComfyUI = {comfy_boot.COMFY_DIR}")
    comfy_boot.log("=" * 60)

    print("Demarrage de ComfyUI en arriere-plan...")
    ready = comfy_boot.wait_until_ready(timeout_seconds=900, max_attempts=3)
    if ready:
        comfy_boot.log("ComfyUI STABLE — demarrage UI")
        print("ComfyUI pret. Ouverture de l'interface...")
    else:
        comfy_boot.log(f"ComfyUI NON PRET — UI avec rapport: {comfy_boot.diagnose()}")
        print("ComfyUI pas encore pret. L'interface s'ouvre quand meme.")

    if not args.no_browser and not args.debug:
        threading.Thread(target=open_browser_later, daemon=True).start()

    uvicorn.run("server:app", host="127.0.0.1", port=8191, reload=False, log_level="warning")


if __name__ == "__main__":
    main()
