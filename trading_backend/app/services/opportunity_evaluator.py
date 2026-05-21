"""Moteur de décision : croisement signaux marché / préférences utilisateur."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import AsyncSessionLocal
from app.domain.decision import (
    ASSET_CRYPTO,
    ASSET_ETF,
    ASSET_STOCK,
    MIN_SIGNAL_PROBABILITY,
    SECTOR_FOOD,
    SECTOR_INSURANCE,
    SECTOR_MINES,
    SECTOR_REAL_ESTATE,
    SECTOR_TECH,
    TradingOpportunityResult,
)
from app.models.active_trade import ActiveTrade
from app.models.market_signal import MarketSignal
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet
from app.services.news_analyzer import quantize_probability, resolve_asset_class

MIN_RECOMMENDED_CAPITAL = Decimal("50.00")


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def is_sector_enabled(preference: UserPreference, sector: str) -> bool:
    sector_flags = {
        SECTOR_TECH: preference.sector_tech,
        SECTOR_MINES: preference.sector_mines,
        SECTOR_REAL_ESTATE: preference.sector_real_estate,
        SECTOR_INSURANCE: preference.sector_insurance,
        SECTOR_FOOD: preference.sector_food,
    }
    return sector_flags.get(sector, True)


def is_asset_class_enabled(preference: UserPreference, asset_class: str) -> bool:
    if asset_class == ASSET_CRYPTO:
        return preference.enable_crypto
    if asset_class == ASSET_ETF:
        return preference.enable_etf
    return preference.enable_stocks


def default_preferences(user_id: uuid.UUID) -> UserPreference:
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


def filter_eligible_signals(
    signals: list[MarketSignal],
    preference: UserPreference,
    threshold: Decimal,
) -> list[MarketSignal]:
    eligible: list[MarketSignal] = []
    for signal in signals:
        asset_class = resolve_asset_class(signal.category)
        if not is_asset_class_enabled(preference, asset_class):
            continue
        if not is_sector_enabled(preference, signal.mapped_sector):
            continue
        if signal.signal_strength < threshold:
            continue
        eligible.append(signal)
    return eligible


async def evaluate_trading_opportunity(
    user_id: uuid.UUID,
    *,
    session: AsyncSession | None = None,
) -> TradingOpportunityResult:
    now = datetime.now(UTC)

    async def _evaluate(db: AsyncSession) -> TradingOpportunityResult:
        user = await db.get(User, user_id)
        if user is None or not user.is_active:
            return TradingOpportunityResult(
                should_execute=False,
                reason="Utilisateur introuvable ou inactif.",
                user_id=user_id,
            )

        wallet = await db.scalar(select(Wallet).where(Wallet.user_id == user_id))
        if wallet is None:
            return TradingOpportunityResult(
                should_execute=False,
                reason="Wallet introuvable.",
                user_id=user_id,
            )
        if wallet.solde_disponible <= Decimal("0.00"):
            return TradingOpportunityResult(
                should_execute=False,
                reason="Aucun capital disponible pour un nouveau trade.",
                user_id=user_id,
            )

        preference = await db.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
        if preference is None:
            preference = default_preferences(user_id)
            db.add(preference)
            await db.flush()

        threshold = quantize_probability(max(preference.minimum_probability_threshold, MIN_SIGNAL_PROBABILITY))

        recent_signals = (
            await db.execute(
                select(MarketSignal)
                .where(
                    MarketSignal.is_valid_signal.is_(True),
                    MarketSignal.expires_at > now,
                )
                .order_by(desc(MarketSignal.signal_strength), desc(MarketSignal.created_at))
                .limit(50)
            )
        ).scalars().all()

        if not recent_signals:
            return TradingOpportunityResult(
                should_execute=False,
                reason="Aucun signal valide récent.",
                user_id=user_id,
            )

        eligible_signals = filter_eligible_signals(recent_signals, preference, threshold)
        if not eligible_signals:
            return TradingOpportunityResult(
                should_execute=False,
                reason="Signaux non alignés avec les préférences utilisateur.",
                user_id=user_id,
            )

        selected_signal = eligible_signals[0]
        existing_trade = await db.scalar(
            select(ActiveTrade).where(
                ActiveTrade.user_id == user_id,
                ActiveTrade.market_signal_id == selected_signal.id,
                ActiveTrade.status == "open",
            )
        )
        if existing_trade is not None:
            return TradingOpportunityResult(
                should_execute=False,
                reason="Signal déjà exploité par une position ouverte.",
                user_id=user_id,
                market_signal_id=selected_signal.id,
            )

        recommended_capital = quantize_money(
            min(
                wallet.solde_disponible,
                max(MIN_RECOMMENDED_CAPITAL, wallet.solde_disponible * Decimal("0.20")),
            )
        )
        if recommended_capital <= Decimal("0.00"):
            return TradingOpportunityResult(
                should_execute=False,
                reason="Capital recommandé insuffisant.",
                user_id=user_id,
                market_signal_id=selected_signal.id,
            )

        direction = "buy" if selected_signal.sentiment_polarity != "negative" else "sell"
        estimated_duration = max(30, selected_signal.time_to_live_minutes)
        planned_close = now + timedelta(minutes=estimated_duration)

        active_trade = ActiveTrade(
            user_id=user_id,
            market_signal_id=selected_signal.id,
            asset_class=resolve_asset_class(selected_signal.category),
            sector=selected_signal.mapped_sector,
            direction=direction,
            probability_used=selected_signal.signal_strength,
            capital_engaged=recommended_capital,
            status="open",
            estimated_duration_minutes=estimated_duration,
            planned_close_at=planned_close,
        )
        db.add(active_trade)
        await db.flush()
        await db.refresh(active_trade)

        return TradingOpportunityResult(
            should_execute=True,
            reason="Opportunité validée: alignement signal + préférences.",
            user_id=user_id,
            market_signal_id=selected_signal.id,
            direction=direction,
            asset_class=active_trade.asset_class,
            sector=selected_signal.mapped_sector,
            probability_used=selected_signal.signal_strength,
            recommended_capital=recommended_capital,
            estimated_duration_minutes=estimated_duration,
            planned_close_at=planned_close,
            active_trade_id=active_trade.id,
        )

    if session is not None:
        return await _evaluate(session)

    async with AsyncSessionLocal() as owned_session:
        result = await _evaluate(owned_session)
        await owned_session.commit()
        return result
