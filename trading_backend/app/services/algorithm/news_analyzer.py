"""Persistance et analyse des news entrantes (pipeline NLP simulé)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from app.db.database import AsyncSessionLocal
from app.models.market_signal import MarketSignal
from app.services.algorithm.scoring import (
    compute_directional_probabilities,
    estimate_ttl_minutes,
    extract_source_from_category,
    is_valid_pipeline_signal,
    mapped_sector_for_analysis,
    resolve_asset_class,
    signal_strength_from_probabilities,
    source_confidence_score,
)
from app.services.algorithm.types import NewsAnalysisResult


async def analyze_incoming_news(news_text: str, category: str) -> NewsAnalysisResult:
    """Simule le NLP (FinBERT / LLM quantifié) : secteur, polarité, probabilités, TTL.

    - Extrait probabilités haussière / baissière (0–100 %).
    - Mappe un secteur (ex. lithium → mines) via mots-clés bornés.
    - Marque ``is_valid_signal`` si la probabilité dominante ≥ 70 % (seuil pipeline).
    - Persiste une ligne ``market_signals`` pour audit et décision utilisateur.
    """

    if not news_text or not news_text.strip():
        raise ValueError("news_text doit contenir du texte.")
    if not category or not category.strip():
        raise ValueError("category doit être renseignée.")

    # Point d'accroche async (I/O modèle / batching futur)
    await asyncio.sleep(0)

    normalized_category = category.strip().lower()
    stripped_text = news_text.strip()
    source = extract_source_from_category(normalized_category)
    source_conf = source_confidence_score(source)
    mapped_sector = mapped_sector_for_analysis(stripped_text)
    polarity, bullish, bearish = compute_directional_probabilities(stripped_text, normalized_category, source_conf)
    strength = signal_strength_from_probabilities(bullish, bearish)
    is_valid = is_valid_pipeline_signal(strength)
    ttl_minutes = estimate_ttl_minutes(stripped_text, normalized_category, mapped_sector, strength)
    expires_at = datetime.now(UTC) + timedelta(minutes=ttl_minutes)

    signal = MarketSignal(
        source=source,
        category=normalized_category,
        news_text=stripped_text,
        mapped_sector=mapped_sector,
        sentiment_polarity=polarity,
        source_confidence=source_conf,
        probability_bullish=bullish,
        probability_bearish=bearish,
        signal_strength=strength,
        is_valid_signal=is_valid,
        time_to_live_minutes=ttl_minutes,
        expires_at=expires_at,
        metadata_json={
            "pipeline_version": "v1.1",
            "asset_class": resolve_asset_class(normalized_category),
            "nlp_mode": "simulated_deterministic",
        },
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
