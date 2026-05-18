"""Routes de la brique C: seuil IA et ordres simulés."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.models.simulated_order import SimulatedOrder
from app.models.trading_profile import TradingProfile
from app.models.user import User
from app.models.wallet import Wallet
from app.schemas.trading import (
    EngineControlActionRequest,
    EngineControlSnapshotResponse,
    OrderStatsResponse,
    RiskProfileResponse,
    RiskProfileUpdateRequest,
    SimulatedOrderResponse,
)
from app.schemas.user import TradingThresholdUpdateRequest
from app.services.audit_service import log_audit_event
from app.services.risk_manager import RiskManager

router = APIRouter(prefix="/trading", tags=["Trading IA"])
risk_manager = RiskManager()


def _build_default_profile(user_id: uuid.UUID, baseline_equity: Decimal) -> TradingProfile:
    return TradingProfile(
        user_id=user_id,
        seuil_probabilite_min=Decimal("80.00"),
        is_trading_active=True,
        max_orders_per_day=20,
        stop_loss_pct=Decimal("2.50"),
        max_drawdown_pct=Decimal("12.00"),
        last_risk_reset_date=date.today(),
        orders_today=0,
        cumulative_pnl_today=Decimal("0.00"),
        equity_peak=baseline_equity,
        equity_current=baseline_equity,
    )


async def _ensure_profile(
    session: AsyncSession,
    user_id: uuid.UUID,
    wallet: Wallet | None,
) -> TradingProfile:
    profile = await session.scalar(select(TradingProfile).where(TradingProfile.user_id == user_id))
    if profile is not None:
        return profile

    baseline = Decimal("0.00")
    if wallet is not None and wallet.solde_engage > 0:
        baseline = wallet.solde_engage.quantize(Decimal("0.01"))
    profile = _build_default_profile(user_id=user_id, baseline_equity=baseline)
    session.add(profile)
    await session.flush()
    return profile


def _to_order_response(order: SimulatedOrder) -> SimulatedOrderResponse:
    return SimulatedOrderResponse(
        id=order.id,
        user_id=order.user_id,
        broker=order.broker,
        broker_order_id=order.broker_order_id,
        asset_symbol=order.asset_symbol,
        headline=order.headline,
        direction=order.direction,
        confidence=order.confidence,
        seuil_utilise=order.seuil_utilise,
        montant_ordre=order.montant_ordre,
        requested_price=order.requested_price,
        filled_price=order.filled_price,
        pnl_simule=order.pnl_simule,
        status=order.status,
        rejection_reason=order.rejection_reason,
        created_at=order.created_at,
        updated_at=order.updated_at,
    )


def _to_risk_response(user_id: uuid.UUID, profile: TradingProfile) -> RiskProfileResponse:
    return RiskProfileResponse(
        user_id=user_id,
        is_trading_active=profile.is_trading_active,
        risk_block_reason=profile.risk_block_reason,
        max_orders_per_day=profile.max_orders_per_day,
        stop_loss_pct=profile.stop_loss_pct,
        max_drawdown_pct=profile.max_drawdown_pct,
        orders_today=profile.orders_today,
        cumulative_pnl_today=profile.cumulative_pnl_today,
        equity_peak=profile.equity_peak,
        equity_current=profile.equity_current,
        current_drawdown_pct=risk_manager.compute_drawdown_pct(profile),
        last_risk_reset_date=profile.last_risk_reset_date,
    )


@router.patch("/users/{user_id}/threshold")
async def update_user_threshold(
    user_id: uuid.UUID,
    payload: TradingThresholdUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str | Decimal]:
    """Met à jour le seuil de probabilité minimum d'un utilisateur."""

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    wallet = await session.scalar(select(Wallet).where(Wallet.user_id == user_id))
    threshold_value = payload.seuil_probabilite_min.quantize(Decimal("0.01"))
    profile = await _ensure_profile(session, user_id, wallet)
    profile.seuil_probabilite_min = threshold_value
    session.add(profile)
    await log_audit_event(
        session,
        source="trading_api",
        event_type="threshold_updated",
        severity="info",
        message="Seuil de probabilité utilisateur mis à jour.",
        user_id=user_id,
        payload={"seuil_probabilite_min": str(threshold_value)},
        monitoring_hub=request.app.state.monitoring_hub,
    )

    await session.commit()

    return {
        "message": "Seuil de probabilité mis à jour.",
        "seuil_probabilite_min": profile.seuil_probabilite_min,
    }


