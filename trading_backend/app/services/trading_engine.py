"""Moteur d'automatisation: seuil utilisateur -> ordre simulé."""

from __future__ import annotations

import asyncio
import uuid
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.orm import selectinload

from app.models.simulated_order import SimulatedOrder
from app.models.trading_profile import TradingProfile
from app.models.user import User
from app.models.wallet import Wallet
from app.services.broker_mock import MockBrokerGateway
from app.services.news_simulator import NewsSignal, NewsSimulator
from app.services.risk_manager import RiskManager

DEFAULT_SEUIL = Decimal("80.00")
MIN_TRADE_AMOUNT = Decimal("10.00")
ORDER_FRACTION = Decimal("0.10")


class TradingEngine:
    """Consomme le flux de news et déclenche des ordres simulés."""

    def __init__(
        self,
        news_simulator: NewsSimulator,
        session_factory: async_sessionmaker,
        broker_gateway: MockBrokerGateway | None = None,
        risk_manager: RiskManager | None = None,
    ) -> None:
        self._news_simulator = news_simulator
        self._session_factory = session_factory
        self._broker_gateway = broker_gateway or MockBrokerGateway()
        self._risk_manager = risk_manager or RiskManager()
        self._task: asyncio.Task[None] | None = None
        self._pending_resolution_tasks: set[asyncio.Task[None]] = set()

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

        for pending_task in list(self._pending_resolution_tasks):
            pending_task.cancel()
        if self._pending_resolution_tasks:
            await asyncio.gather(*self._pending_resolution_tasks, return_exceptions=True)
        self._pending_resolution_tasks.clear()

    async def _run_loop(self) -> None:
        """Traite chaque news entrante."""

        while True:
            signal = await self._news_simulator.next_signal()
            await self._process_signal(signal)

    async def _process_signal(self, signal: NewsSignal) -> None:
        """Crée des ordres simulés pour les utilisateurs éligibles."""

        confidence_decimal = Decimal(str(signal.confidence)).quantize(Decimal("0.01"))
        pending_order_ids: list[uuid.UUID] = []

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

                profile = user.trading_profile
                if profile is None:
                    profile = self._build_default_profile(user.id, user.wallet)
                    session.add(profile)

                seuil = (
                    profile.seuil_probabilite_min
                    if profile is not None
                    else DEFAULT_SEUIL
                )
                if confidence_decimal < seuil:
                    continue

                risk_decision = self._risk_manager.evaluate_new_order(profile, user.wallet)
                if not risk_decision.allowed:
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

                submission = await self._broker_gateway.submit_order(
                    direction=signal.direction,
                    confidence=confidence_decimal,
                )
                self._risk_manager.register_order_submission(profile)

                order_id = uuid.uuid4()
                order = SimulatedOrder(
                    id=order_id,
                    user_id=user.id,
                    broker=submission.broker,
                    broker_order_id=submission.broker_order_id,
                    asset_symbol=submission.asset_symbol,
                    headline=signal.headline,
                    direction=signal.direction,
                    confidence=confidence_decimal,
                    seuil_utilise=seuil,
                    montant_ordre=montant,
                    requested_price=submission.requested_price,
                    status=submission.status,
                    rejection_reason=submission.rejection_reason,
                )

                if submission.status == "filled":
                    final_result = self._broker_gateway.finalize_instant_fill(
                        direction=signal.direction,
                        requested_price=submission.requested_price,
                        montant_ordre=montant,
                    )
                    order.filled_price = final_result.filled_price
                    order.pnl_simule = self._risk_manager.apply_fill_result(
                        profile=profile,
                        wallet=user.wallet,
                        montant_ordre=montant,
                        pnl_simule=final_result.pnl_simule,
                    )
                    order.status = final_result.status
                elif submission.status == "pending":
                    pending_order_ids.append(order_id)

                session.add(order)

            await session.commit()

        for order_id in pending_order_ids:
            self._schedule_pending_resolution(order_id)

    def _schedule_pending_resolution(self, order_id: uuid.UUID) -> None:
        """Planifie la résolution asynchrone d'un ordre pending."""

        task = asyncio.create_task(
            self._resolve_pending_order(order_id),
            name=f"resolve-order-{order_id}",
        )
        self._pending_resolution_tasks.add(task)
        task.add_done_callback(self._pending_resolution_tasks.discard)

    async def _resolve_pending_order(self, order_id: uuid.UUID) -> None:
        """Passe un ordre pending vers filled/rejected avec PnL simulé."""

        async with self._session_factory() as session:
            order = await session.get(SimulatedOrder, order_id)
            if order is None or order.status != "pending":
                return
            direction = order.direction
            requested_price = order.requested_price
            montant_ordre = order.montant_ordre

        result = await self._broker_gateway.finalize_pending_order(
            direction=direction,
            requested_price=requested_price,
            montant_ordre=montant_ordre,
        )

        async with self._session_factory() as session:
            order = await session.get(SimulatedOrder, order_id)
            if order is None or order.status != "pending":
                return

            wallet = await session.scalar(select(Wallet).where(Wallet.user_id == order.user_id))
            profile = await session.scalar(select(TradingProfile).where(TradingProfile.user_id == order.user_id))
            if wallet is None:
                return
            if profile is None:
                profile = self._build_default_profile(order.user_id, wallet)
                session.add(profile)

            order.status = result.status
            order.filled_price = result.filled_price
            order.rejection_reason = result.rejection_reason
            if result.status == "filled":
                order.pnl_simule = self._risk_manager.apply_fill_result(
                    profile=profile,
                    wallet=wallet,
                    montant_ordre=order.montant_ordre,
                    pnl_simule=result.pnl_simule,
                )
            else:
                order.pnl_simule = Decimal("0.00")

            session.add_all([order, wallet, profile])
            await session.commit()

    @staticmethod
    def _build_default_profile(user_id: uuid.UUID, wallet: Wallet) -> TradingProfile:
        """Crée un profil de trading par défaut si absent."""

        baseline_equity = wallet.solde_engage.quantize(Decimal("0.01")) if wallet.solde_engage > 0 else Decimal("0.00")
        return TradingProfile(
            user_id=user_id,
            seuil_probabilite_min=DEFAULT_SEUIL,
            is_trading_active=True,
            max_orders_per_day=20,
            stop_loss_pct=Decimal("2.50"),
            max_drawdown_pct=Decimal("12.00"),
            last_risk_reset_date=date.today(),
            orders_today=0,
            cumulative_pnl_today=Decimal("0.00"),
            equity_peak=baseline_equity,
            equity_current=baseline_equity,
        )
