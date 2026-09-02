"""
Point d'entrée unique LTX Studio.
Démarre ComfyUI, attend qu'il soit prêt, lance l'interface web.
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
import webbrowser

import uvicorn

import comfy_boot


def open_browser_later() -> None:
    time.sleep(6)
    webbrowser.open("http://127.0.0.1:8191")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true", help="Fenêtre ComfyUI visible")
    args = parser.parse_args()

    comfy_boot.install_requirements()
    comfy_boot.log("=== LTX Studio launcher ===")

    ready = comfy_boot.wait_until_ready(timeout_seconds=900, visible=args.debug)
    if not ready:
        comfy_boot.log(f"ComfyUI non prêt: {comfy_boot.diagnose()}")
    else:
        comfy_boot.log("Lancement interface web…")

    if not args.debug:
        threading.Thread(target=open_browser_later, daemon=True).start()

    uvicorn.run("server:app", host="127.0.0.1", port=8191, reload=False, log_level="warning")


if __name__ == "__main__":
    main()
