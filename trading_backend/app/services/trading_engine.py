"""Moteur d'automatisation: seuil utilisateur -> ordre simulé."""

from __future__ import annotations

import asyncio
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.orm import selectinload

from app.models.simulated_order import SimulatedOrder
from app.models.user import User
from app.services.news_simulator import NewsSignal, NewsSimulator

DEFAULT_SEUIL = Decimal("80.00")
MIN_TRADE_AMOUNT = Decimal("10.00")
ORDER_FRACTION = Decimal("0.10")


class TradingEngine:
    """Consomme le flux de news et déclenche des ordres simulés."""

    def __init__(
        self,
        news_simulator: NewsSimulator,
        session_factory: async_sessionmaker,
    ) -> None:
        self._news_simulator = news_simulator
        self._session_factory = session_factory
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Démarre la boucle d'exécution des ordres."""

        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run_loop(), name="trading-engine-loop")

    async def stop(self) -> None:
        """Arrête la boucle de trading."""

        if not self._task:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass

    async def _run_loop(self) -> None:
        """Traite chaque news entrante."""

        while True:
            signal = await self._news_simulator.next_signal()
            await self._process_signal(signal)

    async def _process_signal(self, signal: NewsSignal) -> None:
        """Crée des ordres simulés pour les utilisateurs éligibles."""

        confidence_decimal = Decimal(str(signal.confidence)).quantize(Decimal("0.01"))

        async with self._session_factory() as session:
            users = (
                await session.execute(
                    select(User).options(
                        selectinload(User.wallet),
                        selectinload(User.trading_profile),
                    )
                )
            ).scalars().all()

            for user in users:
                if user.wallet is None or user.wallet.solde_engage <= 0:
                    continue

                seuil = (
                    user.trading_profile.seuil_probabilite_min
                    if user.trading_profile is not None
                    else DEFAULT_SEUIL
                )
                if confidence_decimal < seuil:
                    continue

                montant = (user.wallet.solde_engage * ORDER_FRACTION).quantize(
                    Decimal("0.01"),
                    rounding=ROUND_HALF_UP,
                )
                if montant < MIN_TRADE_AMOUNT:
                    montant = user.wallet.solde_engage.quantize(
                        Decimal("0.01"),
                        rounding=ROUND_HALF_UP,
                    )
                if montant <= 0:
                    continue

                session.add(
                    SimulatedOrder(
                        user_id=user.id,
                        headline=signal.headline,
                        direction=signal.direction,
                        confidence=confidence_decimal,
                        seuil_utilise=seuil,
                        montant_ordre=montant,
                        status="executed",
                    )
                )

            await session.commit()
