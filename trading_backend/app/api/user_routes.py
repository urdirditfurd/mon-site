"""Routes liées aux utilisateurs."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.models.trading_profile import TradingProfile
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet
from app.schemas.user import UserCreateRequest, UserResponse
from app.core.security import hash_password
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/users", tags=["Users"])


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    """Crée un utilisateur et son portefeuille initial à zéro."""

    existing_user = await session.scalar(select(User).where(User.email == payload.email))
    if existing_user:
        raise HTTPException(status_code=409, detail="Un utilisateur avec cet email existe déjà.")

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True,
    )
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
    user_preference = UserPreference(
        user=user,
        minimum_probability_threshold=trading_profile.seuil_probabilite_min,
        enable_crypto=True,
        enable_etf=True,
        enable_stocks=True,
        sector_tech=True,
        sector_mines=True,
        sector_real_estate=False,
        sector_insurance=False,
        sector_food=False,
    )
    session.add_all([user, wallet, trading_profile, user_preference])
    await log_audit_event(
        session,
        source="user_api",
        event_type="user_created",
        severity="info",
        message="Nouvel utilisateur créé.",
        user_id=user.id,
        payload={"email": str(payload.email)},
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    await session.refresh(user)
    return UserResponse(
        id=user.id,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        seuil_probabilite_min=trading_profile.seuil_probabilite_min,
        is_trading_active=trading_profile.is_trading_active,
    )
