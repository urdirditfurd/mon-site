"""Schémas Pydantic pour la brique de trading IA."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class SimulatedOrderResponse(BaseModel):
    """Vue API d'un ordre simulé."""

    id: uuid.UUID
    user_id: uuid.UUID
    broker: str
    broker_order_id: str
    asset_symbol: str
    headline: str
    direction: str
    confidence: Decimal
    seuil_utilise: Decimal
    montant_ordre: Decimal
    requested_price: Decimal
    filled_price: Decimal | None
    pnl_simule: Decimal
    status: str
    rejection_reason: str | None
    created_at: datetime
    updated_at: datetime


class OrderStatsResponse(BaseModel):
    """Statistiques synthétiques des ordres simulés."""

    user_id: uuid.UUID
    total_orders: int
    pending_orders: int
    filled_orders: int
    rejected_orders: int
    total_pnl_simule: Decimal


class RiskProfileResponse(BaseModel):
    """Vue API du profil de risque utilisateur."""

    user_id: uuid.UUID
    is_trading_active: bool
    risk_block_reason: str | None
    max_orders_per_day: int
    stop_loss_pct: Decimal
    max_drawdown_pct: Decimal
    orders_today: int
    cumulative_pnl_today: Decimal
    equity_peak: Decimal
    equity_current: Decimal
    current_drawdown_pct: Decimal
    last_risk_reset_date: date


class RiskProfileUpdateRequest(BaseModel):
    """Payload de mise à jour de la politique de risque."""

    is_trading_active: bool | None = None
    max_orders_per_day: int | None = Field(default=None, ge=1, le=1000)
    stop_loss_pct: Decimal | None = Field(default=None, gt=0, le=100)
    max_drawdown_pct: Decimal | None = Field(default=None, gt=0, le=100)
    reset_daily_counters: bool = False


class EngineControlActionRequest(BaseModel):
    """Commande de pause moteur."""

    reason: str | None = None


class EngineControlSnapshotResponse(BaseModel):
    """État global du moteur automatique."""

    is_running: bool
    is_paused: bool
    reason: str | None
    updated_at: datetime
