"""Types de retour du moteur algorithmique."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


@dataclass(slots=True)
class NewsAnalysisResult:
    """Sortie standard du pipeline de scoring news (simulation NLP)."""

    signal_id: uuid.UUID
    mapped_sector: str
    sentiment_polarity: str
    probability_bullish: Decimal
    probability_bearish: Decimal
    signal_strength: Decimal
    is_valid_signal: bool
    time_to_live_minutes: int
    expires_at: datetime


@dataclass(slots=True)
class TradingOpportunityResult:
    """Décision d'exécution après croisement préférences / signaux."""

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
