"""Routes API pour piloter le moteur de décision IA."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import ensure_user_access, get_current_user, require_roles
from app.db.database import get_session
from app.models.user import User
from app.models.user_preference import UserPreference
from app.schemas.decision import (
    AnalyzeNewsRequest,
    AnalyzeNewsResponse,
    ClosureReportResponse,
    CycleClosureItem,
    TradingOpportunityResponse,
    UserPreferenceRead,
    UserPreferenceUpdate,
)
from app.services.decision_engine import (
    analyze_incoming_news,
    close_expired_positions,
    evaluate_trading_opportunity,
)

router = APIRouter(prefix="/decision", tags=["Decision Engine"])


# ---------------------------------------------------------------------------
# Analyse NLP
# ---------------------------------------------------------------------------

@router.post(
    "/signals/analyze",
    response_model=AnalyzeNewsResponse,
    status_code=status.HTTP_201_CREATED,
)
async def analyze_news(
    payload: AnalyzeNewsRequest,
    _current_user: User = Depends(get_current_user),
) -> AnalyzeNewsResponse:
    """Exécute l'analyse NLP d'une news et stocke le signal obtenu."""

    try:
        result = await analyze_incoming_news(
            news_text=payload.news_text,
            category=payload.category,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return AnalyzeNewsResponse(
        signal_id=result.signal_id,
        mapped_sector=result.mapped_sector,
        asset_class=result.asset_class,
        retention_category=result.retention_category,
        sentiment_polarity=result.sentiment_polarity,
        probability_bullish=result.probability_bullish,
        probability_bearish=result.probability_bearish,
        signal_strength=result.signal_strength,
        source_confidence=result.source_confidence,
        is_valid_signal=result.is_valid_signal,
        time_to_live_minutes=result.time_to_live_minutes,
        expires_at=result.expires_at,
        keywords_matched=result.keywords_matched,
    )


# ---------------------------------------------------------------------------
# Évaluation d'opportunité
# ---------------------------------------------------------------------------

@router.post(
    "/users/{user_id}/evaluate",
    response_model=TradingOpportunityResponse,
)
async def evaluate_user_opportunity(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
) -> TradingOpportunityResponse:
    """Évalue les signaux récents et décide d'ouvrir (ou non) une opportunité."""

    ensure_user_access(current_user=current_user, target_user_id=user_id)
    result = await evaluate_trading_opportunity(user_id)
    return TradingOpportunityResponse(
        should_execute=result.should_execute,
        reason=result.reason,
        user_id=result.user_id,
        market_signal_id=result.market_signal_id,
        direction=result.direction,
        asset_class=result.asset_class,
        sector=result.sector,
        probability_used=result.probability_used,
        recommended_capital=result.recommended_capital,
        estimated_duration_minutes=result.estimated_duration_minutes,
        planned_close_at=result.planned_close_at,
        active_trade_id=result.active_trade_id,
    )


# ---------------------------------------------------------------------------
# Préférences utilisateur CRUD
# ---------------------------------------------------------------------------

@router.get(
    "/users/{user_id}/preferences",
    response_model=UserPreferenceRead,
)
async def get_user_preferences(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserPreferenceRead:
    """Retourne les préférences de l'utilisateur (crée les valeurs par défaut si absentes)."""

    ensure_user_access(current_user=current_user, target_user_id=user_id)

    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    preference = await session.scalar(
        select(UserPreference).where(UserPreference.user_id == user_id),
    )
    if preference is None:
        preference = UserPreference(user_id=user_id)
        session.add(preference)
        await session.commit()
        await session.refresh(preference)

    return UserPreferenceRead.model_validate(preference)


@router.put(
    "/users/{user_id}/preferences",
    response_model=UserPreferenceRead,
)
async def update_user_preferences(
    user_id: uuid.UUID,
    payload: UserPreferenceUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserPreferenceRead:
    """Met à jour (partiellement) les préférences utilisateur."""

    ensure_user_access(current_user=current_user, target_user_id=user_id)

    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    preference = await session.scalar(
        select(UserPreference).where(UserPreference.user_id == user_id),
    )
    if preference is None:
        preference = UserPreference(user_id=user_id)
        session.add(preference)
        await session.flush()

    update_data = payload.model_dump(exclude_unset=True)
    for field_name, value in update_data.items():
        setattr(preference, field_name, value)

    await session.commit()
    await session.refresh(preference)

    return UserPreferenceRead.model_validate(preference)


# ---------------------------------------------------------------------------
# Clôture de cycle (positions expirées)
# ---------------------------------------------------------------------------

@router.post(
    "/positions/close-expired",
    response_model=ClosureReportResponse,
)
async def close_expired(
    _current_user: User = Depends(require_roles("admin", "compliance")),
) -> ClosureReportResponse:
    """Clôture les positions dont l'horizon de temps est dépassé (admin/compliance)."""

    report = await close_expired_positions()
    return ClosureReportResponse(
        closed_count=report.closed_count,
        total_pnl=report.total_pnl,
        closures=[
            CycleClosureItem(
                trade_id=c.trade_id,
                user_id=c.user_id,
                sector=c.sector,
                direction=c.direction,
                capital_returned=c.capital_returned,
                simulated_pnl=c.simulated_pnl,
                pnl_pct=c.pnl_pct,
                close_reason=c.close_reason,
                message=c.message,
            )
            for c in report.closures
        ],
    )
