"""UI route for the embedded zero-tech dashboard."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, RedirectResponse

router = APIRouter(tags=["UI"])

_WEB_DIR = Path(__file__).resolve().parents[1] / "web"
_DASHBOARD_FILE = _WEB_DIR / "dashboard.html"


@router.get("/", include_in_schema=False)
async def root_redirect() -> RedirectResponse:
    """Redirect root path to the embedded dashboard."""

    return RedirectResponse(url="/ui", status_code=307)


@router.get("/ui", include_in_schema=False)
async def ui_dashboard() -> FileResponse:
    """Serve the embedded HTML dashboard."""

    return FileResponse(_DASHBOARD_FILE)
