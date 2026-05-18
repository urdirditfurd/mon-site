"""Schémas API pour reporting & conformité (Brique J)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class ReportOrderItemResponse(BaseModel):
    """Ligne d'historique trading pour reporting."""

    id: uuid.UUID
    asset_symbol: str
    direction: str
    status: str
    montant_ordre: Decimal
    requested_price: Decimal
    filled_price: Decimal | None
    pnl_simule: Decimal
    confidence: Decimal
    created_at: datetime


class ReportingSummaryResponse(BaseModel):
    """Synthèse d'activité trading sur une période."""

    user_id: uuid.UUID
    period_start: date
    period_end: date
    total_orders: int
    filled_orders: int
    pending_orders: int
    rejected_orders: int
    gross_volume: Decimal
    realized_pnl: Decimal
    avg_confidence: Decimal
    win_rate_pct: Decimal
    best_trade: Decimal
    worst_trade: Decimal


class ComplianceSummaryResponse(BaseModel):
    """Synthèse conformité/risque sur une période."""

    user_id: uuid.UUID
    period_start: date
    period_end: date
    audit_events_total: int
    risk_block_events: int
    open_alerts: int
    acknowledged_alerts: int
    high_severity_alerts: int
    last_risk_event_at: datetime | None


class DailyReportResponse(BaseModel):
    """Rapport journalier complet."""

    user_id: uuid.UUID
    report_date: date
    generated_at: datetime
    summary: ReportingSummaryResponse
    compliance: ComplianceSummaryResponse
    orders: list[ReportOrderItemResponse]


class TaxAssetBreakdownResponse(BaseModel):
    """Détail fiscal simplifié par actif."""

    asset_symbol: str
    trades_count: int
    gross_volume: Decimal
    pnl_total: Decimal
    gains_total: Decimal
    losses_total: Decimal


class TaxExportResponse(BaseModel):
    """Export fiscal simplifié annuel."""

    user_id: uuid.UUID
    fiscal_year: int
    generated_at: datetime
    trades_count: int
    gross_volume: Decimal
    pnl_total: Decimal
    taxable_result: Decimal
    deductible_losses: Decimal
    assets: list[TaxAssetBreakdownResponse]
