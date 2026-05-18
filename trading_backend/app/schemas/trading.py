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
    broker: str
    broker_order_id: str
    asset_symbol: str
    headline: str
    direction: str
    confidence: Decimal
    seuil_utilise: Decimal
    montant_ordre: Decimal
    requested_price: Decimal
    filled_price: Decimal | None
    pnl_simule: Decimal
    status: str
    rejection_reason: str | None
    created_at: datetime
    updated_at: datetime


class OrderStatsResponse(BaseModel):
    """Statistiques synthétiques des ordres simulés."""

    user_id: uuid.UUID
    total_orders: int
    pending_orders: int
    filled_orders: int
    rejected_orders: int
    total_pnl_simule: Decimal
