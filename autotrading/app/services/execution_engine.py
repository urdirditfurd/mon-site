"""Moteur d'exécution — Trading-as-Git (stage → approve → push)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import BrokerAccount, StagedOrder
from app.services.broker.adapter import adapter_from_encrypted
from app.services.broker.crypto_vault import encrypt_secret
from app.services.broker.exchanges import get_exchange
from app.services.market_data import fetch_price_only
from app.services.notifier import NotificationService
from app.services.universe import get_universe

logger = logging.getLogger(__name__)


class ExecutionEngine:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._notifier = NotificationService(session)

    async def connect_broker(
        self,
        exchange_id: str,
        api_key: str,
        api_secret: str,
        *,
        passphrase: str = "",
        label: str = "",
        mode: str = "paper",
        user_alias: str = "default",
        max_order_usd: float = 100.0,
        auto_execute: bool = False,
    ) -> BrokerAccount:
        info = get_exchange(exchange_id)
        if not info:
            raise ValueError(f"Exchange inconnu : {exchange_id}")
        if info.deprecated_fr and mode == "live":
            raise ValueError(
                f"{info.name} n'est plus recommandé en France en mode réel. "
                "Utilisez Kraken/Bitget ou le mode paper/testnet."
            )

        account = BrokerAccount(
            user_alias=user_alias,
            exchange_id=exchange_id,
            label=label or f"{info.name} ({mode})",
            api_key_enc=encrypt_secret(api_key),
            api_secret_enc=encrypt_secret(api_secret),
            passphrase_enc=encrypt_secret(passphrase) if passphrase else "",
            mode=mode,
            max_order_usd=min(max_order_usd, settings.max_order_usd),
            auto_execute=auto_execute and settings.allow_live_trading if mode == "live" else auto_execute,
        )
        self._session.add(account)
        await self._session.commit()
        await self._session.refresh(account)
        return account

    async def list_brokers(self, user_alias: str = "default") -> list[BrokerAccount]:
        stmt = select(BrokerAccount).where(
            BrokerAccount.user_alias == user_alias,
            BrokerAccount.is_active == True,  # noqa: E712
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def get_default_broker(self, user_alias: str = "default") -> BrokerAccount | None:
        brokers = await self.list_brokers(user_alias)
        return brokers[0] if brokers else None

    async def stage_order(
        self,
        symbol: str,
        side: str,
        amount_usd: float,
        *,
        user_alias: str = "default",
        broker_id: str | None = None,
        probability: float = 0.0,
        signal_reason: str = "",
        commit_message: str = "",
    ) -> StagedOrder | None:
        asset = next((a for a in get_universe() if a.symbol == symbol), None)
        if not asset:
            return None

        broker = None
        if broker_id:
            stmt = select(BrokerAccount).where(BrokerAccount.id == broker_id)
            broker = (await self._session.execute(stmt)).scalar_one_or_none()
        else:
            broker = await self.get_default_broker(user_alias)

        if not broker:
            return None

        if asset.asset_type not in ("crypto",) and broker.exchange_id not in ("alpaca",):
            return None
        if asset.asset_type in ("stock", "etf") and broker.exchange_id != "alpaca":
            return None

        amount_usd = min(amount_usd, broker.max_order_usd, settings.max_order_usd)
        price = await fetch_price_only(symbol, asset.asset_type)
        if not price or price <= 0:
            return None

        order = StagedOrder(
            user_alias=user_alias,
            broker_id=broker.id,
            symbol=symbol,
            asset_type=asset.asset_type,
            side=side,
            amount_usd=amount_usd,
            price_at_stage=price,
            probability=probability,
            commit_message=commit_message or f"{side.upper()} {symbol} — proba {probability:.0f}%",
            signal_reason=signal_reason,
            status="staged",
        )
        self._session.add(order)
        await self._session.commit()
        await self._session.refresh(order)

        await self._notifier.create(
            title=f"📋 Ordre en attente — {side.upper()} {symbol}",
            body=(
                f"Un ordre de {amount_usd:.2f} USD sur {symbol} attend votre approbation.\n"
                f"Prix : {price:.2f} | Probabilité : {probability:.0f}%\n"
                f"Raison : {signal_reason or 'Signal détecté par Alice'}\n"
                "Allez dans « Ordres en attente » pour approuver ou rejeter."
            ),
            user_alias=user_alias,
            symbol=symbol,
            severity="warning",
        )

        if broker.auto_execute:
            return await self.approve_and_execute(order.id, commit_message="Auto-exécution activée")

        return order

    async def approve_and_execute(
        self,
        order_id: str,
        commit_message: str = "",
    ) -> StagedOrder | None:
        stmt = select(StagedOrder).where(StagedOrder.id == order_id)
        order = (await self._session.execute(stmt)).scalar_one_or_none()
        if not order or order.status != "staged":
            return None

        broker_stmt = select(BrokerAccount).where(BrokerAccount.id == order.broker_id)
        broker = (await self._session.execute(broker_stmt)).scalar_one_or_none()
        if not broker or not broker.is_active:
            order.status = "failed"
            order.error_message = "Courtier introuvable ou inactif"
            await self._session.commit()
            return order

        if broker.mode == "live" and not settings.allow_live_trading:
            order.status = "failed"
            order.error_message = "Trading réel désactivé sur ce serveur (ALLOW_LIVE_TRADING=false)"
            await self._session.commit()
            return order

        order.status = "approved"
        order.approved_at = datetime.now(UTC)
        if commit_message:
            order.commit_message = commit_message
        await self._session.commit()

        adapter = adapter_from_encrypted(
            broker.exchange_id,
            broker.api_key_enc,
            broker.api_secret_enc,
            broker.passphrase_enc,
            broker.mode,  # type: ignore[arg-type]
        )

        try:
            result = await adapter.create_market_order(
                order.symbol,
                order.asset_type,
                order.side,  # type: ignore[arg-type]
                order.amount_usd,
            )
            if result.success:
                order.status = "executed"
                order.executed_at = datetime.now(UTC)
                order.external_order_id = result.order_id
                order.quantity = result.amount
                await self._notifier.create(
                    title=f"✅ Ordre exécuté — {order.side.upper()} {order.symbol}",
                    body=(
                        f"Ordre routé vers {broker.exchange_id} ({broker.mode}).\n"
                        f"ID : {result.order_id} | Montant : {result.amount:.6f} @ {result.price:.2f}"
                    ),
                    user_alias=order.user_alias,
                    symbol=order.symbol,
                    severity="success",
                )
            else:
                order.status = "failed"
                order.error_message = result.error
                await self._notifier.create(
                    title=f"❌ Échec ordre — {order.symbol}",
                    body=result.error or "Erreur inconnue",
                    user_alias=order.user_alias,
                    symbol=order.symbol,
                    severity="danger",
                )
        except Exception as exc:
            order.status = "failed"
            order.error_message = str(exc)
            logger.exception("Execute order failed: %s", exc)
        finally:
            await adapter.close()

        await self._session.commit()
        await self._session.refresh(order)
        return order

    async def reject_order(self, order_id: str) -> StagedOrder | None:
        stmt = select(StagedOrder).where(StagedOrder.id == order_id)
        order = (await self._session.execute(stmt)).scalar_one_or_none()
        if not order or order.status != "staged":
            return None
        order.status = "rejected"
        await self._session.commit()
        return order

    async def list_staged(self, user_alias: str = "default", status: str = "staged") -> list[StagedOrder]:
        stmt = (
            select(StagedOrder)
            .where(StagedOrder.user_alias == user_alias, StagedOrder.status == status)
            .order_by(desc(StagedOrder.staged_at))
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def list_history(self, user_alias: str = "default", limit: int = 50) -> list[StagedOrder]:
        stmt = (
            select(StagedOrder)
            .where(StagedOrder.user_alias == user_alias)
            .order_by(desc(StagedOrder.staged_at))
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())
