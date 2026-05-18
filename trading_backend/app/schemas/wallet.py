"""Schémas Pydantic pour les opérations portefeuille."""

from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field


class DepositRequest(BaseModel):
    """Demande de dépôt (simulation Stripe)."""

    amount: Decimal = Field(..., gt=0, description="Montant du dépôt")
    payment_method: str | None = Field(default=None, description="Moyen de paiement simulé")


class AllocateFundsRequest(BaseModel):
    """Demande d'allocation du solde disponible vers le solde engagé."""

    amount: Decimal = Field(..., gt=0, description="Montant à allouer au trading")


class WalletResponse(BaseModel):
    """Vue API du portefeuille."""

    user_id: uuid.UUID
    solde_total: Decimal
    solde_disponible: Decimal
    solde_engage: Decimal


class WalletOperationResponse(BaseModel):
    """Réponse standard pour les actions dépôt/allocation."""

    message: str
    wallet: WalletResponse
    transaction_id: str | None = None
