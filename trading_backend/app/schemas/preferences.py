"""Schémas Pydantic pour la gestion des préférences utilisateur."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class UserPreferenceResponse(BaseModel):
    """Représentation complète des préférences de trading d'un utilisateur."""

    id: uuid.UUID
    user_id: uuid.UUID
    minimum_probability_threshold: Decimal = Field(
        description="Seuil minimum de probabilité (0–100) pour déclencher un signal.",
    )
    enable_crypto: bool
    enable_etf: bool
    enable_stocks: bool
    sector_tech: bool
    sector_mines: bool
    sector_real_estate: bool
    sector_insurance: bool
    sector_food: bool
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserPreferenceUpdateRequest(BaseModel):
    """Mise à jour partielle des préférences utilisateur.

    Tous les champs sont optionnels : seuls les champs fournis sont modifiés.
    """

    minimum_probability_threshold: Decimal | None = Field(
        default=None,
        ge=Decimal("50.00"),
        le=Decimal("99.00"),
        description="Seuil de probabilité min (50–99).",
    )
    enable_crypto: bool | None = None
    enable_etf: bool | None = None
    enable_stocks: bool | None = None
    sector_tech: bool | None = None
    sector_mines: bool | None = None
    sector_real_estate: bool | None = None
    sector_insurance: bool | None = None
    sector_food: bool | None = None
