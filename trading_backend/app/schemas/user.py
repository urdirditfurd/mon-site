"""Schémas Pydantic pour les utilisateurs."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field


class UserCreateRequest(BaseModel):
    """Payload de création d'un utilisateur."""

    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    role: str = Field(default="trader", pattern="^(trader|compliance|admin)$")


class UserResponse(BaseModel):
    """Réponse API représentant un utilisateur."""

    id: uuid.UUID
    email: EmailStr
    role: str
    is_active: bool
    created_at: datetime
    seuil_probabilite_min: Decimal
    is_trading_active: bool


class TradingThresholdUpdateRequest(BaseModel):
    """Mise à jour du seuil de déclenchement des trades IA."""

    seuil_probabilite_min: Decimal = Field(
        ...,
        ge=0,
        le=100,
        description="Seuil minimal (%) de confiance requis pour déclencher un ordre.",
    )
