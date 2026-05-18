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
from app.schemas.trading import SimulatedOrderResponse
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
            headline=order.headline,
            direction=order.direction,
            confidence=order.confidence,
            seuil_utilise=order.seuil_utilise,
            montant_ordre=order.montant_ordre,
            status=order.status,
            created_at=order.created_at,
        )
        for order in orders
    ]
