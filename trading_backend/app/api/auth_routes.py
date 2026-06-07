"""Routes d'authentification et d'identité."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token, get_current_user, hash_password, verify_password
from app.db.database import get_session
from app.models.trading_profile import TradingProfile
from app.models.user import User
from app.models.wallet import Wallet
from app.schemas.auth import (
    AuthUserResponse,
    GoogleAuthRequest,
    LoginRequest,
    LoginResponse,
    PublicAuthConfigResponse,
)
from app.services.audit_service import log_audit_event
from app.services.google_oauth import GoogleOAuthError, generate_oauth_password, verify_google_id_token

router = APIRouter(prefix="/auth", tags=["Auth"])


def _to_auth_user(user: User) -> AuthUserResponse:
    return AuthUserResponse(
        id=user.id,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
    )


async def _provision_new_user(session: AsyncSession, email: str, password: str) -> User:
    """Crée utilisateur, wallet et profil trading."""

    user = User(
        email=email,
        password_hash=hash_password(password),
        role="trader",
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
    session.add_all([user, wallet, trading_profile])
    await session.flush()
    return user


@router.get("/public-config", response_model=PublicAuthConfigResponse)
async def public_auth_config() -> PublicAuthConfigResponse:
    """Expose la config OAuth publique pour l'interface de connexion."""

    google_id = settings.google_client_id.strip() or None
    return PublicAuthConfigResponse(
        google_client_id=google_id,
        google_enabled=bool(google_id),
        apple_enabled=bool(settings.apple_client_id.strip()),
        min_password_length=8,
    )


@router.post("/google", response_model=LoginResponse)
async def login_with_google(
    payload: GoogleAuthRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> LoginResponse:
    """Connexion ou inscription via Google Sign-In."""

    if not settings.google_client_id.strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Connexion Google non configurée sur le serveur.",
        )

    try:
        google_user = verify_google_id_token(payload.credential, settings.google_client_id.strip())
    except GoogleOAuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    email = google_user["email"]
    user = await session.scalar(select(User).where(User.email == email))
    created = False
    if user is None:
        user = await _provision_new_user(session, email, generate_oauth_password())
        created = True
        await log_audit_event(
            session,
            source="auth_api",
            event_type="user_created_google",
            severity="info",
            message="Compte créé via Google.",
            user_id=user.id,
            payload={"email": email},
            monitoring_hub=request.app.state.monitoring_hub,
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Utilisateur désactivé.")

    access_token, expires_in = create_access_token(user)
    await log_audit_event(
        session,
        source="auth_api",
        event_type="user_login_google",
        severity="info",
        message="Connexion Google réussie.",
        user_id=user.id,
        payload={"email": email, "created": created},
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in_seconds=expires_in,
        user=_to_auth_user(user),
    )


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> LoginResponse:
    """Authentifie un utilisateur et retourne un Bearer token."""

    user = await session.scalar(select(User).where(User.email == payload.email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants invalides.")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Utilisateur désactivé.")

    access_token, expires_in = create_access_token(user)
    await log_audit_event(
        session,
        source="auth_api",
        event_type="user_login",
        severity="info",
        message="Connexion utilisateur réussie.",
        user_id=user.id,
        payload={"role": user.role},
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in_seconds=expires_in,
        user=_to_auth_user(user),
    )


@router.get("/me", response_model=AuthUserResponse)
async def me(current_user: User = Depends(get_current_user)) -> AuthUserResponse:
    """Retourne l'identité de l'utilisateur courant."""

    return _to_auth_user(current_user)


@router.post("/login-confirmation", status_code=status.HTTP_202_ACCEPTED)
async def login_confirmation(
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Enregistre une confirmation de connexion (SMTP à brancher en production)."""

    await log_audit_event(
        session,
        source="auth_api",
        event_type="login_confirmation_requested",
        severity="info",
        message=f"Confirmation de connexion pour {current_user.email}.",
        user_id=current_user.id,
        payload={"email": current_user.email},
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    return {
        "status": "accepted",
        "message": "Confirmation enregistrée. Configurez SMTP pour l'envoi réel.",
    }
