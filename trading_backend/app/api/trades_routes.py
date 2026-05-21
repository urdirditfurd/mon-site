"""Routes API pour la gestion des positions actives (ActiveTrade).

Endpoints :
  GET   /trades/users/{user_id}              — Liste tous les trades (filtrables)
  GET   /trades/users/{user_id}/{trade_id}   — Détail d'un trade
  POST  /trades/users/{user_id}/{trade_id}/close — Clôture manuelle
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import ensure_user_access, get_current_user
from app.db.database import get_session
from app.models.active_trade import ActiveTrade
from app.models.user import User
from app.schemas.decision import ActiveTradeResponse, CloseTradeRequest

router = APIRouter(prefix="/trades", tags=["Positions Actives"])


@router.get(
    "/users/{user_id}",
    response_model=list[ActiveTradeResponse],
    summary="Lister les positions d'un utilisateur",
)
async def list_user_trades(
    user_id: uuid.UUID,
    trade_status: Literal["open", "closed", "all"] = Query(
        default="all",
        alias="status",
        description="Filtrer par statut : open, closed, all.",
    ),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[ActiveTradeResponse]:
    """Retourne les positions (ouvertes et/ou clôturées) de l'utilisateur."""
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utilisateur introuvable.",
        )
    ensure_user_access(current_user=current_user, target_user_id=user_id)

    query = select(ActiveTrade).where(ActiveTrade.user_id == user_id)
    if trade_status != "all":
        query = query.where(ActiveTrade.status == trade_status)
    query = query.order_by(desc(ActiveTrade.opened_at)).limit(limit)

    trades = (await session.execute(query)).scalars().all()
    return [ActiveTradeResponse.model_validate(t) for t in trades]


@router.get(
    "/users/{user_id}/{trade_id}",
    response_model=ActiveTradeResponse,
    summary="Détail d'une position",
)
async def get_trade_detail(
    user_id: uuid.UUID,
    trade_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ActiveTradeResponse:
    """Retourne le détail complet d'un trade (signal associé, PnL, durée, etc.)."""
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utilisateur introuvable.",
        )
    ensure_user_access(current_user=current_user, target_user_id=user_id)

    trade = await session.scalar(
        select(ActiveTrade).where(
            ActiveTrade.id == trade_id,
            ActiveTrade.user_id == user_id,
        )
    )
    if trade is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position introuvable.",
        )
    return ActiveTradeResponse.model_validate(trade)


@router.post(
    "/users/{user_id}/{trade_id}/close",
    response_model=ActiveTradeResponse,
    status_code=status.HTTP_200_OK,
    summary="Clôturer manuellement une position ouverte",
)
async def close_trade_manually(
    user_id: uuid.UUID,
    trade_id: uuid.UUID,
    payload: CloseTradeRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ActiveTradeResponse:
    """Demande la clôture immédiate d'un trade ouvert.

    Le PnL simulé est calculé, le capital est restitué dans le wallet,
    et une notification WebSocket est émise.
    """
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utilisateur introuvable.",
        )
    ensure_user_access(current_user=current_user, target_user_id=user_id)

    lifecycle_service = request.app.state.trade_lifecycle
    result = await lifecycle_service.close_trade_manually(
        trade_id=str(trade_id),
        user_id=str(user_id),
        reason=payload.reason,
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position introuvable ou déjà clôturée.",
        )

    # Re-fetch pour avoir l'état frais
    trade = await session.scalar(
        select(ActiveTrade).where(
            ActiveTrade.id == trade_id,
            ActiveTrade.user_id == user_id,
        )
    )
    if trade is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erreur lors de la récupération de la position après clôture.",
        )
    return ActiveTradeResponse.model_validate(trade)
