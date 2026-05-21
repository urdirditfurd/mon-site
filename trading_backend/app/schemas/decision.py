"""Schemas API pour le coeur de décision NLP."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class AnalyzeNewsRequest(BaseModel):
    """Payload d'analyse d'une news entrante."""

    news_text: str = Field(..., min_length=5, max_length=4000)
    category: str = Field(..., min_length=2, max_length=64)


class AnalyzeNewsResponse(BaseModel):
    """Résultat du pipeline d'analyse NLP."""

    signal_id: uuid.UUID
    mapped_sector: str
    sentiment_polarity: str
    probability_bullish: Decimal
    probability_bearish: Decimal
    signal_strength: Decimal
    is_valid_signal: bool
    time_to_live_minutes: int
    expires_at: datetime


class TradingOpportunityResponse(BaseModel):
    """Décision finale de déclenchement d'une opportunité."""

    should_execute: bool
    reason: str
    user_id: uuid.UUID
    market_signal_id: uuid.UUID | None = None
    direction: str | None = None
    asset_class: str | None = None
    sector: str | None = None
    probability_used: Decimal | None = None
    recommended_capital: Decimal | None = None
    estimated_duration_minutes: int | None = None
    planned_close_at: datetime | None = None
    active_trade_id: uuid.UUID | None = None


class ActiveTradeResponse(BaseModel):
    """Représentation d'une position ouverte ou clôturée."""

    id: uuid.UUID
    user_id: uuid.UUID
    market_signal_id: uuid.UUID | None
    asset_class: str
    sector: str
    direction: str
    probability_used: Decimal
    capital_engaged: Decimal
    status: str
    opened_at: datetime
    estimated_duration_minutes: int
    planned_close_at: datetime
    closed_at: datetime | None
    close_reason: str | None
    pnl_realise: Decimal | None

    model_config = {"from_attributes": True}


class CloseTradeRequest(BaseModel):
    """Clôture manuelle d'un trade actif."""

    reason: str = Field(
        default="Clôture manuelle demandée par l'utilisateur.",
        min_length=5,
        max_length=255,
    )
