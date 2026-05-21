"""Alignement signaux / préférences utilisateur."""

from __future__ import annotations

import uuid
from decimal import Decimal

from app.models.user_preference import UserPreference
from app.services.algorithm.constants import ASSET_CRYPTO, ASSET_ETF, SECTOR_FOOD, SECTOR_GENERAL, SECTOR_INSURANCE, SECTOR_MINES, SECTOR_REAL_ESTATE, SECTOR_TECH


def is_sector_enabled(preference: UserPreference, sector: str) -> bool:
    if sector == SECTOR_TECH:
        return preference.sector_tech
    if sector == SECTOR_MINES:
        return preference.sector_mines
    if sector == SECTOR_REAL_ESTATE:
        return preference.sector_real_estate
    if sector == SECTOR_INSURANCE:
        return preference.sector_insurance
    if sector == SECTOR_FOOD:
        return preference.sector_food
    if sector == SECTOR_GENERAL:
        return True
    return True


def is_asset_class_enabled(preference: UserPreference, asset_class: str) -> bool:
    if asset_class == ASSET_CRYPTO:
        return preference.enable_crypto
    if asset_class == ASSET_ETF:
        return preference.enable_etf
    return preference.enable_stocks


def default_preferences_for_user(user_id: uuid.UUID) -> UserPreference:
    """Préférences par défaut cohérentes avec le produit (seuil 70 %)."""

    return UserPreference(
        user_id=user_id,
        minimum_probability_threshold=Decimal("70.00"),
        enable_crypto=True,
        enable_etf=True,
        enable_stocks=True,
        sector_tech=True,
        sector_mines=True,
        sector_real_estate=False,
        sector_insurance=False,
        sector_food=False,
    )
