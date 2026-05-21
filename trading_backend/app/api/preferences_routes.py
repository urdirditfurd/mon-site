"""Routes API pour la gestion des préférences utilisateur (CRUD).

Endpoints :
  GET  /preferences/users/{user_id}        — Lecture des préférences
  PUT  /preferences/users/{user_id}        — Mise à jour complète
  PATCH /preferences/users/{user_id}       — Mise à jour partielle
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import ensure_user_access, get_current_user
from app.db.database import get_session
from app.models.user import User
from app.models.user_preference import UserPreference
from app.schemas.preferences import UserPreferenceResponse, UserPreferenceUpdateRequest
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/preferences", tags=["Préférences Utilisateur"])

_DEFAULT_THRESHOLD = Decimal("70.00")


async def _get_or_create_preference(
    session: AsyncSession,
    user_id: uuid.UUID,
) -> UserPreference:
    """Retourne les préférences existantes ou les crée avec les valeurs par défaut."""
    preference = await session.scalar(
        select(UserPreference).where(UserPreference.user_id == user_id)
    )
    if preference is None:
        preference = UserPreference(
            user_id=user_id,
            minimum_probability_threshold=_DEFAULT_THRESHOLD,
            enable_crypto=True,
            enable_etf=True,
            enable_stocks=True,
            sector_tech=True,
            sector_mines=True,
            sector_real_estate=False,
            sector_insurance=False,
            sector_food=False,
        )
        session.add(preference)
        await session.flush()
    return preference


@router.get(
    "/users/{user_id}",
    response_model=UserPreferenceResponse,
    summary="Lire les préférences de trading",
)
async def get_user_preferences(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> UserPreferenceResponse:
    """Retourne les filtres sectoriels, les classes d'actifs et le seuil de probabilité."""
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utilisateur introuvable.",
        )
    ensure_user_access(current_user=current_user, target_user_id=user_id)

    preference = await _get_or_create_preference(session, user_id)
    await session.commit()
    return UserPreferenceResponse.model_validate(preference)


@router.put(
    "/users/{user_id}",
    response_model=UserPreferenceResponse,
    summary="Remplacer intégralement les préférences",
)
async def replace_user_preferences(
    user_id: uuid.UUID,
    payload: UserPreferenceUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> UserPreferenceResponse:
    """Écrase toutes les préférences avec les valeurs fournies.

    Tous les champs du body sont obligatoires pour un PUT.
    Les champs non fournis dans le payload JSON conserveront leur valeur
    par défaut Pydantic (None), ce qui ne les modifiera pas.
    """
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utilisateur introuvable.",
        )
    ensure_user_access(current_user=current_user, target_user_id=user_id)

    preference = await _get_or_create_preference(session, user_id)
    _apply_update(preference, payload)
    session.add(preference)

    await log_audit_event(
        session,
        source="preferences_api",
        event_type="preferences_replaced",
        severity="info",
        message="Préférences utilisateur remplacées intégralement.",
        user_id=user_id,
        payload=payload.model_dump(exclude_none=True),
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    await session.refresh(preference)
    return UserPreferenceResponse.model_validate(preference)


@router.patch(
    "/users/{user_id}",
    response_model=UserPreferenceResponse,
    summary="Mettre à jour partiellement les préférences",
)
async def update_user_preferences(
    user_id: uuid.UUID,
    payload: UserPreferenceUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> UserPreferenceResponse:
    """Mise à jour partielle : seuls les champs fournis (non-None) sont modifiés."""
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utilisateur introuvable.",
        )
    ensure_user_access(current_user=current_user, target_user_id=user_id)

    preference = await _get_or_create_preference(session, user_id)
    changed_fields = _apply_update(preference, payload)

    if not changed_fields:
        return UserPreferenceResponse.model_validate(preference)

    session.add(preference)
    await log_audit_event(
        session,
        source="preferences_api",
        event_type="preferences_updated",
        severity="info",
        message="Préférences utilisateur mises à jour.",
        user_id=user_id,
        payload=changed_fields,
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    await session.refresh(preference)
    return UserPreferenceResponse.model_validate(preference)


# ---------------------------------------------------------------------------
# Helper interne
# ---------------------------------------------------------------------------

def _apply_update(preference: UserPreference, payload: UserPreferenceUpdateRequest) -> dict:
    """Applique les champs non-None du payload sur l'objet preference.

    Returns:
        Dictionnaire des champs effectivement modifiés (pour l'audit).
    """
    changed: dict = {}
    field_map = {
        "minimum_probability_threshold": "minimum_probability_threshold",
        "enable_crypto":       "enable_crypto",
        "enable_etf":          "enable_etf",
        "enable_stocks":       "enable_stocks",
        "sector_tech":         "sector_tech",
        "sector_mines":        "sector_mines",
        "sector_real_estate":  "sector_real_estate",
        "sector_insurance":    "sector_insurance",
        "sector_food":         "sector_food",
    }
    for pydantic_field, model_field in field_map.items():
        value = getattr(payload, pydantic_field)
        if value is not None:
            if pydantic_field == "minimum_probability_threshold":
                value = value.quantize(Decimal("0.01"))
            setattr(preference, model_field, value)
            changed[model_field] = str(value)
    return changed
