"""Schémas pour les actualités simulées."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class SimulatedNews(BaseModel):
    """Une news financière analysée par le moteur IA simulé."""

    headline: str
    direction: str
    confidence: float
    generated_at: datetime
