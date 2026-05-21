"""Schemas API pour le cœur de décision NLP et la gestion des préférences."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Analyse de news
# ---------------------------------------------------------------------------

class AnalyzeNewsRequest(BaseModel):
    """Payload d'analyse d'une news entrante."""

    news_text: str = Field(..., min_length=5, max_length=4000)
    category: str = Field(..., min_length=2, max_length=64)


class AnalyzeNewsResponse(BaseModel):
    """Résultat du pipeline d'analyse NLP."""

    signal_id: uuid.UUID
    mapped_sector: str
    asset_class: str
    retention_category: str
    sentiment_polarity: str
    probability_bullish: Decimal
    probability_bearish: Decimal
    signal_strength: Decimal
    source_confidence: Decimal
    is_valid_signal: bool
    time_to_live_minutes: int
    expires_at: datetime
    keywords_matched: dict[str, list[str]]


# ---------------------------------------------------------------------------
# Évaluation d'opportunité
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Préférences utilisateur
# ---------------------------------------------------------------------------

class UserPreferenceRead(BaseModel):
    """Lecture des préférences utilisateur."""

    id: uuid.UUID
    user_id: uuid.UUID
    minimum_probability_threshold: Decimal
    enable_crypto: bool
    enable_etf: bool
    enable_stocks: bool
    sector_tech: bool
    sector_mines: bool
    sector_real_estate: bool
    sector_insurance: bool
    sector_food: bool
    sector_energy: bool
    sector_healthcare: bool
    max_capital_per_trade_pct: Decimal
    max_concurrent_positions: int
    preferred_trade_duration: str
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserPreferenceUpdate(BaseModel):
    """Mise à jour partielle des préférences utilisateur."""

    minimum_probability_threshold: Decimal | None = Field(None, ge=50, le=99)
    enable_crypto: bool | None = None
    enable_etf: bool | None = None
    enable_stocks: bool | None = None
    sector_tech: bool | None = None
    sector_mines: bool | None = None
    sector_real_estate: bool | None = None
    sector_insurance: bool | None = None
    sector_food: bool | None = None
    sector_energy: bool | None = None
    sector_healthcare: bool | None = None
    max_capital_per_trade_pct: Decimal | None = Field(None, ge=5, le=100)
    max_concurrent_positions: int | None = Field(None, ge=1, le=50)
    preferred_trade_duration: str | None = Field(None, pattern="^(short|medium|long)$")


# ---------------------------------------------------------------------------
# Clôture de cycle
# ---------------------------------------------------------------------------

class CycleClosureItem(BaseModel):
    """Détail de clôture d'une position."""

    trade_id: uuid.UUID
    user_id: uuid.UUID
    sector: str
    direction: str
    capital_returned: Decimal
    simulated_pnl: Decimal
    pnl_pct: Decimal
    close_reason: str
    message: str


class ClosureReportResponse(BaseModel):
    """Rapport agrégé des clôtures de cycle."""

    closed_count: int
    total_pnl: Decimal
    closures: list[CycleClosureItem]
