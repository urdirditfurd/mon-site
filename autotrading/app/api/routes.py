"""Routes API REST + WebSocket temps réel."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_session
from app.models.entities import MarketScan, Notification
from app.schemas.market import (
    AnalysisResult,
    DashboardSummary,
    NotificationResponse,
    OpenPositionRequest,
    PositionResponse,
    Recommendation,
)
from app.services.analyzer import analyze_snapshot
from app.services.market_data import fetch_market_snapshot
from app.services.notifier import NotificationService
from app.services.position_monitor import PositionMonitor
from app.services.universe import get_universe

router = APIRouter(prefix="/api")

DISCLAIMER = (
    "⚠️ AutoTrading Lemon est un outil éducatif. Les probabilités sont des estimations techniques, "
    "pas des conseils financiers. Ne investissez que ce que vous pouvez perdre. "
    "Trading broker : mode paper par défaut. Binance ferme en France — préférez Kraken ou Bitget. "
    "Chaque ordre réel nécessite votre approbation (sauf auto-exécution explicitement activée)."
)


def _get_scheduler():
    from app.main import runtime_scheduler

    return runtime_scheduler


@router.get("/health")
async def health() -> dict[str, Any]:
    sched = _get_scheduler()
    return {
        "status": "ok",
        "version": settings.app_version,
        "scanner_running": sched.scanner.is_running,
        "last_scan_at": sched.scanner.last_scan_at.isoformat() if sched.scanner.last_scan_at else None,
    }


@router.get("/dashboard", response_model=DashboardSummary)
async def dashboard(session: AsyncSession = Depends(get_session)) -> DashboardSummary:
    sched = _get_scheduler()
    monitor = PositionMonitor(session)
    notifier = NotificationService(session)

    positions = await monitor.list_open()
    notifs = await notifier.list_recent(limit=10)

    return DashboardSummary(
        top_opportunities=sched.scanner.latest_recommendations,
        open_positions=positions,
        recent_notifications=[
            NotificationResponse(
                id=n.id,
                title=n.title,
                body=n.body,
                symbol=n.symbol,
                severity=n.severity,
                is_read=n.is_read,
                created_at=n.created_at,
            )
            for n in notifs
        ],
        last_scan_at=sched.scanner.last_scan_at,
        universe_size=len(get_universe()),
        disclaimer=DISCLAIMER,
    )


@router.get("/recommendations", response_model=list[Recommendation])
async def recommendations() -> list[Recommendation]:
    return _get_scheduler().scanner.latest_recommendations


@router.post("/scan/trigger")
async def trigger_scan() -> dict[str, Any]:
    sched = _get_scheduler()
    if sched.scanner.is_running:
        raise HTTPException(status_code=409, detail="Scan déjà en cours")
    count = await sched.scanner.run_full_scan()
    return {"scanned": count, "at": datetime.now(UTC).isoformat()}


@router.get("/analyze/{symbol}", response_model=AnalysisResult)
async def analyze_symbol(symbol: str) -> AnalysisResult:
    asset = next((a for a in get_universe() if a.symbol.upper() == symbol.upper()), None)
    if not asset:
        raise HTTPException(status_code=404, detail="Symbole non suivi")
    snapshot = await fetch_market_snapshot(asset)
    if not snapshot:
        raise HTTPException(status_code=502, detail="Données marché indisponibles")
    return analyze_snapshot(snapshot)


@router.get("/universe")
async def universe() -> list[dict[str, str]]:
    return [
        {"symbol": a.symbol, "name": a.name, "asset_type": a.asset_type, "region": a.region}
        for a in get_universe()
    ]


@router.get("/history", response_model=list[dict[str, Any]])
async def scan_history(session: AsyncSession = Depends(get_session), limit: int = 50) -> list[dict[str, Any]]:
    stmt = select(MarketScan).order_by(desc(MarketScan.scanned_at)).limit(limit)
    result = await session.execute(stmt)
    rows = result.scalars().all()
    return [
        {
            "symbol": r.symbol,
            "asset_type": r.asset_type,
            "price": r.price,
            "buy_probability": r.buy_probability,
            "signal": r.signal,
            "scanned_at": r.scanned_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/positions", response_model=PositionResponse)
async def open_position(
    body: OpenPositionRequest,
    session: AsyncSession = Depends(get_session),
) -> PositionResponse:
    sched = _get_scheduler()
    rec = next((r for r in sched.scanner.latest_recommendations if r.symbol == body.symbol), None)
    entry_prob = rec.buy_probability if rec else 0.0

    monitor = PositionMonitor(session)
    pos = await monitor.open_position(
        symbol=body.symbol,
        user_alias=body.user_alias,
        quantity=body.quantity,
        take_profit_pct=body.take_profit_pct,
        stop_loss_pct=body.stop_loss_pct,
        entry_probability=entry_prob,
    )
    if not pos:
        raise HTTPException(status_code=400, detail="Impossible d'ouvrir la position")

    positions = await monitor.list_open(body.user_alias)
    match = next((p for p in positions if p.id == pos.id), None)
    if not match:
        raise HTTPException(status_code=500, detail="Position créée mais introuvable")
    return match


@router.get("/positions", response_model=list[PositionResponse])
async def list_positions(
    user_alias: str = "default",
    session: AsyncSession = Depends(get_session),
) -> list[PositionResponse]:
    monitor = PositionMonitor(session)
    return await monitor.list_open(user_alias)


@router.get("/notifications", response_model=list[NotificationResponse])
async def list_notifications(
    user_alias: str = "default",
    session: AsyncSession = Depends(get_session),
) -> list[NotificationResponse]:
    notifier = NotificationService(session)
    rows = await notifier.list_recent(user_alias)
    return [
        NotificationResponse(
            id=n.id,
            title=n.title,
            body=n.body,
            symbol=n.symbol,
            severity=n.severity,
            is_read=n.is_read,
            created_at=n.created_at,
        )
        for n in rows
    ]


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    notifier = NotificationService(session)
    await notifier.mark_read(notification_id)
    return {"status": "ok"}


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active:
            self.active.remove(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in self.active:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


ws_manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await ws_manager.connect(websocket)
    try:
        sched = _get_scheduler()
        await websocket.send_json(
            {
                "type": "welcome",
                "message": "Connecté au flux temps réel AutoTrading Lemon",
                "recommendations": [r.model_dump() for r in sched.scanner.latest_recommendations],
            }
        )
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "heartbeat", "at": datetime.now(UTC).isoformat()})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
