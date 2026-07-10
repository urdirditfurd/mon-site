"""Schémas API — courtiers et exécution."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class BrokerConnectRequest(BaseModel):
    exchange_id: str
    label: str = ""
    api_key: str
    api_secret: str
    passphrase: str = ""
    mode: Literal["paper", "live"] = "paper"
    user_alias: str = "default"
    max_order_usd: float = Field(default=100.0, gt=0, le=10000)
    auto_execute: bool = False


class BrokerAccountResponse(BaseModel):
    id: str
    exchange_id: str
    label: str
    mode: str
    is_active: bool
    auto_execute: bool
    max_order_usd: float
    created_at: datetime


class StageOrderRequest(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    amount_usd: float = Field(gt=0, le=10000)
    broker_id: str | None = None
    user_alias: str = "default"
    commit_message: str = ""


class StagedOrderResponse(BaseModel):
    id: str
    symbol: str
    asset_type: str
    side: str
    amount_usd: float
    price_at_stage: float
    probability: float
    status: str
    commit_message: str
    signal_reason: str
    staged_at: datetime
    external_order_id: str | None = None
    error_message: str | None = None


class ApproveOrderRequest(BaseModel):
    commit_message: str = "Approuvé par l'utilisateur"


class ExchangeInfoResponse(BaseModel):
    id: str
    name: str
    asset_types: list[str]
    region_note: str
    sandbox_available: bool
    recommended_fr: bool
    deprecated_fr: bool
    setup_url: str
