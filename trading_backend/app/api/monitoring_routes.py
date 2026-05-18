"""Routes Brique F/G/H: audit, alerting et monitoring temps réel."""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.models.alert_event import AlertEvent
from app.models.audit_event import AuditEvent
from app.models.simulated_order import SimulatedOrder
from app.models.trading_profile import TradingProfile
from app.models.user import User
from app.schemas.monitoring import (
    AlertAcknowledgeResponse,
    AlertEventResponse,
    AuditEventResponse,
    MonitoringDashboardResponse,
    RuntimeEventResponse,
)
from app.services.audit_service import acknowledge_alert, log_audit_event

router = APIRouter(prefix="/monitoring", tags=["Monitoring"])


def _to_audit_response(event: AuditEvent) -> AuditEventResponse:
    return AuditEventResponse(
        id=event.id,
        user_id=event.user_id,
        source=event.source,
        event_type=event.event_type,
        severity=event.severity,
        message=event.message,
        payload=event.payload,
        created_at=event.created_at,
    )


def _to_alert_response(alert: AlertEvent) -> AlertEventResponse:
    return AlertEventResponse(
        id=alert.id,
        user_id=alert.user_id,
        source=alert.source,
        alert_code=alert.alert_code,
        severity=alert.severity,
        status=alert.status,
        message=alert.message,
        payload=alert.payload,
        created_at=alert.created_at,
        updated_at=alert.updated_at,
        acknowledged_at=alert.acknowledged_at,
    )


@router.get("/audit", response_model=list[AuditEventResponse])
async def list_audit_events(
    limit: int = Query(default=100, ge=1, le=500),
    user_id: uuid.UUID | None = Query(default=None),
    severity: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> list[AuditEventResponse]:
    """Retourne les événements d'audit filtrables."""

    query = select(AuditEvent)
    if user_id is not None:
        query = query.where(AuditEvent.user_id == user_id)
    if severity is not None:
        query = query.where(AuditEvent.severity == severity)
    if event_type is not None:
        query = query.where(AuditEvent.event_type == event_type)

    result = await session.execute(query.order_by(desc(AuditEvent.created_at)).limit(limit))
    return [_to_audit_response(event) for event in result.scalars().all()]


@router.get("/alerts", response_model=list[AlertEventResponse])
async def list_alerts(
    limit: int = Query(default=100, ge=1, le=500),
    user_id: uuid.UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> list[AlertEventResponse]:
    """Retourne les alertes filtrables."""

    query = select(AlertEvent)
    if user_id is not None:
        query = query.where(AlertEvent.user_id == user_id)
    if status is not None:
        query = query.where(AlertEvent.status == status)

    result = await session.execute(query.order_by(desc(AlertEvent.created_at)).limit(limit))
    return [_to_alert_response(alert) for alert in result.scalars().all()]


@router.patch("/alerts/{alert_id}/ack", response_model=AlertAcknowledgeResponse)
async def ack_alert(
    alert_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> AlertAcknowledgeResponse:
    """Acquitte une alerte open."""

    alert = await session.get(AlertEvent, alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alerte introuvable.")

    acknowledge_alert(alert)
    session.add(alert)
    await log_audit_event(
        session,
        source="monitoring_api",
        event_type="alert_acknowledged",
        severity="info",
        message="Alerte acquittée manuellement.",
        user_id=alert.user_id,
        payload={"alert_id": str(alert.id), "alert_code": alert.alert_code},
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    await session.refresh(alert)

    return AlertAcknowledgeResponse(
        message="Alerte acquittée.",
        alert=_to_alert_response(alert),
    )


@router.get("/dashboard", response_model=MonitoringDashboardResponse)
async def get_dashboard_snapshot(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> MonitoringDashboardResponse:
    """Retourne une vue consolidée système (ops/dashboard)."""

    engine = request.app.state.trading_engine
    hub = request.app.state.monitoring_hub

    users_total = await session.scalar(select(func.count(User.id))) or 0
    users_trading_active = await session.scalar(
        select(func.count(TradingProfile.id)).where(TradingProfile.is_trading_active.is_(True))
    ) or 0
    orders_total = await session.scalar(select(func.count(SimulatedOrder.id))) or 0
    orders_pending = await session.scalar(
        select(func.count(SimulatedOrder.id)).where(SimulatedOrder.status == "pending")
    ) or 0
    orders_filled = await session.scalar(
        select(func.count(SimulatedOrder.id)).where(SimulatedOrder.status == "filled")
    ) or 0
    orders_rejected = await session.scalar(
        select(func.count(SimulatedOrder.id)).where(SimulatedOrder.status == "rejected")
    ) or 0
    pnl_total = await session.scalar(select(func.coalesce(func.sum(SimulatedOrder.pnl_simule), 0))) or 0
    alerts_open = await session.scalar(
        select(func.count(AlertEvent.id)).where(AlertEvent.status == "open")
    ) or 0
    alerts_acknowledged = await session.scalar(
        select(func.count(AlertEvent.id)).where(AlertEvent.status == "ack")
    ) or 0

    runtime_events = [
        RuntimeEventResponse(
            channel=event["channel"],
            event_type=event["event_type"],
            severity=event["severity"],
            message=event["message"],
            payload=event.get("payload"),
            created_at=event["created_at"],
        )
        for event in hub.recent_events(limit=30)
    ]

    return MonitoringDashboardResponse(
        engine_running=engine.is_running,
        websocket_subscribers=hub.subscriber_count,
        users_total=users_total,
        users_trading_active=users_trading_active,
        orders_total=orders_total,
        orders_pending=orders_pending,
        orders_filled=orders_filled,
        orders_rejected=orders_rejected,
        pnl_total=Decimal(str(pnl_total)).quantize(Decimal("0.01")),
        alerts_open=alerts_open,
        alerts_acknowledged=alerts_acknowledged,
        recent_runtime_events=runtime_events,
    )


@router.websocket("/ws")
async def monitoring_ws(websocket: WebSocket) -> None:
    """WebSocket de monitoring runtime."""

    await websocket.accept()
    hub = websocket.app.state.monitoring_hub
    queue = hub.subscribe()

    await websocket.send_json(
        jsonable_encoder(
            {
                "type": "snapshot",
                "events": hub.recent_events(limit=15),
                "subscribers": hub.subscriber_count,
            }
        )
    )

    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=20.0)
                await websocket.send_json(jsonable_encoder({"type": "event", "data": event}))
            except asyncio.TimeoutError:
                await websocket.send_json(jsonable_encoder({"type": "heartbeat"}))
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(queue)
