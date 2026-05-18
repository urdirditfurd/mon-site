"""Règles métier du portefeuille interne."""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.wallet import Wallet


async def get_wallet_for_update(session: AsyncSession, user_id: uuid.UUID) -> Wallet | None:
    """Charge un portefeuille avec verrou DB pour éviter les races conditions."""

    result = await session.execute(
        select(Wallet).where(Wallet.user_id == user_id).with_for_update()
    )
    return result.scalar_one_or_none()


async def deposit_to_wallet(session: AsyncSession, wallet: Wallet, amount: Decimal) -> Wallet:
    """Ajoute un montant au solde total et disponible."""

    wallet.solde_total += amount
    wallet.solde_disponible += amount
    session.add(wallet)
    await session.commit()
    await session.refresh(wallet)
    return wallet


async def allocate_to_trading(session: AsyncSession, wallet: Wallet, amount: Decimal) -> Wallet:
    """Transfère du solde disponible vers le solde engagé."""

    if wallet.solde_disponible < amount:
        raise ValueError("Solde disponible insuffisant pour cette allocation.")

    wallet.solde_disponible -= amount
    wallet.solde_engage += amount
    session.add(wallet)
    await session.commit()
    await session.refresh(wallet)
    return wallet
