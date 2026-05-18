"""Schémas API pour audit, alerting et monitoring."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class AuditEventResponse(BaseModel):
    """Représentation d'un événement d'audit."""

    id: uuid.UUID
    user_id: uuid.UUID | None
    source: str
    event_type: str
    severity: str
    message: str
    payload: dict | None
    created_at: datetime


class AlertEventResponse(BaseModel):
    """Représentation d'une alerte."""

    id: uuid.UUID
    user_id: uuid.UUID | None
    source: str
    alert_code: str
    severity: str
    status: str
    message: str
    payload: dict | None
    created_at: datetime
    updated_at: datetime
    acknowledged_at: datetime | None


class AlertAcknowledgeResponse(BaseModel):
    """Réponse de confirmation d'acquittement d'alerte."""

    message: str
    alert: AlertEventResponse


class RuntimeEventResponse(BaseModel):
    """Événement runtime envoyé au dashboard temps réel."""

    channel: str
    event_type: str
    severity: str
    message: str
    payload: dict | None
    created_at: datetime


class MonitoringDashboardResponse(BaseModel):
    """Snapshot global pour dashboard ops."""

    engine_running: bool
    websocket_subscribers: int
    users_total: int
    users_trading_active: int
    orders_total: int
    orders_pending: int
    orders_filled: int
    orders_rejected: int
    pnl_total: Decimal
    alerts_open: int
    alerts_acknowledged: int
    recent_runtime_events: list[RuntimeEventResponse]
