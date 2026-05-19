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
from app.services.audit_service import ensure_open_alert, log_audit_event
from app.services.broker_mock import MockBrokerGateway
from app.services.engine_control import EngineControl
from app.services.monitoring_hub import MonitoringHub
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
        monitoring_hub: MonitoringHub | None = None,
        engine_control: EngineControl | None = None,
        recovery_delay_seconds: int = 2,
    ) -> None:
        self._news_simulator = news_simulator
        self._session_factory = session_factory
        self._broker_gateway = broker_gateway or MockBrokerGateway()
        self._risk_manager = risk_manager or RiskManager()
        self._monitoring_hub = monitoring_hub
        self._engine_control = engine_control or EngineControl()
        self._recovery_delay_seconds = recovery_delay_seconds
        self._task: asyncio.Task[None] | None = None
        self._pending_resolution_tasks: set[asyncio.Task[None]] = set()
        self._last_pause_event_key: str | None = None
        self._last_error: str | None = None

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
            try:
                signal = await self._news_simulator.next_signal()
                if self._engine_control.is_paused:
                    pause_key = f"paused:{self._engine_control.reason}"
                    if self._monitoring_hub and pause_key != self._last_pause_event_key:
                        self._monitoring_hub.publish_event(
                            channel="engine",
                            event_type="engine_paused",
                            severity="warning",
                            message="Signal ignoré car le moteur est en pause globale.",
                            payload=self._engine_control.snapshot(),
                        )
                    self._last_pause_event_key = pause_key
                    continue
                self._last_pause_event_key = None
                await self._process_signal(signal)
                self._last_error = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._last_error = str(exc)
                if self._monitoring_hub:
                    self._monitoring_hub.publish_event(
                        channel="engine",
                        event_type="engine_loop_error",
                        severity="critical",
                        message="Erreur runtime dans la boucle du moteur.",
                        payload={"error": str(exc)},
                    )
                await asyncio.sleep(self._recovery_delay_seconds)

    @property
    def is_running(self) -> bool:
        """Indique si la boucle principale est active."""

        return bool(self._task and not self._task.done())

    def control_snapshot(self) -> dict:
        """Expose l'état de contrôle global."""

        return self._engine_control.snapshot()

    def health_snapshot(self) -> dict:
        """Expose la santé runtime du moteur."""

        return {
            "running": self.is_running,
            "pending_resolution_tasks": len(self._pending_resolution_tasks),
            "last_error": self._last_error,
            "control": self.control_snapshot(),
        }

    def pause_engine(self, reason: str) -> dict:
        """Met le moteur en pause globale."""

        self._engine_control.pause(reason)
        if self._monitoring_hub:
            self._monitoring_hub.publish_event(
                channel="engine",
                event_type="engine_paused_manual",
                severity="warning",
                message="Moteur mis en pause manuellement.",
                payload=self._engine_control.snapshot(),
            )
        return self._engine_control.snapshot()

    def resume_engine(self) -> dict:
        """Relance le moteur global."""

        self._engine_control.resume()
        if self._monitoring_hub:
            self._monitoring_hub.publish_event(
                channel="engine",
                event_type="engine_resumed_manual",
                severity="info",
                message="Moteur relancé manuellement.",
                payload=self._engine_control.snapshot(),
            )
        return self._engine_control.snapshot()

    async def _process_signal(self, signal: NewsSignal) -> None:
        """Crée des ordres simulés pour les utilisateurs éligibles."""

        confidence_decimal = Decimal(str(signal.confidence)).quantize(Decimal("0.01"))
        pending_order_ids: list[uuid.UUID] = []
        if self._monitoring_hub:
            self._monitoring_hub.publish_event(
                channel="signals",
                event_type="news_signal_received",
                severity="info",
                message=f"Signal {signal.direction} reçu ({signal.confidence}%).",
                payload={
                    "news_id": str(signal.id),
                    "headline": signal.headline,
                    "source": signal.source,
                    "confidence": signal.confidence,
                },
            )

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
                    await log_audit_event(
                        session,
                        source="trading_engine",
                        event_type="order_blocked_by_risk",
                        severity="warning",
                        message="Ordre bloqué par la politique de risque.",
                        user_id=user.id,
                        payload={
                            "reason": risk_decision.reason,
                            "news_id": str(signal.id),
                            "confidence": str(confidence_decimal),
                        },
                        monitoring_hub=self._monitoring_hub,
                    )
                    alert_mapping = self._risk_alert_mapping(risk_decision.reason)
                    if alert_mapping is not None:
                        alert_code, severity = alert_mapping
                        await ensure_open_alert(
                            session,
                            source="risk_manager",
                            alert_code=alert_code,
                            severity=severity,
                            message=risk_decision.reason or "Blocage risque.",
                            user_id=user.id,
                            payload={"news_id": str(signal.id)},
                            monitoring_hub=self._monitoring_hub,
                        )
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
                    await log_audit_event(
                        session,
                        source="trading_engine",
                        event_type="order_filled_instant",
                        severity="info",
                        message="Ordre exécuté instantanément.",
                        user_id=user.id,
                        payload={
                            "order_id": str(order_id),
                            "broker_order_id": order.broker_order_id,
                            "asset_symbol": order.asset_symbol,
                            "pnl_simule": str(order.pnl_simule),
                            "status": order.status,
                        },
                        monitoring_hub=self._monitoring_hub,
                    )
                    if not profile.is_trading_active and profile.risk_block_reason:
                        alert_mapping = self._risk_alert_mapping(profile.risk_block_reason)
                        if alert_mapping is not None:
                            alert_code, severity = alert_mapping
                            await ensure_open_alert(
                                session,
                                source="risk_manager",
                                alert_code=alert_code,
                                severity=severity,
                                message=profile.risk_block_reason,
                                user_id=user.id,
                                payload={"order_id": str(order_id)},
                                monitoring_hub=self._monitoring_hub,
                            )
                elif submission.status == "pending":
                    pending_order_ids.append(order_id)
                    await log_audit_event(
                        session,
                        source="trading_engine",
                        event_type="order_pending",
                        severity="info",
                        message="Ordre soumis au broker et en attente d'exécution.",
                        user_id=user.id,
                        payload={
                            "order_id": str(order_id),
                            "broker_order_id": order.broker_order_id,
                            "asset_symbol": order.asset_symbol,
                            "status": order.status,
                        },
                        monitoring_hub=self._monitoring_hub,
                    )
                else:
                    await ensure_open_alert(
                        session,
                        source="broker_gateway",
                        alert_code="BROKER_REJECTED_ORDER",
                        severity="medium",
                        message="Le broker a rejeté un ordre.",
                        user_id=user.id,
                        payload={
                            "order_id": str(order_id),
                            "broker_order_id": order.broker_order_id,
                            "reason": submission.rejection_reason,
                        },
                        monitoring_hub=self._monitoring_hub,
                    )
                    await log_audit_event(
                        session,
                        source="trading_engine",
                        event_type="order_rejected",
                        severity="warning",
                        message="Ordre rejeté à la soumission broker.",
                        user_id=user.id,
                        payload={
                            "order_id": str(order_id),
                            "broker_order_id": order.broker_order_id,
                            "reason": submission.rejection_reason,
                        },
                        monitoring_hub=self._monitoring_hub,
                    )

                await log_audit_event(
                    session,
                    source="trading_engine",
                    event_type="order_submitted",
                    severity="info",
                    message="Ordre soumis au broker mock.",
                    user_id=user.id,
                    payload={
                        "order_id": str(order_id),
                        "news_id": str(signal.id),
                        "direction": signal.direction,
                        "confidence": str(confidence_decimal),
                        "status": submission.status,
                        "asset_symbol": submission.asset_symbol,
                        "requested_price": str(submission.requested_price),
                    },
                    monitoring_hub=self._monitoring_hub,
                )

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
        task.add_done_callback(self._handle_pending_task_done)

    def _handle_pending_task_done(self, task: asyncio.Task[None]) -> None:
        """Nettoie les tâches pending et remonte les erreurs éventuelles."""

        self._pending_resolution_tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error is None:
            return
        self._last_error = str(error)
        if self._monitoring_hub:
            self._monitoring_hub.publish_event(
                channel="engine",
                event_type="pending_resolution_error",
                severity="error",
                message="Erreur pendant la résolution d'un ordre pending.",
                payload={"error": str(error)},
            )

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
                await log_audit_event(
                    session,
                    source="trading_engine",
                    event_type="order_filled_from_pending",
                    severity="info",
                    message="Ordre pending finalisé en filled.",
                    user_id=order.user_id,
                    payload={
                        "order_id": str(order.id),
                        "broker_order_id": order.broker_order_id,
                        "pnl_simule": str(order.pnl_simule),
                    },
                    monitoring_hub=self._monitoring_hub,
                )
            else:
                order.pnl_simule = Decimal("0.00")
                await ensure_open_alert(
                    session,
                    source="broker_gateway",
                    alert_code="BROKER_PENDING_REJECTED",
                    severity="medium",
                    message="Ordre pending rejeté par le broker mock.",
                    user_id=order.user_id,
                    payload={
                        "order_id": str(order.id),
                        "broker_order_id": order.broker_order_id,
                        "reason": order.rejection_reason,
                    },
                    monitoring_hub=self._monitoring_hub,
                )
                await log_audit_event(
                    session,
                    source="trading_engine",
                    event_type="order_rejected_from_pending",
                    severity="warning",
                    message="Ordre pending rejeté lors de la finalisation.",
                    user_id=order.user_id,
                    payload={
                        "order_id": str(order.id),
                        "reason": order.rejection_reason,
                    },
                    monitoring_hub=self._monitoring_hub,
                )

            if not profile.is_trading_active and profile.risk_block_reason:
                alert_mapping = self._risk_alert_mapping(profile.risk_block_reason)
                if alert_mapping is not None:
                    alert_code, severity = alert_mapping
                    await ensure_open_alert(
                        session,
                        source="risk_manager",
                        alert_code=alert_code,
                        severity=severity,
                        message=profile.risk_block_reason,
                        user_id=order.user_id,
                        payload={"order_id": str(order.id)},
                        monitoring_hub=self._monitoring_hub,
                    )

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

    @staticmethod
    def _risk_alert_mapping(reason: str | None) -> tuple[str, str] | None:
        """Mappe une raison de blocage risque vers un code/gravité d'alerte."""

        if not reason:
            return None
        lowered = reason.lower()
        if "drawdown" in lowered:
            return ("RISK_MAX_DRAWDOWN", "high")
        if "capital engagé épuisé" in lowered:
            return ("RISK_CAPITAL_DEPLETED", "high")
        if "limite d'ordres" in lowered:
            return ("RISK_DAILY_ORDER_LIMIT", "medium")
        if "kill switch" in lowered:
            return ("RISK_KILL_SWITCH_ACTIVE", "low")
        return None
