"""
LTX Studio — lanceur one-click v7.
Reparations deps (transformers + torchaudio), UI immediate, ComfyUI en parallele.
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
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    print("Installation des composants UI...")
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "-r", str(REQUIREMENTS)],
        cwd=str(BASE_DIR),
        timeout=300,
    )
    if result.returncode != 0:
        print("Echec pip UI.")
        sys.exit(1)


try:
    import uvicorn
except ModuleNotFoundError:
    bootstrap_deps()
    import uvicorn  # noqa: E402

import comfy_boot  # noqa: E402

_boot_started = False


def open_browser_later(delay: float = 1.5) -> None:
    time.sleep(delay)
    try:
        webbrowser.open("http://127.0.0.1:8191")
    except Exception as exc:  # noqa: BLE001
        comfy_boot.log(f"browser: {exc}")


def boot_comfy_background() -> None:
    global _boot_started
    if _boot_started:
        return
    _boot_started = True
    comfy_boot.log("Thread ComfyUI demarre (unique)")
    ok = comfy_boot.repair_comfy_deps()
    if not ok:
        comfy_boot.write_error_report(
            "CLIPTokenizer indisponible apres reparation transformers/tokenizers."
        )
        return
    comfy_boot.wait_until_ready(timeout_seconds=180, max_attempts=2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    comfy_boot.LOG_DIR.mkdir(parents=True, exist_ok=True)
    if comfy_boot.ERROR_REPORT.is_file():
        comfy_boot.ERROR_REPORT.unlink(missing_ok=True)

    print("LTX Studio launcher v7")
    print("Interface : http://127.0.0.1:8191")
    print("Liberation ports + reparation transformers/torchaudio...")
    comfy_boot.free_studio_ports()

    threading.Thread(target=boot_comfy_background, daemon=True).start()
    if not args.no_browser:
        threading.Thread(target=open_browser_later, daemon=True).start()

    try:
        uvicorn.run("server:app", host="127.0.0.1", port=8191, reload=False, log_level="warning")
    except OSError as exc:
        if getattr(exc, "errno", None) == 10048 or "10048" in str(exc):
            print("Port 8191 occupe — nouvel essai...")
            comfy_boot.free_studio_ports()
            time.sleep(2)
            uvicorn.run("server:app", host="127.0.0.1", port=8191, reload=False, log_level="warning")
        else:
            raise


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        print("\nErreur. La fenetre reste ouverte.")
        try:
            input("Entree pour fermer...")
        except EOFError:
            time.sleep(60)
    else:
        print("\nServeur arrete.")
        try:
            input("Entree pour fermer...")
        except EOFError:
            time.sleep(30)
