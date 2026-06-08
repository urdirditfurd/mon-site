"""Schémas pour les actualités simulées."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class SimulatedNews(BaseModel):
    """Une news financière (Telegram ou simulateur)."""

    id: uuid.UUID
    headline: str
    source: str
    direction: str
    confidence: float
    impact_label: str
    generated_at: datetime
    news_text: str | None = None
    url: str | None = None
