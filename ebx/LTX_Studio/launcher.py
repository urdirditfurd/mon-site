"""
LTX Studio — Self-Healing Launcher (one-click).

1. Installe les deps FastAPI si besoin
2. Lance ComfyUI avec boucle auto-cicatrisante (jusqu'à 3 profils)
3. Démarre l'interface web sur :8191
4. Ouvre le navigateur
"""

from __future__ import annotations

import argparse
import threading
import time
import webbrowser

import uvicorn

import comfy_boot


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
    comfy_boot.log(f"Python  = {comfy_boot.COMFY_PYTHON}")
    comfy_boot.log(f"ComfyUI = {comfy_boot.COMFY_DIR}")
    comfy_boot.log("=" * 60)

    comfy_boot.install_requirements()

    ready = comfy_boot.wait_until_ready(timeout_seconds=900, max_attempts=3)
    if ready:
        comfy_boot.log("ComfyUI STABLE — démarrage UI")
    else:
        comfy_boot.log(f"ComfyUI NON PRÊT — UI démarre quand même avec rapport: {comfy_boot.diagnose()}")

    if not args.no_browser and not args.debug:
        threading.Thread(target=open_browser_later, daemon=True).start()

    # L'UI reste joignable même si ComfyUI a échoué → affiche error_report
    uvicorn.run("server:app", host="127.0.0.1", port=8191, reload=False, log_level="warning")


if __name__ == "__main__":
    main()
