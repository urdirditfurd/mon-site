"""Routes de la brique C: seuil IA et ordres simulés."""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.models.simulated_order import SimulatedOrder
from app.models.trading_profile import TradingProfile
from app.models.user import User
from app.schemas.trading import OrderStatsResponse, SimulatedOrderResponse
from app.schemas.user import TradingThresholdUpdateRequest

router = APIRouter(prefix="/trading", tags=["Trading IA"])


@router.patch("/users/{user_id}/threshold")
async def update_user_threshold(
    user_id: uuid.UUID,
    payload: TradingThresholdUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str | Decimal]:
    """Met à jour le seuil de probabilité minimum d'un utilisateur."""

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    threshold_value = payload.seuil_probabilite_min.quantize(Decimal("0.01"))

    profile = await session.scalar(select(TradingProfile).where(TradingProfile.user_id == user_id))
    if profile is None:
        profile = TradingProfile(
            user_id=user_id,
            seuil_probabilite_min=threshold_value,
        )
        session.add(profile)
    else:
        profile.seuil_probabilite_min = threshold_value
        session.add(profile)

    await session.commit()

    return {
        "message": "Seuil de probabilité mis à jour.",
        "seuil_probabilite_min": profile.seuil_probabilite_min,
    }


@router.get("/users/{user_id}/orders", response_model=list[SimulatedOrderResponse])
async def list_user_orders(
    user_id: uuid.UUID,
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> list[SimulatedOrder]:
    """Retourne les derniers ordres simulés générés pour un utilisateur."""

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    result = await session.execute(
        select(SimulatedOrder)
        .where(SimulatedOrder.user_id == user_id)
        .order_by(desc(SimulatedOrder.created_at))
        .limit(limit)
    )
    orders = list(result.scalars().all())
    return [
        SimulatedOrderResponse(
            id=order.id,
            user_id=order.user_id,
            broker=order.broker,
            broker_order_id=order.broker_order_id,
            asset_symbol=order.asset_symbol,
            headline=order.headline,
            direction=order.direction,
            confidence=order.confidence,
            seuil_utilise=order.seuil_utilise,
            montant_ordre=order.montant_ordre,
            requested_price=order.requested_price,
            filled_price=order.filled_price,
            pnl_simule=order.pnl_simule,
            status=order.status,
            rejection_reason=order.rejection_reason,
            created_at=order.created_at,
            updated_at=order.updated_at,
        )
        for order in orders
    ]


@router.get("/users/{user_id}/orders/stats", response_model=OrderStatsResponse)
async def get_user_order_stats(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> OrderStatsResponse:
    """Retourne un résumé du pipeline d'exécution broker pour un utilisateur."""

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    result = await session.execute(select(SimulatedOrder).where(SimulatedOrder.user_id == user_id))
    orders = list(result.scalars().all())

    pending_orders = sum(order.status == "pending" for order in orders)
    filled_orders = sum(order.status == "filled" for order in orders)
    rejected_orders = sum(order.status == "rejected" for order in orders)
    total_pnl_simule = sum((order.pnl_simule for order in orders), Decimal("0.00"))

    return OrderStatsResponse(
        user_id=user_id,
        total_orders=len(orders),
        pending_orders=pending_orders,
        filled_orders=filled_orders,
        rejected_orders=rejected_orders,
        total_pnl_simule=total_pnl_simule.quantize(Decimal("0.01")),
    )
