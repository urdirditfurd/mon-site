"""Pipeline NLP simulé : scoring, mapping sectoriel et persistance des signaux."""

from __future__ import annotations

import asyncio
import hashlib
import re
from datetime import UTC, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from app.db.database import AsyncSessionLocal
from app.domain.decision import (
    ASSET_CRYPTO,
    ASSET_ETF,
    ASSET_STOCK,
    MIN_SIGNAL_PROBABILITY,
    NewsAnalysisResult,
    SECTOR_FOOD,
    SECTOR_GENERAL,
    SECTOR_INSURANCE,
    SECTOR_MINES,
    SECTOR_REAL_ESTATE,
    SECTOR_TECH,
)
from app.models.market_signal import MarketSignal

_SECTOR_KEYWORDS: dict[str, frozenset[str]] = {
    SECTOR_MINES: frozenset(
        {"or", "gold", "lithium", "copper", "cuivre", "nickel", "mine", "mining", "uranium", "silver"}
    ),
    SECTOR_TECH: frozenset(
        {"nvidia", "ai", "ia", "semiconductor", "cloud", "software", "cyber", "chip", "datacenter"}
    ),
    SECTOR_REAL_ESTATE: frozenset(
        {"real estate", "reit", "housing", "mortgage", "immobilier", "property", "landlord"}
    ),
    SECTOR_INSURANCE: frozenset({"insurance", "assurance", "reinsurance", "insurer", "sinistre", "underwriter"}),
    SECTOR_FOOD: frozenset({"food", "agri", "agriculture", "wheat", "sugar", "alimentation", "beverage", "cocoa"}),
}

_BULLISH_KEYWORDS = frozenset(
    {
        "upgrade",
        "growth",
        "record",
        "beats",
        "partnership",
        "acquisition",
        "hausse",
        "bénéfice",
        "rally",
        "surge",
    }
)
_BEARISH_KEYWORDS = frozenset(
    {
        "downgrade",
        "lawsuit",
        "fraud",
        "sanction",
        "baisse",
        "inflation",
        "rate hike",
        "warning",
        "crash",
        "selloff",
    }
)


def quantize_probability(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def clamp_decimal(value: Decimal, minimum: Decimal, maximum: Decimal) -> Decimal:
    return max(minimum, min(value, maximum))


def deterministic_noise(news_text: str, category: str) -> Decimal:
    digest = hashlib.sha256(f"{category}:{news_text.lower()}".encode("utf-8")).hexdigest()
    seed = int(digest[:8], 16)
    return Decimal((seed % 1201) - 600) / Decimal("100")


def extract_source(category: str) -> str:
    lowered = category.lower()
    if "bloomberg" in lowered:
        return "bloomberg_enterprise"
    if "reuters" in lowered:
        return "reuters_api"
    if "benzinga" in lowered:
        return "benzinga"
    if "x" in lowered or "twitter" in lowered:
        return "x_api_v2"
    if "rss" in lowered:
        return "rss_certified"
    return "certified_feed"


def source_confidence(source: str) -> Decimal:
    mapping = {
        "bloomberg_enterprise": Decimal("95.00"),
        "reuters_api": Decimal("93.00"),
        "benzinga": Decimal("88.00"),
        "x_api_v2": Decimal("74.00"),
        "rss_certified": Decimal("80.00"),
    }
    return mapping.get(source, Decimal("78.00"))


def _keyword_in_text(keyword: str, lowered: str) -> bool:
    if len(keyword) <= 3:
        return re.search(rf"\b{re.escape(keyword)}\b", lowered) is not None
    return keyword in lowered


def map_sector_from_text(news_text: str) -> str:
    lowered = news_text.lower()
    for sector, keywords in _SECTOR_KEYWORDS.items():
        if any(_keyword_in_text(keyword, lowered) for keyword in keywords):
            return sector
    return SECTOR_GENERAL


def resolve_asset_class(category: str) -> str:
    lowered = category.lower()
    if "crypto" in lowered or "binance" in lowered or "coinbase" in lowered:
        return ASSET_CRYPTO
    if "etf" in lowered:
        return ASSET_ETF
    return ASSET_STOCK


def compute_probabilities(
    news_text: str,
    category: str,
    source_conf: Decimal,
) -> tuple[str, Decimal, Decimal]:
    lowered = news_text.lower()
    bullish_hits = sum(keyword in lowered for keyword in _BULLISH_KEYWORDS)
    bearish_hits = sum(keyword in lowered for keyword in _BEARISH_KEYWORDS)

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
        + deterministic_noise(news_text, category)
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
        clamp_decimal(Decimal("52.00") + deterministic_noise(news_text, category), Decimal("45.00"), Decimal("65.00"))
    )
    opposite = quantize_probability(Decimal("100.00") - neutral_center)
    return ("neutral", neutral_center, opposite)


def estimate_ttl_minutes(
    news_text: str,
    category: str,
    mapped_sector: str,
    strength: Decimal,
) -> int:
    lowered = news_text.lower()
    if any(keyword in lowered for keyword in {"interest rate", "inflation", "central bank", "fed", "ecb", "macro"}):
        base_ttl = 60 * 24 * 3
    elif any(keyword in lowered for keyword in {"tweet", "post", "influencer", "rumor"}):
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


async def analyze_incoming_news(news_text: str, category: str) -> NewsAnalysisResult:
    if not news_text or not news_text.strip():
        raise ValueError("news_text doit contenir du texte.")
    if not category or not category.strip():
        raise ValueError("category doit être renseignée.")

    await asyncio.sleep(0)

    source = extract_source(category)
    source_conf = source_confidence(source)
    mapped_sector = map_sector_from_text(news_text)
    polarity, bullish, bearish = compute_probabilities(news_text, category, source_conf)
    strength = quantize_probability(max(bullish, bearish))
    is_valid_signal = strength >= MIN_SIGNAL_PROBABILITY
    ttl_minutes = estimate_ttl_minutes(news_text, category, mapped_sector, strength)
    expires_at = datetime.now(UTC) + timedelta(minutes=ttl_minutes)

    signal = MarketSignal(
        source=source,
        category=category.strip().lower(),
        news_text=news_text.strip(),
        mapped_sector=mapped_sector,
        sentiment_polarity=polarity,
        source_confidence=source_conf,
        probability_bullish=bullish,
        probability_bearish=bearish,
        signal_strength=strength,
        is_valid_signal=is_valid_signal,
        time_to_live_minutes=ttl_minutes,
        expires_at=expires_at,
        metadata_json={"pipeline_version": "v1.0", "asset_class": resolve_asset_class(category)},
    )

    async with AsyncSessionLocal() as session:
        session.add(signal)
        await session.commit()
        await session.refresh(signal)

    return NewsAnalysisResult(
        signal_id=signal.id,
        mapped_sector=signal.mapped_sector,
        sentiment_polarity=signal.sentiment_polarity,
        probability_bullish=signal.probability_bullish,
        probability_bearish=signal.probability_bearish,
        signal_strength=signal.signal_strength,
        is_valid_signal=signal.is_valid_signal,
        time_to_live_minutes=signal.time_to_live_minutes,
        expires_at=signal.expires_at,
    )
