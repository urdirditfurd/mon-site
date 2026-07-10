"""Schémas Pydantic — API publique."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class AssetQuote(BaseModel):
    symbol: str
    name: str
    asset_type: Literal["stock", "etf", "crypto"]
    price: float
    currency: str = "USD"
    change_pct_24h: float = 0.0


class AnalysisResult(BaseModel):
    symbol: str
    asset_type: str
    buy_probability: float = Field(ge=0, le=100)
    sell_probability: float = Field(ge=0, le=100)
    signal: Literal["ACHETER", "VENDRE", "ATTENDRE"]
    confidence: float = Field(ge=0, le=100)
    reasoning: str
    indicators: dict[str, float] = Field(default_factory=dict)


class Recommendation(BaseModel):
    rank: int
    symbol: str
    name: str
    asset_type: str
    price: float
    buy_probability: float
    expected_gain_pct: float
    risk_level: Literal["faible", "modéré", "élevé"]
    horizon: str
    beginner_summary: str
    reasoning: str


class OpenPositionRequest(BaseModel):
    symbol: str
    user_alias: str = "default"
    quantity: float = Field(default=1.0, gt=0)
    take_profit_pct: float | None = None
    stop_loss_pct: float | None = None


class PositionResponse(BaseModel):
    id: str
    symbol: str
    asset_type: str
    entry_price: float
    current_price: float | None = None
    pnl_pct: float | None = None
    status: str
    take_profit_pct: float
    stop_loss_pct: float
    opened_at: datetime
    exit_reason: str | None = None


class NotificationResponse(BaseModel):
    id: str
    title: str
    body: str
    symbol: str | None
    severity: str
    is_read: bool
    created_at: datetime


class DashboardSummary(BaseModel):
    top_opportunities: list[Recommendation]
    open_positions: list[PositionResponse]
    recent_notifications: list[NotificationResponse]
    last_scan_at: datetime | None
    universe_size: int
    disclaimer: str
