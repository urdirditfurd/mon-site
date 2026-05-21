"""Constantes métier partagées par le moteur de décision."""

from __future__ import annotations

from decimal import Decimal

# Secteurs normalisés (alignés sur `user_preferences` et filtrage)
SECTOR_TECH = "tech"
SECTOR_MINES = "mines"
SECTOR_REAL_ESTATE = "real_estate"
SECTOR_INSURANCE = "insurance"
SECTOR_FOOD = "food"
SECTOR_GENERAL = "general"

# Classes d'actifs dérivées du champ `category` des flux certifiés
ASSET_CRYPTO = "crypto"
ASSET_ETF = "etf"
ASSET_STOCK = "stocks"

# Seuil minimal pipeline : un signal stocké avec probabilité dominante < 70 % reste invalide
MIN_PIPELINE_VALID_PROBABILITY = Decimal("70.00")
MIN_RECOMMENDED_CAPITAL = Decimal("50.00")
