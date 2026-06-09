"""Routes pour exposer le flux d'actualités (Telegram + fallback simulateur)."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.schemas.news import SimulatedNews
from app.services.news_feed_hub import NewsFeedHub

router = APIRouter(prefix="/news", tags=["News"])


def _get_hub(request: Request) -> NewsFeedHub:
    return request.app.state.news_feed_hub


@router.get("/live", response_model=list[SimulatedNews])
async def get_live_news(
    request: Request,
    limit: int = Query(default=10, ge=1, le=100),
) -> list[SimulatedNews]:
    """Retourne les dernières actualités (canal Telegram si configuré, sinon simulateur)."""

    hub = _get_hub(request)
    items = hub.latest(limit=limit)
    return [SimulatedNews(**item) for item in items]


@router.get("/rss/status")
async def rss_news_status(request: Request) -> dict:
    """État de l'ingestion RSS (sources configurées)."""

    return _get_hub(request).rss.health_snapshot()


@router.get("/telegram/status")
async def telegram_news_status(request: Request) -> dict:
    """État de l'ingestion Telegram (diagnostic)."""

    hub = _get_hub(request)
    snap = hub.telegram.health_snapshot()
    snap["public_url"] = (
        f"https://t.me/s/{snap['channel']}" if snap.get("channel") else None
    )
    return snap
