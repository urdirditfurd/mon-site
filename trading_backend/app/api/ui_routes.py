"""UI route for the SentiQ dashboard."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, RedirectResponse

router = APIRouter(tags=["UI"])

_WEB_DIR = Path(__file__).resolve().parents[1] / "web"
_SENTIQ_FILE = _WEB_DIR / "sentiq.html"
_FALLBACK_FILE = _WEB_DIR / "dashboard.html"


@router.get("/", include_in_schema=False)
async def root_redirect() -> RedirectResponse:
    """Redirect root path to the SentiQ dashboard."""

    return RedirectResponse(url="/ui", status_code=307)


@router.get("/ui", include_in_schema=False)
async def ui_dashboard() -> FileResponse:
    """Serve the SentiQ HTML dashboard."""

    target = _SENTIQ_FILE if _SENTIQ_FILE.exists() else _FALLBACK_FILE
    return FileResponse(
        target,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
        },
    )
