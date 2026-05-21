"""Service de cycle de vie des positions actives (ActiveTrade).

Responsabilités :
  - Détection automatique des trades arrivés à expiration (TTL atteint).
  - Fermeture de la position avec calcul de PnL simulé.
  - Restitution du capital engagé + PnL dans le wallet utilisateur.
  - Emission d'une notification WebSocket : "Cycle terminé. Profit : +X%."
  - Boucle de surveillance configurable (défaut : toutes les 30 secondes).

La simulation PnL utilise la probabilité du signal et la direction du trade
pour produire un gain/perte plausible sans appel à un vrai broker.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.active_trade import ActiveTrade
from app.models.wallet import Wallet
from app.services.monitoring_hub import MonitoringHub

logger = logging.getLogger(__name__)

# Borne de PnL simulé : entre -MAX_LOSS_PCT et +MAX_GAIN_PCT du capital
_MAX_GAIN_PCT = Decimal("0.18")    # +18 % maximum
_MAX_LOSS_PCT = Decimal("0.08")    # -8 % maximum (risque asymétrique)

_POLL_INTERVAL_DEFAULT = 30        # secondes entre deux passages de contrôle


def _simulate_pnl(trade: ActiveTrade) -> Decimal:
    """Calcule un PnL simulé déterministe pour un trade expiré.

    Formule :
        expected_return = (probability_used − 50) / 50 × MAX_GAIN
        noise           = hash(trade_id) en [-2%, +2%]
        pnl_pct         = clamp(expected_return × direction_sign + noise,
                                -MAX_LOSS_PCT, MAX_GAIN_PCT)
        pnl             = capital_engaged × pnl_pct

    Un trade BUY bénéficie d'un signal haussier (polarity positive).
    Un trade SELL bénéficie d'un signal baissier (polarity négative).
    """
    # Base : performance attendue relative à la force du signal (50 % = neutre)
    edge = (trade.probability_used - Decimal("50.00")) / Decimal("50.00")
    expected_return = edge * _MAX_GAIN_PCT

    # Bruit déterministe ±2 % dérivé de l'UUID du trade
    digest = hashlib.sha256(str(trade.id).encode()).hexdigest()
    seed = int(digest[:8], 16)
    noise_pct = Decimal((seed % 401) - 200) / Decimal("10000")  # [-2%, +2%]

    raw_pnl_pct = expected_return + noise_pct

    # Direction : sell inverse le signe si le signal est baissier
    if trade.direction == "sell":
        raw_pnl_pct = -raw_pnl_pct

    clamped = max(-_MAX_LOSS_PCT, min(raw_pnl_pct, _MAX_GAIN_PCT))
    pnl = (trade.capital_engaged * clamped).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    return pnl


def _format_cycle_notification(trade: ActiveTrade, pnl: Decimal) -> str:
    """Génère le message de fin de cycle envoyé via WebSocket."""
    sign = "+" if pnl >= Decimal("0") else ""
    pnl_pct = (
        (pnl / trade.capital_engaged * Decimal("100"))
        .quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if trade.capital_engaged > Decimal("0")
        else Decimal("0")
    )
    return (
        f"Cycle terminé. Profit : {sign}{pnl_pct}% ({sign}{pnl} €). "
        f"Souhaitez-vous relancer le capital sur une nouvelle opportunité ?"
    )


class TradeLifecycleService:
    """Surveille et clôture automatiquement les positions expirées.

    Usage (dans le lifespan FastAPI) :
        service = TradeLifecycleService(session_factory, monitoring_hub)
        await service.start()
        …
        await service.stop()
    """

    def __init__(
        self,
        session_factory: async_sessionmaker,
        monitoring_hub: MonitoringHub | None = None,
        poll_interval_seconds: int = _POLL_INTERVAL_DEFAULT,
    ) -> None:
        self._session_factory = session_factory
        self._hub = monitoring_hub
        self._poll_interval = poll_interval_seconds
        self._task: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------
    # Cycle de vie du service (start / stop)
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Démarre la boucle de surveillance en arrière-plan."""
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(
            self._run_loop(), name="trade-lifecycle-loop"
        )
        logger.info("TradeLifecycleService démarré (intervalle=%ds).", self._poll_interval)

    async def stop(self) -> None:
        """Arrête proprement la boucle de surveillance."""
        if not self._task:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        logger.info("TradeLifecycleService arrêté.")

    @property
    def is_running(self) -> bool:
        return bool(self._task and not self._task.done())

    def health_snapshot(self) -> dict:
        return {"running": self.is_running, "poll_interval_seconds": self._poll_interval}

    # ------------------------------------------------------------------
    # Boucle principale
    # ------------------------------------------------------------------

    async def _run_loop(self) -> None:
        while True:
            try:
                closed_count = await self._close_expired_trades()
                if closed_count:
                    logger.info(
                        "TradeLifecycleService : %d trade(s) clôturé(s) automatiquement.",
                        closed_count,
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Erreur dans la boucle TradeLifecycleService.")
            await asyncio.sleep(self._poll_interval)

    # ------------------------------------------------------------------
    # Logique de fermeture
    # ------------------------------------------------------------------

    async def _close_expired_trades(self) -> int:
        """Identifie et clôture tous les trades dont le TTL est dépassé.

        Returns:
            Nombre de trades effectivement clôturés.
        """
        now = datetime.now(UTC)
        closed = 0

        async with self._session_factory() as session:
            expired_trades = (
                await session.execute(
                    select(ActiveTrade).where(
                        ActiveTrade.status == "open",
                        ActiveTrade.planned_close_at <= now,
                    )
                )
            ).scalars().all()

            for trade in expired_trades:
                try:
                    await self._close_single_trade(
                        session=session,
                        trade=trade,
                        reason="TTL expiré — clôture automatique par le moteur IA.",
                        now=now,
                    )
                    closed += 1
                except Exception:
                    logger.exception(
                        "Impossible de clôturer le trade %s.", trade.id
                    )
            if closed:
                await session.commit()

        return closed

    async def _close_single_trade(
        self,
        session: AsyncSession,
        trade: ActiveTrade,
        reason: str,
        now: datetime,
    ) -> None:
        """Clôture un trade individuel et met à jour le wallet."""
        pnl = _simulate_pnl(trade)

        trade.status = "closed"
        trade.closed_at = now
        trade.close_reason = reason
        trade.pnl_realise = pnl
        session.add(trade)

        # Restitution capital + PnL dans le wallet
        wallet = await session.scalar(
            select(Wallet).where(Wallet.user_id == trade.user_id).with_for_update()
        )
        if wallet is not None:
            refund = (trade.capital_engaged + pnl).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            # Réduction du capital engagé
            wallet.solde_engage = max(
                Decimal("0.00"),
                wallet.solde_engage - trade.capital_engaged,
            ).quantize(Decimal("0.01"))
            # Crédit du disponible (capital + gain/perte)
            wallet.solde_disponible = (wallet.solde_disponible + refund).quantize(
                Decimal("0.01")
            )
            # Mise à jour du total
            wallet.solde_total = (
                wallet.solde_disponible + wallet.solde_engage
            ).quantize(Decimal("0.01"))
            session.add(wallet)

        # Notification WebSocket via le MonitoringHub
        if self._hub is not None:
            notification = _format_cycle_notification(trade, pnl)
            self._hub.publish_event(
                channel="trade_lifecycle",
                event_type="trade_cycle_complete",
                severity="info",
                message=notification,
                payload={
                    "trade_id": str(trade.id),
                    "user_id": str(trade.user_id),
                    "asset_class": trade.asset_class,
                    "sector": trade.sector,
                    "direction": trade.direction,
                    "capital_engaged": str(trade.capital_engaged),
                    "pnl_realise": str(pnl),
                    "close_reason": reason,
                    "closed_at": now.isoformat(),
                },
            )

        logger.info(
            "Trade %s clôturé (user=%s, pnl=%s€, raison='%s').",
            trade.id,
            trade.user_id,
            pnl,
            reason,
        )

    # ------------------------------------------------------------------
    # API de clôture manuelle (appelée depuis les routes API)
    # ------------------------------------------------------------------

    async def close_trade_manually(
        self,
        trade_id: str,
        user_id: str,
        reason: str = "Clôture manuelle demandée par l'utilisateur.",
    ) -> dict | None:
        """Clôture un trade ouvert à la demande de l'utilisateur.

        Returns:
            Dictionnaire de synthèse si le trade existait, None sinon.
        """
        import uuid as _uuid

        try:
            tid = _uuid.UUID(trade_id)
            uid = _uuid.UUID(user_id)
        except ValueError:
            return None

        now = datetime.now(UTC)
        async with self._session_factory() as session:
            trade = await session.scalar(
                select(ActiveTrade).where(
                    ActiveTrade.id == tid,
                    ActiveTrade.user_id == uid,
                    ActiveTrade.status == "open",
                )
            )
            if trade is None:
                return None

            await self._close_single_trade(
                session=session, trade=trade, reason=reason, now=now
            )
            await session.commit()
            await session.refresh(trade)

        return {
            "trade_id": str(trade.id),
            "status": trade.status,
            "closed_at": trade.closed_at.isoformat() if trade.closed_at else None,
            "pnl_realise": str(trade.pnl_realise),
            "close_reason": trade.close_reason,
        }