@router.get("/users/{user_id}/risk", response_model=RiskProfileResponse)
async def get_user_risk_profile(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> RiskProfileResponse:
    """Retourne la configuration + l'état courant de gestion du risque."""

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    wallet = await session.scalar(select(Wallet).where(Wallet.user_id == user_id))
    profile = await _ensure_profile(session, user_id, wallet)
    if wallet is not None:
        risk_manager.sync_daily_state(profile, wallet)
    session.add(profile)
    await session.commit()
    await session.refresh(profile)
    return _to_risk_response(user_id, profile)


@router.patch("/users/{user_id}/risk", response_model=RiskProfileResponse)
async def update_user_risk_profile(
    user_id: uuid.UUID,
    payload: RiskProfileUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> RiskProfileResponse:
    """Met à jour la politique de risque d'un utilisateur."""

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    wallet = await session.scalar(select(Wallet).where(Wallet.user_id == user_id))
    profile = await _ensure_profile(session, user_id, wallet)

    if payload.is_trading_active is not None:
        profile.is_trading_active = payload.is_trading_active
        if payload.is_trading_active:
            profile.risk_block_reason = None
        elif not profile.risk_block_reason:
            profile.risk_block_reason = "Kill switch manuel activé."

    if payload.max_orders_per_day is not None:
        profile.max_orders_per_day = payload.max_orders_per_day
    if payload.stop_loss_pct is not None:
        profile.stop_loss_pct = payload.stop_loss_pct.quantize(Decimal("0.01"))
    if payload.max_drawdown_pct is not None:
        profile.max_drawdown_pct = payload.max_drawdown_pct.quantize(Decimal("0.01"))

    if payload.reset_daily_counters:
        profile.orders_today = 0
        profile.cumulative_pnl_today = Decimal("0.00")
        profile.last_risk_reset_date = date.today()

    if wallet is not None:
        risk_manager.sync_daily_state(profile, wallet)

    session.add(profile)
    await log_audit_event(
        session,
        source="trading_api",
        event_type="risk_profile_updated",
        severity="info",
        message="Paramètres de risque utilisateur mis à jour.",
        user_id=user_id,
        payload={
            "is_trading_active": profile.is_trading_active,
            "max_orders_per_day": profile.max_orders_per_day,
            "stop_loss_pct": str(profile.stop_loss_pct),
            "max_drawdown_pct": str(profile.max_drawdown_pct),
        },
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    await session.refresh(profile)
    return _to_risk_response(user_id, profile)


@router.get("/engine/control", response_model=EngineControlSnapshotResponse)
async def get_engine_control_state(request: Request) -> EngineControlSnapshotResponse:
    """Retourne l'état runtime global du moteur."""

    engine = request.app.state.trading_engine
    snapshot = engine.control_snapshot()
    return EngineControlSnapshotResponse(
        is_running=engine.is_running,
        is_paused=snapshot["is_paused"],
        reason=snapshot["reason"],
        updated_at=snapshot["updated_at"],
    )


@router.patch("/engine/pause", response_model=EngineControlSnapshotResponse)
async def pause_engine(
    payload: EngineControlActionRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> EngineControlSnapshotResponse:
    """Met le moteur global en pause."""

    engine = request.app.state.trading_engine
    snapshot = engine.pause_engine(payload.reason or "Pause manuelle demandée.")
    await log_audit_event(
        session,
        source="trading_api",
        event_type="engine_paused_manual",
        severity="warning",
        message="Pause globale du moteur demandée par API.",
        payload={"reason": snapshot["reason"]},
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    return EngineControlSnapshotResponse(
        is_running=engine.is_running,
        is_paused=snapshot["is_paused"],
        reason=snapshot["reason"],
        updated_at=snapshot["updated_at"],
    )


@router.patch("/engine/resume", response_model=EngineControlSnapshotResponse)
async def resume_engine(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> EngineControlSnapshotResponse:
    """Relance le moteur global."""

    engine = request.app.state.trading_engine
    snapshot = engine.resume_engine()
    await log_audit_event(
        session,
        source="trading_api",
        event_type="engine_resumed_manual",
        severity="info",
        message="Reprise globale du moteur demandée par API.",
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    return EngineControlSnapshotResponse(
        is_running=engine.is_running,
        is_paused=snapshot["is_paused"],
        reason=snapshot["reason"],
        updated_at=snapshot["updated_at"],
    )


@router.get("/users/{user_id}/orders", response_model=list[SimulatedOrderResponse])
async def list_user_orders(
    user_id: uuid.UUID,
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> list[SimulatedOrderResponse]:
    """Retourne les derniers ordres simulés générés pour un utilisateur."""

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    result = await session.execute(
        select(SimulatedOrder)
        .where(SimulatedOrder.user_id == user_id)
        .order_by(desc(SimulatedOrder.created_at))
        .limit(limit)
    )
    orders = list(result.scalars().all())
    return [_to_order_response(order) for order in orders]


@router.get("/users/{user_id}/orders/stats", response_model=OrderStatsResponse)
async def get_user_order_stats(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> OrderStatsResponse:
    """Retourne un résumé du pipeline d'exécution broker pour un utilisateur."""

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    result = await session.execute(select(SimulatedOrder).where(SimulatedOrder.user_id == user_id))
    orders = list(result.scalars().all())

    pending_orders = sum(order.status == "pending" for order in orders)
    filled_orders = sum(order.status == "filled" for order in orders)
    rejected_orders = sum(order.status == "rejected" for order in orders)
    total_pnl_simule = sum((order.pnl_simule for order in orders), Decimal("0.00"))

    return OrderStatsResponse(
        user_id=user_id,
        total_orders=len(orders),
        pending_orders=pending_orders,
        filled_orders=filled_orders,
        rejected_orders=rejected_orders,
        total_pnl_simule=total_pnl_simule.quantize(Decimal("0.01")),
    )
