"""Schémas API pour l'onboarding trading utilisateur."""

from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field


SUPPORTED_BROKER_PLATFORMS = (
    "simulation",
    "binance",
    "coinbase",
    "alpaca",
    "interactive_brokers",
    "trade_republic_waitlist",
)


class UserPreferenceResponse(BaseModel):
    """Préférences produit et moteur IA exposées à l'interface."""

    user_id: uuid.UUID
    minimum_probability_threshold: Decimal
    enable_crypto: bool
    enable_etf: bool
    enable_stocks: bool
    sector_tech: bool
    sector_mines: bool
    sector_real_estate: bool
    sector_insurance: bool
    sector_food: bool
    broker_platform: str
    broker_connection_status: str
    funding_provider: str
    paper_trading_enabled: bool


class UserPreferenceUpdateRequest(BaseModel):
    """Mise à jour partielle des préférences d'investissement."""

    minimum_probability_threshold: Decimal | None = Field(default=None, ge=0, le=100)
    enable_crypto: bool | None = None
    enable_etf: bool | None = None
    enable_stocks: bool | None = None
    sector_tech: bool | None = None
    sector_mines: bool | None = None
    sector_real_estate: bool | None = None
    sector_insurance: bool | None = None
    sector_food: bool | None = None
    broker_platform: str | None = Field(default=None, max_length=32)
    funding_provider: str | None = Field(default=None, max_length=32)
    paper_trading_enabled: bool | None = None


class BrokerPlatformDescriptor(BaseModel):
    """Plateforme d'exécution affichée dans l'onboarding."""

    id: str
    label: str
    asset_classes: list[str]
    status: str
    note: str
