"""Routes API pour piloter le moteur de décision IA."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import ensure_user_access, get_current_user
from app.models.user import User
from app.schemas.decision import AnalyzeNewsRequest, AnalyzeNewsResponse, TradingOpportunityResponse
from app.services.decision_engine import analyze_incoming_news, evaluate_trading_opportunity

router = APIRouter(prefix="/decision", tags=["Decision Engine"])


@router.post("/signals/analyze", response_model=AnalyzeNewsResponse, status_code=status.HTTP_201_CREATED)
async def analyze_news(payload: AnalyzeNewsRequest, _current_user: User = Depends(get_current_user)) -> AnalyzeNewsResponse:
    """Exécute l'analyse NLP d'une news et stocke le signal obtenu."""

    try:
        result = await analyze_incoming_news(news_text=payload.news_text, category=payload.category)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return AnalyzeNewsResponse(
        signal_id=result.signal_id,
        mapped_sector=result.mapped_sector,
        sentiment_polarity=result.sentiment_polarity,
        probability_bullish=result.probability_bullish,
        probability_bearish=result.probability_bearish,
        signal_strength=result.signal_strength,
        is_valid_signal=result.is_valid_signal,
        time_to_live_minutes=result.time_to_live_minutes,
        expires_at=result.expires_at,
    )


@router.post("/users/{user_id}/evaluate", response_model=TradingOpportunityResponse)
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
