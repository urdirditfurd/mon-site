"""Schémas Pydantic pour les utilisateurs."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field


class UserCreateRequest(BaseModel):
    """Payload de création d'un utilisateur."""

    email: EmailStr


class UserResponse(BaseModel):
    """Réponse API représentant un utilisateur."""

    id: uuid.UUID
    email: EmailStr
    created_at: datetime
    seuil_probabilite_min: Decimal


class TradingThresholdUpdateRequest(BaseModel):
    """Mise à jour du seuil de déclenchement des trades IA."""

    seuil_probabilite_min: Decimal = Field(
        ...,
        ge=0,
        le=100,
        description="Seuil minimal (%) de confiance requis pour déclencher un ordre.",
    )
