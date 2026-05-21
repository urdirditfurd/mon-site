"""Tests fonctionnels pour ``analyze_incoming_news``.

Ces tests valident le contrat publié par ``app.services.decision_engine`` :

* extraction d'une probabilité haussière / baissière cohérente,
* mapping sectoriel déterministe sur les mots-clefs critiques
  (Mines, Tech, Immobilier, Assurance, Alimentation),
* drapeau ``is_valid_signal`` strictement piloté par le seuil 70 %,
* persistance dans la table ``market_signals`` avec ``expires_at``
  calculé à partir du TTL dynamique,
* rejet propre des entrées malformées (texte vide, catégorie vide).
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from app.models.market_signal import MarketSignal
from app.services.decision_engine import (
    MIN_SIGNAL_PROBABILITY,
    SECTOR_FOOD,
    SECTOR_GENERAL,
    SECTOR_INSURANCE,
    SECTOR_MINES,
    SECTOR_REAL_ESTATE,
    SECTOR_TECH,
    analyze_incoming_news,
)


pytestmark = pytest.mark.asyncio


async def _count_signals(session_factory: async_sessionmaker[AsyncSession]) -> int:
    async with session_factory() as session:
        return int(await session.scalar(select(func.count()).select_from(MarketSignal)) or 0)


async def test_analyse_classe_signal_haussier_au_dessus_du_seuil(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    result = await analyze_incoming_news(
        news_text=(
            "Nvidia delivers a record AI chip growth and announces a major "
            "semiconductor partnership beating analyst expectations."
        ),
        category="Bloomberg",
    )

    assert result.mapped_sector == SECTOR_TECH
    assert result.sentiment_polarity == "positive"
    assert result.probability_bullish >= MIN_SIGNAL_PROBABILITY
    assert result.probability_bearish == Decimal("100.00") - result.probability_bullish
    assert result.signal_strength == result.probability_bullish
    assert result.is_valid_signal is True
    assert result.time_to_live_minutes >= 30
    assert result.expires_at is not None

    assert await _count_signals(session_factory) == 1


async def test_analyse_classe_signal_baissier_au_dessus_du_seuil(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    result = await analyze_incoming_news(
        news_text=(
            "Major bank issues downgrade warning on tech stocks amid lawsuit "
            "and sanction risk; analysts expect significant downside."
        ),
        category="Reuters",
    )

    assert result.mapped_sector == SECTOR_TECH
    assert result.sentiment_polarity == "negative"
    assert result.probability_bearish >= MIN_SIGNAL_PROBABILITY
    assert result.probability_bullish == Decimal("100.00") - result.probability_bearish
    assert result.signal_strength == result.probability_bearish
    assert result.is_valid_signal is True


async def test_analyse_invalide_un_signal_neutre(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    result = await analyze_incoming_news(
        news_text="Quarterly update mentions a stable outlook with no major catalysts.",
        category="RSS",
    )

    assert result.sentiment_polarity == "neutral"
    assert result.signal_strength < MIN_SIGNAL_PROBABILITY
    assert result.is_valid_signal is False


@pytest.mark.parametrize(
    "news_text, expected_sector",
    [
        ("Gold and lithium mining producers ramp up production in Quebec.", SECTOR_MINES),
        ("Cloud cyber security company unveils new AI semiconductor lineup.", SECTOR_TECH),
        ("REIT housing market shows mortgage stress in major real estate hubs.", SECTOR_REAL_ESTATE),
        ("Insurance group reinsurance arm posts strong premium growth.", SECTOR_INSURANCE),
        ("Food and beverage giant beats forecasts on wheat and sugar pricing.", SECTOR_FOOD),
        ("Macro update: central banks discuss inflation and interest rate path.", SECTOR_GENERAL),
    ],
)
async def test_mapping_sectoriel_reconnait_les_mots_clefs(news_text: str, expected_sector: str) -> None:
    result = await analyze_incoming_news(news_text=news_text, category="Bloomberg")
    assert result.mapped_sector == expected_sector


async def test_persistance_du_signal_inclut_metadata_et_ttl(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    result = await analyze_incoming_news(
        news_text="Federal Reserve raises interest rate amid stubborn inflation, warning of further hikes.",
        category="Reuters",
    )

    async with session_factory() as session:
        signal = await session.get(MarketSignal, result.signal_id)

    assert signal is not None
    assert signal.source == "reuters_api"
    assert signal.category == "reuters"
    assert signal.metadata_json == {"pipeline_version": "v1.0", "asset_class": "stocks"}
    assert signal.time_to_live_minutes >= 60 * 24, "Une news macro doit avoir un TTL long."
    assert signal.is_valid_signal is True


async def test_ttl_est_court_pour_un_tweet_d_influenceur(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    result = await analyze_incoming_news(
        news_text="Influencer tweet rumor: massive partnership coming for this crypto.",
        category="X",
    )

    assert result.time_to_live_minutes <= 90, (
        "Un signal issu d'un tweet d'influenceur doit avoir un TTL court "
        "(quelques dizaines de minutes maximum)."
    )


async def test_analyse_rejette_les_entrees_vides() -> None:
    with pytest.raises(ValueError):
        await analyze_incoming_news(news_text="   ", category="Bloomberg")

    with pytest.raises(ValueError):
        await analyze_incoming_news(news_text="Solid news content", category="")


async def test_analyse_est_deterministe_sur_la_meme_entree(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    payload = {
        "news_text": "Acquisition partnership beats record growth in cloud and AI semiconductor.",
        "category": "Benzinga",
    }

    first = await analyze_incoming_news(**payload)
    second = await analyze_incoming_news(**payload)

    assert first.signal_strength == second.signal_strength
    assert first.probability_bullish == second.probability_bullish
    assert first.probability_bearish == second.probability_bearish
    assert first.mapped_sector == second.mapped_sector
    assert first.sentiment_polarity == second.sentiment_polarity
    assert first.time_to_live_minutes == second.time_to_live_minutes
