"""Routes API portefeuille (dépôt, allocation)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.models.user import User
from app.schemas.wallet import (
    AllocateFundsRequest,
    DepositRequest,
    WalletOperationResponse,
    WalletResponse,
)
from app.services.audit_service import log_audit_event
from app.services.stripe_mock import simulate_stripe_deposit
from app.services.wallet_service import allocate_to_trading, deposit_to_wallet, get_wallet_for_update

router = APIRouter(prefix="/wallets", tags=["Wallets"])


def _to_wallet_response(user_id: uuid.UUID, wallet) -> WalletResponse:
    return WalletResponse(
        user_id=user_id,
        solde_total=wallet.solde_total,
        solde_disponible=wallet.solde_disponible,
        solde_engage=wallet.solde_engage,
    )


@router.post("/{user_id}/deposit", response_model=WalletOperationResponse)
async def deposit_funds(
    user_id: uuid.UUID,
    payload: DepositRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> WalletOperationResponse:
    """Simule un dépôt Stripe puis crédite le portefeuille."""

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    wallet = await get_wallet_for_update(session, user_id)
    if not wallet:
        raise HTTPException(status_code=404, detail="Portefeuille introuvable.")

    payment_result = await simulate_stripe_deposit(payload.amount, payload.payment_method)
    if payment_result["status"] != "succeeded":
        raise HTTPException(status_code=400, detail="Le dépôt Stripe simulé a échoué.")

    wallet = await deposit_to_wallet(session, wallet, payload.amount)
    await log_audit_event(
        session,
        source="wallet_api",
        event_type="wallet_deposit",
        severity="info",
        message="Dépôt confirmé sur le portefeuille.",
        user_id=user_id,
        payload={
            "amount": str(payload.amount),
            "transaction_id": payment_result["transaction_id"],
            "solde_total": str(wallet.solde_total),
            "solde_disponible": str(wallet.solde_disponible),
        },
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()

    return WalletOperationResponse(
        message="Dépôt validé et crédité avec succès.",
        wallet=_to_wallet_response(user_id, wallet),
        transaction_id=payment_result["transaction_id"],
    )


@router.post("/{user_id}/allocate", response_model=WalletOperationResponse)
async def allocate_funds_for_trading(
    user_id: uuid.UUID,
    payload: AllocateFundsRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> WalletOperationResponse:
    """Transfère un montant du solde disponible vers le solde engagé."""

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    wallet = await get_wallet_for_update(session, user_id)
    if not wallet:
        raise HTTPException(status_code=404, detail="Portefeuille introuvable.")

    try:
        wallet = await allocate_to_trading(session, wallet, payload.amount)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await log_audit_event(
        session,
        source="wallet_api",
        event_type="wallet_allocate_to_trading",
        severity="info",
        message="Fonds alloués au trading automatique.",
        user_id=user_id,
        payload={
            "amount": str(payload.amount),
            "solde_disponible": str(wallet.solde_disponible),
            "solde_engage": str(wallet.solde_engage),
        },
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()

    return WalletOperationResponse(
        message="Montant alloué au robot de trading.",
        wallet=_to_wallet_response(user_id, wallet),
    )
