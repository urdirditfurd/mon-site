"""Agrégations reporting & conformité pour la Brique J."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert_event import AlertEvent
from app.models.audit_event import AuditEvent
from app.models.simulated_order import SimulatedOrder
from app.schemas.reporting import (
    ComplianceSummaryResponse,
    DailyReportResponse,
    ReportOrderItemResponse,
    ReportingSummaryResponse,
    TaxAssetBreakdownResponse,
    TaxExportResponse,
)

QTY_2 = Decimal("0.01")


def _quantize(value: Decimal | int | float) -> Decimal:
    return Decimal(str(value)).quantize(QTY_2, rounding=ROUND_HALF_UP)


def date_range_to_datetimes(
    start_date: date,
    end_date: date,
) -> tuple[datetime, datetime]:
    """Convertit une plage de dates en bornes datetime [start, end_exclusive)."""

    start_dt = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=timezone.utc)
    return start_dt, end_dt


async def fetch_filtered_orders(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    start_date: date | None,
    end_date: date | None,
    asset_symbol: str | None = None,
    status: str | None = None,
    limit: int = 200,
) -> list[SimulatedOrder]:
    """Retourne l'historique d'ordres filtré."""

    query = select(SimulatedOrder).where(SimulatedOrder.user_id == user_id)
    if start_date is not None and end_date is not None:
        start_dt, end_dt = date_range_to_datetimes(start_date, end_date)
        query = query.where(
            and_(
                SimulatedOrder.created_at >= start_dt,
                SimulatedOrder.created_at < end_dt,
            )
        )
    if asset_symbol is not None:
        query = query.where(SimulatedOrder.asset_symbol == asset_symbol.upper())
    if status is not None:
        query = query.where(SimulatedOrder.status == status)

    result = await session.execute(query.order_by(desc(SimulatedOrder.created_at)).limit(limit))
    return list(result.scalars().all())


def to_order_items(orders: list[SimulatedOrder]) -> list[ReportOrderItemResponse]:
    """Mappe les ordres DB vers le schéma API reporting."""

    return [
        ReportOrderItemResponse(
            id=order.id,
            asset_symbol=order.asset_symbol,
            direction=order.direction,
            status=order.status,
            montant_ordre=order.montant_ordre,
            requested_price=order.requested_price,
            filled_price=order.filled_price,
            pnl_simule=order.pnl_simule,
            confidence=order.confidence,
            created_at=order.created_at,
        )
        for order in orders
    ]


def compute_reporting_summary(
    *,
    user_id: uuid.UUID,
    period_start: date,
    period_end: date,
    orders: list[SimulatedOrder],
) -> ReportingSummaryResponse:
    """Construit une synthèse trading sur période."""

    total_orders = len(orders)
    filled_orders = [order for order in orders if order.status == "filled"]
    pending_orders = sum(order.status == "pending" for order in orders)
    rejected_orders = sum(order.status == "rejected" for order in orders)

    gross_volume = _quantize(sum((order.montant_ordre for order in orders), Decimal("0.00")))
    realized_pnl = _quantize(sum((order.pnl_simule for order in filled_orders), Decimal("0.00")))

    avg_confidence = Decimal("0.00")
    if total_orders > 0:
        confidence_sum = sum((order.confidence for order in orders), Decimal("0.00"))
        avg_confidence = _quantize(confidence_sum / Decimal(total_orders))

    win_rate_pct = Decimal("0.00")
    if filled_orders:
        winning = sum(order.pnl_simule > 0 for order in filled_orders)
        win_rate_pct = _quantize((Decimal(winning) / Decimal(len(filled_orders))) * Decimal("100"))

    best_trade = _quantize(max((order.pnl_simule for order in filled_orders), default=Decimal("0.00")))
    worst_trade = _quantize(min((order.pnl_simule for order in filled_orders), default=Decimal("0.00")))

    return ReportingSummaryResponse(
        user_id=user_id,
        period_start=period_start,
        period_end=period_end,
        total_orders=total_orders,
        filled_orders=len(filled_orders),
        pending_orders=pending_orders,
        rejected_orders=rejected_orders,
        gross_volume=gross_volume,
        realized_pnl=realized_pnl,
        avg_confidence=avg_confidence,
        win_rate_pct=win_rate_pct,
        best_trade=best_trade,
        worst_trade=worst_trade,
    )


async def compute_compliance_summary(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    period_start: date,
    period_end: date,
) -> ComplianceSummaryResponse:
    """Construit un résumé conformité (audit + alerting)."""

    start_dt, end_dt = date_range_to_datetimes(period_start, period_end)

    audit_result = await session.execute(
        select(AuditEvent).where(
            AuditEvent.user_id == user_id,
            AuditEvent.created_at >= start_dt,
            AuditEvent.created_at < end_dt,
        )
    )
    audits = list(audit_result.scalars().all())
    risk_block_events = sum(event.event_type == "order_blocked_by_risk" for event in audits)

    alert_result = await session.execute(
        select(AlertEvent).where(
            AlertEvent.user_id == user_id,
            AlertEvent.created_at >= start_dt,
            AlertEvent.created_at < end_dt,
        )
    )
    alerts = list(alert_result.scalars().all())

    open_alerts = sum(alert.status == "open" for alert in alerts)
    acknowledged_alerts = sum(alert.status == "ack" for alert in alerts)
    high_severity_alerts = sum(alert.severity in {"high", "critical"} for alert in alerts)

    risk_events = [event for event in audits if "risk" in event.event_type or "risk" in event.source]
    last_risk_event_at = max((event.created_at for event in risk_events), default=None)

    return ComplianceSummaryResponse(
        user_id=user_id,
        period_start=period_start,
        period_end=period_end,
        audit_events_total=len(audits),
        risk_block_events=risk_block_events,
        open_alerts=open_alerts,
        acknowledged_alerts=acknowledged_alerts,
        high_severity_alerts=high_severity_alerts,
        last_risk_event_at=last_risk_event_at,
    )


async def build_daily_report(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    report_date: date,
) -> DailyReportResponse:
    """Construit un rapport journalier consolidé (trading + conformité)."""

    orders = await fetch_filtered_orders(
        session,
        user_id=user_id,
        start_date=report_date,
        end_date=report_date,
        limit=1000,
    )
    summary = compute_reporting_summary(
        user_id=user_id,
        period_start=report_date,
        period_end=report_date,
        orders=orders,
    )
    compliance = await compute_compliance_summary(
        session,
        user_id=user_id,
        period_start=report_date,
        period_end=report_date,
    )

    return DailyReportResponse(
        user_id=user_id,
        report_date=report_date,
        generated_at=datetime.now(timezone.utc),
        summary=summary,
        compliance=compliance,
        orders=to_order_items(orders[:50]),
    )


async def build_tax_export(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    fiscal_year: int,
) -> TaxExportResponse:
    """Construit un export fiscal simplifié annuel."""

    start_date = date(fiscal_year, 1, 1)
    end_date = date(fiscal_year, 12, 31)
    orders = await fetch_filtered_orders(
        session,
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        limit=100000,
    )
    filled_orders = [order for order in orders if order.status == "filled"]

    by_asset: dict[str, list[SimulatedOrder]] = defaultdict(list)
    for order in filled_orders:
        by_asset[order.asset_symbol].append(order)

    assets: list[TaxAssetBreakdownResponse] = []
    gross_volume = Decimal("0.00")
    pnl_total = Decimal("0.00")

    for asset_symbol, asset_orders in sorted(by_asset.items(), key=lambda item: item[0]):
        asset_volume = sum((order.montant_ordre for order in asset_orders), Decimal("0.00"))
        asset_pnl = sum((order.pnl_simule for order in asset_orders), Decimal("0.00"))
        asset_gains = sum((order.pnl_simule for order in asset_orders if order.pnl_simule > 0), Decimal("0.00"))
        asset_losses = -sum((order.pnl_simule for order in asset_orders if order.pnl_simule < 0), Decimal("0.00"))
        assets.append(
            TaxAssetBreakdownResponse(
                asset_symbol=asset_symbol,
                trades_count=len(asset_orders),
                gross_volume=_quantize(asset_volume),
                pnl_total=_quantize(asset_pnl),
                gains_total=_quantize(asset_gains),
                losses_total=_quantize(asset_losses),
            )
        )
        gross_volume += asset_volume
        pnl_total += asset_pnl

    taxable_result = pnl_total if pnl_total > 0 else Decimal("0.00")
    deductible_losses = -pnl_total if pnl_total < 0 else Decimal("0.00")

    return TaxExportResponse(
        user_id=user_id,
        fiscal_year=fiscal_year,
        generated_at=datetime.now(timezone.utc),
        trades_count=len(filled_orders),
        gross_volume=_quantize(gross_volume),
        pnl_total=_quantize(pnl_total),
        taxable_result=_quantize(taxable_result),
        deductible_losses=_quantize(deductible_losses),
        assets=assets,
    )
