"""Scoring probabiliste simulé, confiance source, TTL et classe d'actif."""

from __future__ import annotations

import hashlib
import re
from decimal import Decimal, ROUND_HALF_UP

from app.services.algorithm.constants import (
    ASSET_CRYPTO,
    ASSET_ETF,
    ASSET_STOCK,
    MIN_PIPELINE_VALID_PROBABILITY,
    SECTOR_MINES,
    SECTOR_TECH,
)
from app.services.algorithm.sector_detection import map_sector_from_news_text


def quantize_probability(value: Decimal) -> Decimal:
    """Arrondi pour pourcentages (2 décimales)."""

    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def quantize_money(value: Decimal) -> Decimal:
    """Arrondi montants portefeuille (2 décimales)."""

    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def clamp_decimal(value: Decimal, minimum: Decimal, maximum: Decimal) -> Decimal:
    return max(minimum, min(value, maximum))


def noise_from_text(news_text: str, category: str) -> Decimal:
    """Bruit déterministe pour stabiliser les tests et simuler la variance modèle."""

    digest = hashlib.sha256(f"{category}:{news_text.lower()}".encode("utf-8")).hexdigest()
    seed = int(digest[:8], 16)
    return Decimal((seed % 1201) - 600) / Decimal("100")


def extract_source_from_category(category: str) -> str:
    """Déduit l'agrégateur / canal certifié à partir du libellé ``category``."""

    lowered = category.lower()
    if "bloomberg" in lowered:
        return "bloomberg_enterprise"
    if "reuters" in lowered:
        return "reuters_api"
    if "benzinga" in lowered:
        return "benzinga"
    if re.search(r"\bx\b|twitter", lowered):
        return "x_api_v2"
    if "rss" in lowered:
        return "rss_certified"
    return "certified_feed"


def source_confidence_score(source: str) -> Decimal:
    """Indice de confiance de la source (0–100 %), distinct de la probabilité de marché."""

    table: dict[str, Decimal] = {
        "bloomberg_enterprise": Decimal("95.00"),
        "reuters_api": Decimal("93.00"),
        "benzinga": Decimal("88.00"),
        "x_api_v2": Decimal("74.00"),
        "rss_certified": Decimal("80.00"),
        "certified_feed": Decimal("78.00"),
    }
    return table.get(source, Decimal("78.00"))


def resolve_asset_class(category: str) -> str:
    lowered = category.lower()
    if "crypto" in lowered or "binance" in lowered or "coinbase" in lowered:
        return ASSET_CRYPTO
    if "etf" in lowered:
        return ASSET_ETF
    return ASSET_STOCK


def compute_directional_probabilities(
    news_text: str,
    category: str,
    source_conf: Decimal,
) -> tuple[str, Decimal, Decimal]:
    """Simule FinBERT / LLM : polarité + probabilités haussière / baissière."""

    lowered = news_text.lower()
    bullish_keywords = {
        "upgrade",
        "growth",
        "record",
        "beats",
        "partnership",
        "acquisition",
        "hausse",
        "bénéfice",
    }
    bearish_keywords = {
        "downgrade",
        "lawsuit",
        "fraud",
        "sanction",
        "baisse",
        "inflation",
        "rate hike",
        "warning",
    }
    bullish_hits = sum(keyword in lowered for keyword in bullish_keywords)
    bearish_hits = sum(keyword in lowered for keyword in bearish_keywords)

    base = Decimal("58.00")
    source_bonus = (source_conf - Decimal("70.00")) / Decimal("6.0")
    category_bonus = (
        Decimal("3.00") if resolve_asset_class(category) in {ASSET_CRYPTO, ASSET_STOCK} else Decimal("1.50")
    )
    score = (
        base
        + (Decimal("8.50") * Decimal(bullish_hits + bearish_hits))
        + source_bonus
        + category_bonus
        + noise_from_text(news_text, category)
    )
    strength = quantize_probability(clamp_decimal(score, Decimal("50.00"), Decimal("99.00")))

    if bullish_hits > bearish_hits:
        probability_bullish = strength
        probability_bearish = quantize_probability(Decimal("100.00") - strength)
        return ("positive", probability_bullish, probability_bearish)
    if bearish_hits > bullish_hits:
        probability_bearish = strength
        probability_bullish = quantize_probability(Decimal("100.00") - strength)
        return ("negative", probability_bullish, probability_bearish)

    neutral_center = quantize_probability(
        clamp_decimal(
            Decimal("52.00") + noise_from_text(news_text, category),
            Decimal("45.00"),
            Decimal("65.00"),
        )
    )
    opposite = quantize_probability(Decimal("100.00") - neutral_center)
    return ("neutral", neutral_center, opposite)


def estimate_ttl_minutes(news_text: str, category: str, mapped_sector: str, strength: Decimal) -> int:
    """Horizon de rétention dynamique (minutes) : macro vs social vs secteur."""

    lowered = news_text.lower()
    if any(
        keyword in lowered
        for keyword in ("interest rate", "inflation", "central bank", "fed", "ecb", "macro", "taux directeur")
    ):
        base_ttl = 60 * 24 * 3
    elif any(keyword in lowered for keyword in ("tweet", "post", "influencer", "influenceur", "rumor", "rumeur")):
        base_ttl = 45
    elif mapped_sector == SECTOR_MINES:
        base_ttl = 60 * 18
    elif mapped_sector == SECTOR_TECH:
        base_ttl = 60 * 8
    elif resolve_asset_class(category) == ASSET_CRYPTO:
        base_ttl = 60 * 4
    else:
        base_ttl = 60 * 6

    confidence_multiplier = Decimal("1.0") + ((strength - Decimal("70.00")) / Decimal("100.0"))
    ttl = int(Decimal(base_ttl) * confidence_multiplier)
    return max(30, min(ttl, 60 * 24 * 7))


def signal_strength_from_probabilities(bullish: Decimal, bearish: Decimal) -> Decimal:
    """Force du signal = probabilité dominante (orientation marché)."""

    return quantize_probability(max(bullish, bearish))


def is_valid_pipeline_signal(strength: Decimal) -> bool:
    return strength >= MIN_PIPELINE_VALID_PROBABILITY


def mapped_sector_for_analysis(news_text: str) -> str:
    """Point d'extension unique pour le mapping secteur côté scoring."""

    return map_sector_from_news_text(news_text)
