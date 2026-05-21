"""Schémas API pour les intégrations externes réelles."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field


class IntegrationStatus(BaseModel):
    """État de configuration d'un prestataire externe."""

    id: str
    label: str
    category: str
    configured: bool
    status: str
    required_env: list[str]
    masked_identifiers: list[str] = []
    note: str


class IntegrationsStatusResponse(BaseModel):
    """Vue consolidée des intégrations paiement, broker et OAuth."""

    payments: list[IntegrationStatus]
    brokers: list[IntegrationStatus]
    oauth: list[IntegrationStatus]


class StripeCheckoutRequest(BaseModel):
    """Demande de création d'une session Stripe Checkout."""

    amount: Decimal = Field(..., gt=0, le=1_000_000)


class StripeCheckoutResponse(BaseModel):
    """Réponse de création de session Stripe Checkout."""

    provider: str
    configured: bool
    checkout_url: str | None = None
    session_id: str | None = None
    message: str


class BrokerActivationRequest(BaseModel):
    """Sélection d'un broker réel ou paper côté serveur."""

    platform: str = Field(..., min_length=2, max_length=32)


class BrokerActivationResponse(BaseModel):
    """Résultat d'activation de broker pour l'utilisateur."""

    platform: str
    configured: bool
    status: str
    message: str


class GoogleOAuthStatusResponse(BaseModel):
    """Statut de disponibilité Google OAuth."""

    configured: bool
    auth_url: str | None = None
    message: str
