"""Routes d'onboarding et préférences trading utilisateur."""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import ensure_user_access, get_current_user
from app.db.database import get_session
from app.models.trading_profile import TradingProfile
from app.models.user import User
from app.models.user_preference import UserPreference
from app.schemas.preferences import (
    SUPPORTED_BROKER_PLATFORMS,
    BrokerPlatformDescriptor,
    UserPreferenceResponse,
    UserPreferenceUpdateRequest,
)
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/preferences", tags=["Onboarding"])


BROKER_PLATFORMS = [
    BrokerPlatformDescriptor(
        id="simulation",
        label="Simulation sécurisée",
        asset_classes=["Actions", "ETF", "Crypto"],
        status="available",
        note="Mode recommandé tant que les clés broker réelles ne sont pas configurées.",
    ),
    BrokerPlatformDescriptor(
        id="binance",
        label="Binance",
        asset_classes=["Crypto"],
        status="requires_api_keys",
        note="Connexion réelle possible via clés API restreintes stockées côté serveur.",
    ),
    BrokerPlatformDescriptor(
        id="coinbase",
        label="Coinbase Advanced Trade",
        asset_classes=["Crypto"],
        status="requires_api_keys",
        note="Connexion réelle possible via API Coinbase Advanced Trade.",
    ),
    BrokerPlatformDescriptor(
        id="alpaca",
        label="Alpaca",
        asset_classes=["Actions", "ETF"],
        status="requires_api_keys",
        note="Bon choix pour paper trading puis exécution actions/ETF.",
    ),
    BrokerPlatformDescriptor(
        id="interactive_brokers",
        label="Interactive Brokers",
        asset_classes=["Actions", "ETF"],
        status="requires_gateway",
        note="Nécessite IB Gateway/TWS et une configuration serveur dédiée.",
    ),
    BrokerPlatformDescriptor(
        id="trade_republic_waitlist",
        label="Trade Republic",
        asset_classes=["Actions", "ETF", "Crypto"],
        status="not_officially_supported",
        note="Pas d'API publique stable: à traiter comme demande future ou via partenaire agréé.",
    ),
]


def _default_preferences(user_id: uuid.UUID) -> UserPreference:
    return UserPreference(
        user_id=user_id,
        minimum_probability_threshold=Decimal("80.00"),
        enable_crypto=True,
        enable_etf=True,
        enable_stocks=True,
        sector_tech=True,
        sector_mines=True,
        sector_real_estate=False,
        sector_insurance=False,
        sector_food=False,
        broker_platform="simulation",
        broker_connection_status="not_connected",
        funding_provider="simulated_psp",
        paper_trading_enabled=True,
    )


def _to_response(preference: UserPreference) -> UserPreferenceResponse:
    return UserPreferenceResponse(
        user_id=preference.user_id,
        minimum_probability_threshold=preference.minimum_probability_threshold,
        enable_crypto=preference.enable_crypto,
        enable_etf=preference.enable_etf,
        enable_stocks=preference.enable_stocks,
        sector_tech=preference.sector_tech,
        sector_mines=preference.sector_mines,
        sector_real_estate=preference.sector_real_estate,
        sector_insurance=preference.sector_insurance,
        sector_food=preference.sector_food,
        broker_platform=preference.broker_platform,
        broker_connection_status=preference.broker_connection_status,
        funding_provider=preference.funding_provider,
        paper_trading_enabled=preference.paper_trading_enabled,
    )


async def _ensure_preferences(session: AsyncSession, user_id: uuid.UUID) -> UserPreference:
    preference = await session.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    if preference is not None:
        return preference
    preference = _default_preferences(user_id)
    session.add(preference)
    await session.flush()
    return preference


@router.get("/broker-platforms", response_model=list[BrokerPlatformDescriptor])
async def list_broker_platforms() -> list[BrokerPlatformDescriptor]:
    """Retourne les plateformes sélectionnables dans l'onboarding."""

    return BROKER_PLATFORMS


@router.get("/users/{user_id}", response_model=UserPreferenceResponse)
async def get_user_preferences(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> UserPreferenceResponse:
    """Retourne les préférences produit et moteur IA."""

    ensure_user_access(current_user=current_user, target_user_id=user_id)
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    preference = await _ensure_preferences(session, user_id)
    await session.commit()
    await session.refresh(preference)
    return _to_response(preference)


@router.patch("/users/{user_id}", response_model=UserPreferenceResponse)
async def update_user_preferences(
    user_id: uuid.UUID,
    payload: UserPreferenceUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> UserPreferenceResponse:
    """Met à jour les préférences sectorielles, probabilité, broker et mode paper/live."""

    ensure_user_access(current_user=current_user, target_user_id=user_id)
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    preference = await _ensure_preferences(session, user_id)
    updates = payload.model_dump(exclude_unset=True)
    broker_platform = updates.get("broker_platform")
    if broker_platform is not None and broker_platform not in SUPPORTED_BROKER_PLATFORMS:
        raise HTTPException(status_code=400, detail="Plateforme de trading non supportée.")

    for field, value in updates.items():
        if field == "minimum_probability_threshold" and value is not None:
            value = value.quantize(Decimal("0.01"))
        setattr(preference, field, value)

    if "broker_platform" in updates:
        preference.broker_connection_status = "connected" if preference.broker_platform == "simulation" else "requires_secure_setup"
    if "paper_trading_enabled" in updates and preference.paper_trading_enabled:
        preference.broker_connection_status = "paper_mode"

    profile = await session.scalar(select(TradingProfile).where(TradingProfile.user_id == user_id))
    if profile is not None and payload.minimum_probability_threshold is not None:
        profile.seuil_probabilite_min = payload.minimum_probability_threshold.quantize(Decimal("0.01"))
        session.add(profile)

    session.add(preference)
    await log_audit_event(
        session,
        source="preferences_api",
        event_type="preferences_updated",
        severity="info",
        message="Préférences trading utilisateur mises à jour.",
        user_id=user_id,
        payload={key: str(value) for key, value in updates.items()},
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    await session.refresh(preference)
    return _to_response(preference)
