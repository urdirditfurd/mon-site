"""Routes liées aux utilisateurs."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.models.trading_profile import TradingProfile
from app.models.user import User
from app.models.wallet import Wallet
from app.schemas.user import UserCreateRequest, UserResponse

router = APIRouter(prefix="/users", tags=["Users"])


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreateRequest, session: AsyncSession = Depends(get_session)) -> UserResponse:
    """Crée un utilisateur et son portefeuille initial à zéro."""

    existing_user = await session.scalar(select(User).where(User.email == payload.email))
    if existing_user:
        raise HTTPException(status_code=409, detail="Un utilisateur avec cet email existe déjà.")

    user = User(email=payload.email)
    wallet = Wallet(
        user=user,
        solde_total=Decimal("0.00"),
        solde_disponible=Decimal("0.00"),
        solde_engage=Decimal("0.00"),
    )
    trading_profile = TradingProfile(
        user=user,
        seuil_probabilite_min=Decimal("80.00"),
        is_trading_active=True,
        max_orders_per_day=20,
        stop_loss_pct=Decimal("2.50"),
        max_drawdown_pct=Decimal("12.00"),
        last_risk_reset_date=date.today(),
        orders_today=0,
        cumulative_pnl_today=Decimal("0.00"),
        equity_peak=Decimal("0.00"),
        equity_current=Decimal("0.00"),
    )
    session.add_all([user, wallet, trading_profile])
    await session.commit()
    await session.refresh(user)
    return UserResponse(
        id=user.id,
        email=user.email,
        created_at=user.created_at,
        seuil_probabilite_min=trading_profile.seuil_probabilite_min,
        is_trading_active=trading_profile.is_trading_active,
    )
