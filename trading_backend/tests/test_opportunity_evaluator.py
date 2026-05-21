"""Tests du moteur de décision (unitaires + intégration PostgreSQL)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.models.market_signal import MarketSignal
from app.models.user_preference import UserPreference
from app.services.news_analyzer import analyze_incoming_news
from app.services.opportunity_evaluator import (
    evaluate_trading_opportunity,
    filter_eligible_signals,
    is_sector_enabled,
)


def test_is_sector_enabled_respects_flags() -> None:
    pref = UserPreference(
        user_id=uuid.uuid4(),
        minimum_probability_threshold=Decimal("70.00"),
        sector_tech=True,
        sector_mines=False,
    )
    assert is_sector_enabled(pref, "tech") is True
    assert is_sector_enabled(pref, "mines") is False


def test_filter_eligible_signals_threshold_and_sector() -> None:
    pref = UserPreference(
        user_id=uuid.uuid4(),
        minimum_probability_threshold=Decimal("80.00"),
        enable_crypto=False,
        enable_stocks=True,
        sector_mines=True,
        sector_tech=False,
    )
    now = datetime.now(UTC)
    signals = [
        MarketSignal(
            source="reuters_api",
            category="reuters/stocks",
            news_text="Gold miners rally",
            mapped_sector="mines",
            sentiment_polarity="positive",
            source_confidence=Decimal("93.00"),
            probability_bullish=Decimal("85.00"),
            probability_bearish=Decimal("15.00"),
            signal_strength=Decimal("85.00"),
            is_valid_signal=True,
            time_to_live_minutes=120,
            expires_at=now + timedelta(hours=2),
        ),
        MarketSignal(
            source="reuters_api",
            category="binance/crypto",
            news_text="BTC breakout",
            mapped_sector="tech",
            sentiment_polarity="positive",
            source_confidence=Decimal("88.00"),
            probability_bullish=Decimal("90.00"),
            probability_bearish=Decimal("10.00"),
            signal_strength=Decimal("90.00"),
            is_valid_signal=True,
            time_to_live_minutes=60,
            expires_at=now + timedelta(hours=1),
        ),
    ]
    eligible = filter_eligible_signals(signals, pref, Decimal("80.00"))
    assert len(eligible) == 1
    assert eligible[0].mapped_sector == "mines"


@pytest.mark.asyncio
async def test_analyze_incoming_news_persists_mines_sector(db_session) -> None:
    result = await analyze_incoming_news(
        "Gold and lithium miners rally after supply shock",
        "reuters/stocks",
    )
    assert result.mapped_sector == "mines"
    assert result.is_valid_signal is True
    assert result.signal_strength >= Decimal("70.00")


@pytest.mark.asyncio
async def test_evaluate_trading_opportunity_opens_trade(db_session, trader_with_wallet) -> None:
    user, wallet, preference = trader_with_wallet
    preference.minimum_probability_threshold = Decimal("70.00")
    preference.sector_mines = True

    analysis = await analyze_incoming_news(
        "Gold and lithium surge: miners announce record partnership and growth upgrade",
        "reuters/stocks",
    )
    assert analysis.is_valid_signal

    decision = await evaluate_trading_opportunity(user.id, session=db_session)
    await db_session.commit()

    assert decision.should_execute is True
    assert decision.sector == "mines"
    assert decision.active_trade_id is not None
    assert decision.estimated_duration_minutes is not None
    assert decision.estimated_duration_minutes >= 30
    assert decision.recommended_capital is not None
    assert decision.recommended_capital <= wallet.solde_disponible


@pytest.mark.asyncio
async def test_evaluate_rejects_when_threshold_above_signal(db_session, trader_with_wallet) -> None:
    user, _, preference = trader_with_wallet
    preference.minimum_probability_threshold = Decimal("99.00")

    await analyze_incoming_news(
        "Gold and lithium surge with record growth partnership",
        "reuters/stocks",
    )

    decision = await evaluate_trading_opportunity(user.id, session=db_session)
    assert decision.should_execute is False
