"""Routes Brique J: reporting & conformité."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import ensure_user_access, get_current_user, require_roles
from app.db.database import get_session
from app.models.user import User
from app.schemas.reporting import (
    ComplianceSummaryResponse,
    DailyReportResponse,
    ReportOrderItemResponse,
    ReportingSummaryResponse,
    TaxExportResponse,
)
from app.services.audit_service import log_audit_event
from app.services.reporting_service import (
    build_daily_report,
    build_tax_export,
    compute_compliance_summary,
    compute_reporting_summary,
    fetch_filtered_orders,
    to_order_items,
)
from app.services.simple_pdf import build_text_pdf

router = APIRouter(prefix="/reporting", tags=["Reporting & Conformité"])


def _resolve_period(
    start_date: date | None,
    end_date: date | None,
    default_days: int = 30,
) -> tuple[date, date]:
    """Normalise les paramètres de période."""

    today = datetime.now(timezone.utc).date()
    if start_date is None and end_date is None:
        return today - timedelta(days=default_days - 1), today
    if start_date is None and end_date is not None:
        return end_date - timedelta(days=default_days - 1), end_date
    if start_date is not None and end_date is None:
        return start_date, start_date + timedelta(days=default_days - 1)
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date doit être <= end_date.")
    return start_date, end_date  # type: ignore[return-value]


async def _ensure_user_exists(session: AsyncSession, user_id: uuid.UUID) -> None:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")


@router.get("/users/{user_id}/history", response_model=list[ReportOrderItemResponse])
async def get_user_history(
    user_id: uuid.UUID,
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    asset_symbol: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=2000),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[ReportOrderItemResponse]:
    """Historique filtrable par période, actif et statut."""

    await _ensure_user_exists(session, user_id)
    ensure_user_access(current_user=current_user, target_user_id=user_id)
    period_start, period_end = _resolve_period(start_date, end_date, default_days=30)
    orders = await fetch_filtered_orders(
        session,
        user_id=user_id,
        start_date=period_start,
        end_date=period_end,
        asset_symbol=asset_symbol,
        status=status,
        limit=limit,
    )
    return to_order_items(orders)


@router.get("/users/{user_id}/summary", response_model=ReportingSummaryResponse)
async def get_user_reporting_summary(
    user_id: uuid.UUID,
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ReportingSummaryResponse:
    """Résumé d'activité sur période."""

    await _ensure_user_exists(session, user_id)
    ensure_user_access(current_user=current_user, target_user_id=user_id)
    period_start, period_end = _resolve_period(start_date, end_date, default_days=30)
    orders = await fetch_filtered_orders(
        session,
        user_id=user_id,
        start_date=period_start,
        end_date=period_end,
        limit=100000,
    )
    return compute_reporting_summary(
        user_id=user_id,
        period_start=period_start,
        period_end=period_end,
        orders=orders,
    )


@router.get("/users/{user_id}/compliance", response_model=ComplianceSummaryResponse)
async def get_user_compliance_summary(
    user_id: uuid.UUID,
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_roles("admin", "compliance")),
) -> ComplianceSummaryResponse:
    """Résumé conformité (audit + alertes) sur période."""

    await _ensure_user_exists(session, user_id)
    ensure_user_access(
        current_user=current_user,
        target_user_id=user_id,
        allow_roles=("admin", "compliance"),
    )
    period_start, period_end = _resolve_period(start_date, end_date, default_days=30)
    return await compute_compliance_summary(
        session,
        user_id=user_id,
        period_start=period_start,
        period_end=period_end,
    )


@router.get("/users/{user_id}/daily-report.json", response_model=DailyReportResponse)
async def get_daily_report_json(
    user_id: uuid.UUID,
    request: Request,
    report_date: date | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> DailyReportResponse:
    """Rapport journalier structuré JSON."""

    await _ensure_user_exists(session, user_id)
    ensure_user_access(current_user=current_user, target_user_id=user_id)
    target_date = report_date or datetime.now(timezone.utc).date()
    report = await build_daily_report(session, user_id=user_id, report_date=target_date)
    await log_audit_event(
        session,
        source="reporting_api",
        event_type="daily_report_json_generated",
        severity="info",
        message="Rapport journalier JSON généré.",
        user_id=user_id,
        payload={"report_date": str(target_date)},
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    return report


@router.get("/users/{user_id}/daily-report.pdf")
async def get_daily_report_pdf(
    user_id: uuid.UUID,
    request: Request,
    report_date: date | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_roles("admin", "compliance")),
) -> Response:
    """Rapport journalier au format PDF."""

    await _ensure_user_exists(session, user_id)
    ensure_user_access(
        current_user=current_user,
        target_user_id=user_id,
        allow_roles=("admin", "compliance"),
    )
    target_date = report_date or datetime.now(timezone.utc).date()
    report = await build_daily_report(session, user_id=user_id, report_date=target_date)

    summary = report.summary
    compliance = report.compliance
    lines = [
        "Trading IA - Rapport journalier",
        f"Utilisateur: {user_id}",
        f"Date rapport: {target_date.isoformat()}",
        "",
        "=== Activite trading ===",
        f"Ordres total: {summary.total_orders}",
        f"Ordres filled/pending/rejected: {summary.filled_orders}/{summary.pending_orders}/{summary.rejected_orders}",
        f"Volume brut: {summary.gross_volume} EUR",
        f"PnL realise: {summary.realized_pnl} EUR",
        f"Confiance moyenne: {summary.avg_confidence}%",
        f"Taux de reussite: {summary.win_rate_pct}%",
        f"Meilleur trade: {summary.best_trade} EUR",
        f"Pire trade: {summary.worst_trade} EUR",
        "",
        "=== Conformite ===",
        f"Audit events: {compliance.audit_events_total}",
        f"Blocages risque: {compliance.risk_block_events}",
        f"Alertes open/ack: {compliance.open_alerts}/{compliance.acknowledged_alerts}",
        f"Alertes severes: {compliance.high_severity_alerts}",
        f"Dernier evenement risque: {compliance.last_risk_event_at}",
        "",
        "=== Derniers ordres ===",
    ]
    for order in report.orders[:20]:
        lines.append(
            f"{order.created_at.isoformat()} | {order.asset_symbol} | {order.direction} | "
            f"{order.status} | montant={order.montant_ordre} | pnl={order.pnl_simule}"
        )

    pdf_bytes = build_text_pdf(lines)
    filename = f"daily-report-{user_id}-{target_date.isoformat()}.pdf"

    await log_audit_event(
        session,
        source="reporting_api",
        event_type="daily_report_pdf_generated",
        severity="info",
        message="Rapport journalier PDF généré.",
        user_id=user_id,
        payload={"report_date": str(target_date), "filename": filename},
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/users/{user_id}/tax-export", response_model=TaxExportResponse)
async def get_tax_export(
    user_id: uuid.UUID,
    request: Request,
    year: int = Query(default=datetime.now(timezone.utc).year, ge=2000, le=2100),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_roles("admin", "compliance")),
) -> TaxExportResponse:
    """Export fiscal annuel simplifié."""

    await _ensure_user_exists(session, user_id)
    ensure_user_access(
        current_user=current_user,
        target_user_id=user_id,
        allow_roles=("admin", "compliance"),
    )
    export = await build_tax_export(
        session,
        user_id=user_id,
        fiscal_year=year,
    )
    await log_audit_event(
        session,
        source="reporting_api",
        event_type="tax_export_generated",
        severity="info",
        message="Export fiscal simplifié généré.",
        user_id=user_id,
        payload={"fiscal_year": year, "trades_count": export.trades_count},
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    return export
