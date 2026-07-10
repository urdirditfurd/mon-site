"""Suivi des positions papier + signaux de vente automatiques."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import UserPosition
from app.schemas.market import PositionResponse
from app.services.analyzer import analyze_snapshot
from app.services.market_data import fetch_market_snapshot, fetch_price_only
from app.services.execution_engine import ExecutionEngine
from app.services.notifier import NotificationService
from app.services.universe import TrackedAsset, get_universe

logger = logging.getLogger(__name__)


class PositionMonitor:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._notifier = NotificationService(session)

    async def open_position(
        self,
        symbol: str,
        user_alias: str = "default",
        quantity: float = 1.0,
        take_profit_pct: float | None = None,
        stop_loss_pct: float | None = None,
        entry_probability: float = 0.0,
    ) -> UserPosition | None:
        asset = next((a for a in get_universe() if a.symbol == symbol), None)
        if not asset:
            return None

        price = await fetch_price_only(symbol, asset.asset_type)
        if not price or price <= 0:
            return None

        position = UserPosition(
            user_alias=user_alias,
            symbol=symbol,
            asset_type=asset.asset_type,
            entry_price=price,
            quantity=quantity,
            take_profit_pct=take_profit_pct or settings.default_take_profit_pct,
            stop_loss_pct=stop_loss_pct or settings.default_stop_loss_pct,
            entry_probability=entry_probability,
            status="open",
        )
        self._session.add(position)
        await self._session.commit()
        await self._session.refresh(position)

        await self._notifier.create(
            title=f"Position ouverte — {asset.name}",
            body=(
                f"Vous suivez {symbol} à {price:.2f}. "
                f"Objectif gain : +{position.take_profit_pct:.0f}% | Stop : -{position.stop_loss_pct:.0f}%. "
                "Nous vous alerterons quand il sera temps de vendre."
            ),
            user_alias=user_alias,
            symbol=symbol,
            severity="success",
        )
        return position

    async def list_open(self, user_alias: str = "default") -> list[PositionResponse]:
        stmt = select(UserPosition).where(
            UserPosition.user_alias == user_alias,
            UserPosition.status == "open",
        )
        result = await self._session.execute(stmt)
        positions = list(result.scalars().all())
        responses: list[PositionResponse] = []
        for pos in positions:
            current = await fetch_price_only(pos.symbol, pos.asset_type)  # type: ignore[arg-type]
            pnl = None
            if current:
                pnl = round((current - pos.entry_price) / pos.entry_price * 100, 2)
            responses.append(
                PositionResponse(
                    id=pos.id,
                    symbol=pos.symbol,
                    asset_type=pos.asset_type,
                    entry_price=pos.entry_price,
                    current_price=current,
                    pnl_pct=pnl,
                    status=pos.status,
                    take_profit_pct=pos.take_profit_pct,
                    stop_loss_pct=pos.stop_loss_pct,
                    opened_at=pos.opened_at,
                )
            )
        return responses

    async def check_all_open_positions(self) -> int:
        stmt = select(UserPosition).where(UserPosition.status == "open")
        result = await self._session.execute(stmt)
        positions = list(result.scalars().all())
        closed = 0

        universe = {a.symbol: a for a in get_universe()}
        for pos in positions:
            asset = universe.get(pos.symbol)
            if not asset:
                continue
            snapshot = await fetch_market_snapshot(asset)
            if not snapshot:
                continue
            analysis = analyze_snapshot(snapshot)
            current = snapshot.price
            pnl_pct = (current - pos.entry_price) / pos.entry_price * 100

            exit_reason: str | None = None
            if pnl_pct >= pos.take_profit_pct:
                exit_reason = "take_profit"
            elif pnl_pct <= -pos.stop_loss_pct:
                exit_reason = "stop_loss"
            elif analysis.sell_probability >= 65 or analysis.signal == "VENDRE":
                exit_reason = "signal_vendre"
            elif analysis.buy_probability < settings.min_sell_probability_drop:
                exit_reason = "probabilite_baisse"

            if exit_reason:
                await self._close_position(pos, current, exit_reason, pnl_pct, analysis.reasoning)
                closed += 1

        return closed

    async def _close_position(
        self,
        pos: UserPosition,
        exit_price: float,
        reason: str,
        pnl_pct: float,
        reasoning: str,
    ) -> None:
        pos.status = "closed"
        pos.exit_price = exit_price
        pos.exit_reason = reason
        pos.closed_at = datetime.now(UTC)
        await self._session.commit()

        reason_fr = {
            "take_profit": "objectif de gain atteint 🎯",
            "stop_loss": "limite de perte atteinte 🛑",
            "signal_vendre": "signaux techniques de vente",
            "probabilite_baisse": "baisse de probabilité haussière",
        }.get(reason, reason)

        await self._notifier.create(
            title=f"⏰ Vendre {pos.symbol}",
            body=(
                f"Il est temps de clôturer votre position sur {pos.symbol}.\n"
                f"Raison : {reason_fr}.\n"
                f"Prix d'entrée : {pos.entry_price:.2f} → Prix actuel : {exit_price:.2f} "
                f"({pnl_pct:+.1f}%).\n"
                f"Analyse : {reasoning}"
            ),
            user_alias=pos.user_alias,
            symbol=pos.symbol,
            severity="warning" if pnl_pct < 0 else "success",
        )

        engine = ExecutionEngine(self._session)
        broker = await engine.get_default_broker(pos.user_alias)
        if broker:
            await engine.stage_order(
                pos.symbol,
                "sell",
                min(pos.quantity * exit_price, broker.max_order_usd),
                user_alias=pos.user_alias,
                broker_id=broker.id,
                probability=0.0,
                signal_reason=f"Signal vente : {reason_fr}",
            )
