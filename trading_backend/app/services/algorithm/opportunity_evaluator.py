"""Croisement préférences utilisateur / derniers signaux pour déclencher un ordre."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import desc, select

from app.db.database import AsyncSessionLocal
from app.models.active_trade import ActiveTrade
from app.models.market_signal import MarketSignal
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet
from app.services.algorithm.constants import MIN_PIPELINE_VALID_PROBABILITY, MIN_RECOMMENDED_CAPITAL
from app.services.algorithm.preference_matching import (
    default_preferences_for_user,
    is_asset_class_enabled,
    is_sector_enabled,
)
from app.services.algorithm.scoring import quantize_money, quantize_probability, resolve_asset_class
from app.services.algorithm.types import TradingOpportunityResult


async def evaluate_trading_opportunity(user_id: uuid.UUID) -> TradingOpportunityResult:
    """Évalue si un ordre doit être déclenché pour ``user_id``.

    Étapes :
    1. Charger utilisateur actif, portefeuille et préférences (ou créer des défauts).
    2. Récupérer les signaux valides non expirés, triés par force décroissante.
    3. Filtrer par seuil utilisateur (ex. 75 % > 72 % ignoré), secteurs et classes d'actifs.
    4. Si alignement : ouvrir ``active_trades`` avec durée théorique = TTL du signal.

    Le seuil utilisateur ne peut pas être abaissé en dessous du minimum pipeline (70 %).
    """

    now = datetime.now(UTC)
    async with AsyncSessionLocal() as session:
        user = await session.get(User, user_id)
        if user is None or not user.is_active:
            return TradingOpportunityResult(
                should_execute=False,
                reason="Utilisateur introuvable ou inactif.",
                user_id=user_id,
            )

        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == user_id))
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

        preference = await session.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
        if preference is None:
            preference = default_preferences_for_user(user_id)
            session.add(preference)
            await session.flush()

        threshold = quantize_probability(
            max(preference.minimum_probability_threshold, MIN_PIPELINE_VALID_PROBABILITY)
        )

        recent_signals = (
            (
                await session.execute(
                    select(MarketSignal)
                    .where(
                        MarketSignal.is_valid_signal.is_(True),
                        MarketSignal.expires_at > now,
                    )
                    .order_by(desc(MarketSignal.signal_strength), desc(MarketSignal.created_at))
                    .limit(50)
                )
            )
            .scalars()
            .all()
        )

        if not recent_signals:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Aucun signal valide récent.",
                user_id=user_id,
            )

        eligible: list[MarketSignal] = []
        for signal in recent_signals:
            asset_class = resolve_asset_class(signal.category)
            if not is_asset_class_enabled(preference, asset_class):
                continue
            if not is_sector_enabled(preference, signal.mapped_sector):
                continue
            if signal.signal_strength < threshold:
                continue
            eligible.append(signal)

        if not eligible:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Signaux non alignés avec les préférences utilisateur.",
                user_id=user_id,
            )

        selected = eligible[0]
        selected_id = selected.id

        existing_trade = await session.scalar(
            select(ActiveTrade).where(
                ActiveTrade.user_id == user_id,
                ActiveTrade.market_signal_id == selected_id,
                ActiveTrade.status == "open",
            )
        )
        if existing_trade is not None:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Signal déjà exploité par une position ouverte.",
                user_id=user_id,
                market_signal_id=selected_id,
            )

        raw_capital = min(
            wallet.solde_disponible,
            max(MIN_RECOMMENDED_CAPITAL, wallet.solde_disponible * Decimal("0.20")),
        )
        recommended_capital = quantize_money(raw_capital)
        if recommended_capital <= Decimal("0.00"):
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Capital recommandé insuffisant.",
                user_id=user_id,
                market_signal_id=selected_id,
            )

        direction = "buy" if selected.sentiment_polarity != "negative" else "sell"
        estimated_duration = max(30, selected.time_to_live_minutes)
        planned_close = now + timedelta(minutes=estimated_duration)
        asset_class = resolve_asset_class(selected.category)

        active_trade = ActiveTrade(
            user_id=user_id,
            market_signal_id=selected_id,
            asset_class=asset_class,
            sector=selected.mapped_sector,
            direction=direction,
            probability_used=selected.signal_strength,
            capital_engaged=recommended_capital,
            status="open",
            estimated_duration_minutes=estimated_duration,
            planned_close_at=planned_close,
        )
        session.add(active_trade)
        await session.commit()
        await session.refresh(active_trade)
        trade_id = active_trade.id

    return TradingOpportunityResult(
        should_execute=True,
        reason="Opportunité validée: alignement signal + préférences.",
        user_id=user_id,
        market_signal_id=selected_id,
        direction=direction,
        asset_class=asset_class,
        sector=selected.mapped_sector,
        probability_used=selected.signal_strength,
        recommended_capital=recommended_capital,
        estimated_duration_minutes=estimated_duration,
        planned_close_at=planned_close,
        active_trade_id=trade_id,
    )
