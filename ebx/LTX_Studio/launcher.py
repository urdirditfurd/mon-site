"""
LTX Studio — lanceur one-click v8.
Preflight : purge torchaudio/xformers SANS import, puis ComfyUI CPU, puis UI.
"""

from __future__ import annotations

import argparse
import ctypes
import os
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
REQUIREMENTS = BASE_DIR / "requirements.txt"
LOG_DIR = BASE_DIR / "logs"


def _silence_windows_dll_popups() -> None:
    if os.name != "nt":
        return
    try:
        ctypes.windll.kernel32.SetErrorMode(0x0001 | 0x0002)
    except Exception:
        return


def bootstrap_ui_deps() -> None:
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


_silence_windows_dll_popups()

try:
    import uvicorn
except ModuleNotFoundError:
    bootstrap_ui_deps()
    import uvicorn  # noqa: E402

import comfy_boot  # noqa: E402


def open_browser() -> None:
    try:
        webbrowser.open("http://127.0.0.1:8191")
    except Exception as exc:  # noqa: BLE001
        comfy_boot.log(f"browser: {exc}")


def preflight_check() -> None:
    """
    1. Nettoyage agressif torchaudio + xformers (jamais d'import).
    2. Vérification torch CPU.
    3. numpy < 2, transformers, bloqueur sitecustomize.
    """
    print("Preflight ARM/x64 : purge torchaudio + xformers...")
    subprocess.run(
        [sys.executable, "-m", "pip", "uninstall", "-y", "torchaudio", "xformers"],
        cwd=str(BASE_DIR),
        timeout=180,
        capture_output=True,
        text=True,
    )
    ok = comfy_boot.preflight()
    if not ok:
        comfy_boot.write_error_report(
            "CLIPTokenizer indisponible apres reparation transformers/tokenizers."
        )
        print("Preflight partiel — ComfyUI sera tente quand meme.")
    ckpt = comfy_boot.checkpoint_status()
    if not ckpt["ok"]:
        print(ckpt["message"])
        comfy_boot.log(ckpt["message"] or "checkpoint manquant")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    comfy_boot.LOG_DIR.mkdir(parents=True, exist_ok=True)
    if comfy_boot.ERROR_REPORT.is_file():
        comfy_boot.ERROR_REPORT.unlink(missing_ok=True)

    print("LTX Studio launcher v8")
    print("Interface : http://127.0.0.1:8191")
    print("Liberation ports...")
    comfy_boot.free_studio_ports()

    preflight_check()

    print("Lancement ComfyUI (cpu --force-fp16 --disable-smart-memory)...")
    ready = comfy_boot.wait_until_ready(timeout_seconds=180, max_attempts=2)
    if ready:
        print("ComfyUI pret sur http://127.0.0.1:8190")
    else:
        print("ComfyUI n'a pas repondu — l'interface s'ouvre quand meme.")

    if not args.no_browser:
        open_browser()

    try:
        uvicorn.run("server:app", host="127.0.0.1", port=8191, reload=False, log_level="warning")
    except OSError as exc:
        winerr = getattr(exc, "winerror", None)
        errno = getattr(exc, "errno", None)
        if errno == 10048 or "10048" in str(exc):
            print("Port 8191 occupe — nouvel essai...")
            comfy_boot.free_studio_ports()
            time.sleep(2)
            uvicorn.run("server:app", host="127.0.0.1", port=8191, reload=False, log_level="warning")
        elif winerr == 127 or errno == 127:
            print("WinError 127 sur l'UI — reinstall uvicorn/fastapi...")
            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pip",
                    "install",
                    "--force-reinstall",
                    "--no-cache-dir",
                    "uvicorn",
                    "fastapi",
                ],
                timeout=300,
            )
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
