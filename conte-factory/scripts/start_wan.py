#!/usr/bin/env python3
"""Demarre Wan depuis les scripts Windows (evite les problemes de guillemets PowerShell)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import WAN_START_TIMEOUT_SEC
from modules.wan_service import ensure_wan_running


def main() -> int:
    result = ensure_wan_running(wait_seconds=WAN_START_TIMEOUT_SEC)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
