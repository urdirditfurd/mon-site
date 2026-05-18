"""Routes pour exposer le flux de news simulées."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.schemas.news import SimulatedNews
from app.services.news_simulator import NewsSimulator

router = APIRouter(prefix="/news", tags=["News"])


def _get_simulator(request: Request) -> NewsSimulator:
    return request.app.state.news_simulator


@router.get("/live", response_model=list[SimulatedNews])
async def get_live_news(
    request: Request,
    limit: int = Query(default=10, ge=1, le=100),
) -> list[SimulatedNews]:
    """Retourne les dernières actualités générées en tâche de fond."""

    simulator = _get_simulator(request)
    items = simulator.latest(limit=limit)
    return [SimulatedNews(**item) for item in items]
