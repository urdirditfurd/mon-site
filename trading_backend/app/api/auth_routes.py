"""Routes d'authentification et d'identité."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, get_current_user, verify_password
from app.db.database import get_session
from app.models.user import User
from app.schemas.auth import AuthUserResponse, LoginRequest, LoginResponse
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/auth", tags=["Auth"])


def _to_auth_user(user: User) -> AuthUserResponse:
    return AuthUserResponse(
        id=user.id,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
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
