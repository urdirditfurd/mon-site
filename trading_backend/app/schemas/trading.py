"""Schémas Pydantic pour la brique de trading IA."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class SimulatedOrderResponse(BaseModel):
    """Vue API d'un ordre simulé."""

    id: uuid.UUID
    user_id: uuid.UUID
    headline: str
    direction: str
    confidence: Decimal
    seuil_utilise: Decimal
    montant_ordre: Decimal
    status: str
    created_at: datetime
