"""Routes de gestion des intégrations externes réelles."""

from __future__ import annotations

from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user
from app.db.database import get_session
from app.models.user import User
from app.models.user_preference import UserPreference
from app.schemas.integrations import (
    BrokerActivationRequest,
    BrokerActivationResponse,
    GoogleOAuthStatusResponse,
    IntegrationsStatusResponse,
    StripeCheckoutRequest,
    StripeCheckoutResponse,
)
from app.services.integration_service import (
    create_stripe_checkout_session,
    get_broker_status,
    get_broker_statuses,
    get_oauth_statuses,
    get_payment_statuses,
)

router = APIRouter(prefix="/integrations", tags=["Intégrations"])


@router.get("/status", response_model=IntegrationsStatusResponse)
async def integrations_status(_current_user: User = Depends(get_current_user)) -> IntegrationsStatusResponse:
    """Retourne l'état des intégrations configurées côté serveur."""

    return IntegrationsStatusResponse(
        payments=get_payment_statuses(),
        brokers=get_broker_statuses(),
        oauth=get_oauth_statuses(),
    )



@router.get("/public-status", response_model=IntegrationsStatusResponse)
async def public_integrations_status() -> IntegrationsStatusResponse:
    """Retourne un état public des connecteurs sans secret ni identifiant masqué."""

    def scrub(statuses):
        clean = []
        for status in statuses:
            payload = status.model_copy()
            payload.masked_identifiers = []
            clean.append(payload)
        return clean

    return IntegrationsStatusResponse(
        payments=scrub(get_payment_statuses()),
        brokers=scrub(get_broker_statuses()),
        oauth=scrub(get_oauth_statuses()),
    )


@router.post("/payments/stripe/checkout", response_model=StripeCheckoutResponse)
async def create_stripe_checkout(
    payload: StripeCheckoutRequest,
    request: Request,
    _current_user: User = Depends(get_current_user),
) -> StripeCheckoutResponse:
    """Crée une session Stripe Checkout hébergée par Stripe pour créditer le wallet."""

    base_url = settings.public_base_url.rstrip("/") or str(request.base_url).rstrip("/")
    success_url = settings.stripe_success_url or f"{base_url}/ui?payment=success"
    cancel_url = settings.stripe_cancel_url or f"{base_url}/ui?payment=cancel"
    return await create_stripe_checkout_session(
        amount=payload.amount,
        success_url=success_url,
        cancel_url=cancel_url,
    )


@router.post("/brokers/activate", response_model=BrokerActivationResponse)
async def activate_broker(
    payload: BrokerActivationRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> BrokerActivationResponse:
    """Associe l'utilisateur au broker choisi si ses secrets serveur sont configurés."""

    status = get_broker_status(payload.platform)
    if status is None:
        raise HTTPException(status_code=400, detail="Broker inconnu ou non supporté.")

    preference = await session.scalar(select(UserPreference).where(UserPreference.user_id == current_user.id))
    if preference is None:
        preference = UserPreference(user_id=current_user.id)
        session.add(preference)
        await session.flush()

    preference.broker_platform = payload.platform
    preference.broker_connection_status = "ready_for_live" if status.configured else "requires_secure_setup"
    if not status.configured:
        preference.paper_trading_enabled = True
    session.add(preference)
    await session.commit()

    return BrokerActivationResponse(
        platform=payload.platform,
        configured=status.configured,
        status=preference.broker_connection_status,
        message=(
            "Broker prêt côté serveur. Tu peux désactiver le paper trading après revue risque."
            if status.configured
            else "Broker sélectionné, mais les secrets serveur requis manquent encore. Paper trading conservé."
        ),
    )


@router.get("/oauth/google/status", response_model=GoogleOAuthStatusResponse)
async def google_oauth_status(request: Request) -> GoogleOAuthStatusResponse:
    """Expose le statut Google OAuth et une URL d'autorisation si configuré."""

    if not settings.google_client_id or not settings.google_client_secret:
        return GoogleOAuthStatusResponse(
            configured=False,
            message="Google OAuth n'est pas configuré côté serveur.",
        )

    base_url = settings.public_base_url.rstrip("/") or str(request.base_url).rstrip("/")
    params = urlencode(
        {
            "client_id": settings.google_client_id,
            "redirect_uri": f"{base_url}/api/auth/google/callback",
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "consent",
        }
    )
    return GoogleOAuthStatusResponse(
        configured=True,
        auth_url=f"https://accounts.google.com/o/oauth2/v2/auth?{params}",
        message="Google OAuth est configuré. Le callback d'échange token reste à activer.",
    )
