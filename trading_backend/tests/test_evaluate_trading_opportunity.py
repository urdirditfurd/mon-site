"""Tests fonctionnels pour ``evaluate_trading_opportunity``.

Couvre :

* l'ouverture d'une position lorsque le signal correspond aux préférences
  utilisateur et passe le seuil de probabilité ;
* le rejet d'un signal sous le seuil utilisateur (même s'il est au-dessus
  du seuil global) ;
* le rejet d'un signal dont le secteur est désactivé dans les préférences ;
* le rejet d'un signal dont la classe d'actif est désactivée ;
* le rejet en cas de wallet absent / capital nul ;
* l'idempotence : aucune nouvelle position n'est ouverte tant qu'une
  position est déjà ouverte sur le même signal.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from app.models.active_trade import ActiveTrade
from app.models.market_signal import MarketSignal
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet
from app.services.decision_engine import (
    ASSET_CRYPTO,
    ASSET_STOCK,
    SECTOR_FOOD,
    SECTOR_MINES,
    SECTOR_REAL_ESTATE,
    SECTOR_TECH,
    evaluate_trading_opportunity,
)
from tests.conftest import TraderProfile


pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers de fabrication de signaux directement en base.
# ---------------------------------------------------------------------------


async def _insert_signal(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    sector: str,
    asset_class: str = ASSET_STOCK,
    strength: Decimal = Decimal("82.00"),
    polarity: str = "positive",
    is_valid: bool = True,
    ttl_minutes: int = 240,
    expires_in_minutes: int | None = None,
    category: str | None = None,
) -> uuid.UUID:
    """Insère un signal arbitraire dans ``market_signals`` et renvoie son id."""

    if category is None:
        if asset_class == ASSET_CRYPTO:
            category = "binance"
        elif asset_class == "etf":
            category = "etf"
        else:
            category = "bloomberg"

    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=expires_in_minutes if expires_in_minutes is not None else ttl_minutes)

    bullish = strength if polarity != "negative" else Decimal("100.00") - strength
    bearish = Decimal("100.00") - bullish

    signal = MarketSignal(
        source="bloomberg_enterprise",
        category=category,
        news_text=f"Synthetic signal for {sector}/{asset_class}",
        mapped_sector=sector,
        sentiment_polarity=polarity,
        source_confidence=Decimal("90.00"),
        probability_bullish=bullish,
        probability_bearish=bearish,
        signal_strength=strength,
        is_valid_signal=is_valid,
        time_to_live_minutes=ttl_minutes,
        expires_at=expires_at,
        metadata_json={"pipeline_version": "v1.0", "asset_class": asset_class},
    )

    async with session_factory() as session:
        session.add(signal)
        await session.commit()
        await session.refresh(signal)
        return signal.id


# ---------------------------------------------------------------------------
# Cas nominaux.
# ---------------------------------------------------------------------------


async def test_ouvre_une_position_quand_signal_aligne_avec_preferences(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    signal_id = await _insert_signal(
        session_factory,
        sector=SECTOR_TECH,
        asset_class=ASSET_STOCK,
        strength=Decimal("84.50"),
    )

    decision = await evaluate_trading_opportunity(trader_profile.user_id)

    assert decision.should_execute is True
    assert decision.market_signal_id == signal_id
    assert decision.direction == "buy"
    assert decision.asset_class == ASSET_STOCK
    assert decision.sector == SECTOR_TECH
    assert decision.probability_used == Decimal("84.50")
    assert decision.recommended_capital is not None
    assert decision.recommended_capital > Decimal("0.00")
    assert decision.estimated_duration_minutes is not None
    assert decision.planned_close_at is not None
    assert decision.active_trade_id is not None

    async with session_factory() as session:
        active = await session.get(ActiveTrade, decision.active_trade_id)
        assert active is not None
        assert active.status == "open"
        assert active.user_id == trader_profile.user_id
        assert active.market_signal_id == signal_id


async def test_choisit_le_signal_le_plus_fort_quand_plusieurs_eligibles(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    await _insert_signal(session_factory, sector=SECTOR_TECH, strength=Decimal("73.00"))
    strongest_id = await _insert_signal(
        session_factory, sector=SECTOR_MINES, strength=Decimal("91.00")
    )
    await _insert_signal(session_factory, sector=SECTOR_TECH, strength=Decimal("80.00"))

    decision = await evaluate_trading_opportunity(trader_profile.user_id)

    assert decision.should_execute is True
    assert decision.market_signal_id == strongest_id
    assert decision.probability_used == Decimal("91.00")


async def test_direction_passe_a_sell_pour_un_signal_negatif(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    await _insert_signal(
        session_factory,
        sector=SECTOR_TECH,
        strength=Decimal("88.00"),
        polarity="negative",
    )

    decision = await evaluate_trading_opportunity(trader_profile.user_id)

    assert decision.should_execute is True
    assert decision.direction == "sell"


# ---------------------------------------------------------------------------
# Filtres utilisateur.
# ---------------------------------------------------------------------------


async def test_rejet_si_signal_sous_le_seuil_utilisateur(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    async with session_factory() as session:
        preference = await session.scalar(
            select(UserPreference).where(UserPreference.user_id == trader_profile.user_id)
        )
        assert preference is not None
        preference.minimum_probability_threshold = Decimal("90.00")
        await session.commit()

    await _insert_signal(
        session_factory,
        sector=SECTOR_TECH,
        strength=Decimal("82.00"),
    )

    decision = await evaluate_trading_opportunity(trader_profile.user_id)

    assert decision.should_execute is False
    assert "préférences" in decision.reason.lower() or "alignés" in decision.reason.lower()

    async with session_factory() as session:
        count = await session.scalar(select(func.count()).select_from(ActiveTrade))
    assert count == 0


async def test_rejet_si_secteur_desactive(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    await _insert_signal(
        session_factory,
        sector=SECTOR_FOOD,
        strength=Decimal("88.00"),
    )

    decision = await evaluate_trading_opportunity(trader_profile.user_id)

    assert decision.should_execute is False


async def test_rejet_si_classe_actif_desactivee(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    async with session_factory() as session:
        preference = await session.scalar(
            select(UserPreference).where(UserPreference.user_id == trader_profile.user_id)
        )
        assert preference is not None
        preference.enable_crypto = False
        await session.commit()

    await _insert_signal(
        session_factory,
        sector=SECTOR_TECH,
        asset_class=ASSET_CRYPTO,
        strength=Decimal("86.00"),
        category="binance",
    )

    decision = await evaluate_trading_opportunity(trader_profile.user_id)

    assert decision.should_execute is False


async def test_signal_invalide_est_ignore(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    await _insert_signal(
        session_factory,
        sector=SECTOR_TECH,
        strength=Decimal("82.00"),
        is_valid=False,
    )

    decision = await evaluate_trading_opportunity(trader_profile.user_id)

    assert decision.should_execute is False
    assert "signal" in decision.reason.lower()


async def test_signal_expire_est_ignore(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    await _insert_signal(
        session_factory,
        sector=SECTOR_TECH,
        strength=Decimal("82.00"),
        expires_in_minutes=-15,
    )

    decision = await evaluate_trading_opportunity(trader_profile.user_id)

    assert decision.should_execute is False


# ---------------------------------------------------------------------------
# Garde-fous capital & idempotence.
# ---------------------------------------------------------------------------


async def test_rejet_si_capital_disponible_nul(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    async with session_factory() as session:
        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == trader_profile.user_id))
        assert wallet is not None
        wallet.solde_disponible = Decimal("0.00")
        wallet.solde_engage = wallet.solde_total
        await session.commit()

    await _insert_signal(session_factory, sector=SECTOR_TECH, strength=Decimal("90.00"))

    decision = await evaluate_trading_opportunity(trader_profile.user_id)

    assert decision.should_execute is False
    assert "capital" in decision.reason.lower()


async def test_rejet_si_utilisateur_inconnu(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    decision = await evaluate_trading_opportunity(uuid.uuid4())

    assert decision.should_execute is False
    assert "utilisateur" in decision.reason.lower()


async def test_idempotence_aucune_seconde_position_sur_meme_signal(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    await _insert_signal(session_factory, sector=SECTOR_TECH, strength=Decimal("85.00"))

    first = await evaluate_trading_opportunity(trader_profile.user_id)
    second = await evaluate_trading_opportunity(trader_profile.user_id)

    assert first.should_execute is True
    assert second.should_execute is False

    async with session_factory() as session:
        active_count = await session.scalar(
            select(func.count())
            .select_from(ActiveTrade)
            .where(ActiveTrade.user_id == trader_profile.user_id)
        )
    assert active_count == 1


async def test_creation_des_preferences_par_defaut_si_absentes(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    async with session_factory() as session:
        existing = await session.scalar(
            select(UserPreference).where(UserPreference.user_id == trader_profile.user_id)
        )
        assert existing is not None
        await session.delete(existing)
        await session.commit()

    await _insert_signal(session_factory, sector=SECTOR_TECH, strength=Decimal("88.00"))

    decision = await evaluate_trading_opportunity(trader_profile.user_id)

    assert decision.should_execute is True

    async with session_factory() as session:
        regenerated = await session.scalar(
            select(UserPreference).where(UserPreference.user_id == trader_profile.user_id)
        )
        assert regenerated is not None
        assert regenerated.minimum_probability_threshold == Decimal("70.00")


async def test_secteurs_desactives_par_defaut_sont_filtres(
    session_factory: async_sessionmaker[AsyncSession],
    trader_profile: TraderProfile,
) -> None:
    for sector in (SECTOR_REAL_ESTATE, SECTOR_FOOD):
        await _insert_signal(session_factory, sector=sector, strength=Decimal("90.00"))

    decision = await evaluate_trading_opportunity(trader_profile.user_id)

    assert decision.should_execute is False
