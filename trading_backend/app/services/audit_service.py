"""Services de persistance audit/alerting + publication monitoring."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert_event import AlertEvent
from app.models.audit_event import AuditEvent
from app.services.monitoring_hub import MonitoringHub


async def log_audit_event(
    session: AsyncSession,
    *,
    source: str,
    event_type: str,
    severity: str,
    message: str,
    user_id: uuid.UUID | None = None,
    payload: dict | None = None,
    monitoring_hub: MonitoringHub | None = None,
) -> AuditEvent:
    """Enregistre un événement d'audit et le diffuse au runtime."""

    event = AuditEvent(
        user_id=user_id,
        source=source,
        event_type=event_type,
        severity=severity,
        message=message,
        payload=payload,
    )
    session.add(event)
    await session.flush()

    if monitoring_hub:
        monitoring_hub.publish_event(
            channel="audit",
            event_type=event_type,
            severity=severity,
            message=message,
            payload={
                "audit_id": str(event.id),
                "user_id": str(user_id) if user_id else None,
                **(payload or {}),
            },
        )

    return event


async def create_alert_event(
    session: AsyncSession,
    *,
    source: str,
    alert_code: str,
    severity: str,
    message: str,
    user_id: uuid.UUID | None = None,
    payload: dict | None = None,
    monitoring_hub: MonitoringHub | None = None,
) -> AlertEvent:
    """Crée une nouvelle alerte ouverte."""

    alert = AlertEvent(
        user_id=user_id,
        source=source,
        alert_code=alert_code,
        severity=severity,
        status="open",
        message=message,
        payload=payload,
    )
    session.add(alert)
    await session.flush()

    if monitoring_hub:
        monitoring_hub.publish_event(
            channel="alerts",
            event_type=alert_code,
            severity=severity,
            message=message,
            payload={
                "alert_id": str(alert.id),
                "user_id": str(user_id) if user_id else None,
                **(payload or {}),
            },
        )

    return alert


async def ensure_open_alert(
    session: AsyncSession,
    *,
    source: str,
    alert_code: str,
    severity: str,
    message: str,
    user_id: uuid.UUID | None = None,
    payload: dict | None = None,
    monitoring_hub: MonitoringHub | None = None,
) -> AlertEvent:
    """Retourne une alerte open existante (même code) ou en crée une."""

    existing = await session.scalar(
        select(AlertEvent).where(
            AlertEvent.user_id == user_id,
            AlertEvent.alert_code == alert_code,
            AlertEvent.status == "open",
        )
    )
    if existing is not None:
        return existing

    return await create_alert_event(
        session,
        source=source,
        alert_code=alert_code,
        severity=severity,
        message=message,
        user_id=user_id,
        payload=payload,
        monitoring_hub=monitoring_hub,
    )


def acknowledge_alert(alert: AlertEvent) -> AlertEvent:
    """Marque une alerte en état ack."""

    alert.status = "ack"
    alert.acknowledged_at = datetime.now(timezone.utc)
    return alert
