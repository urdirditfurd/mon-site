"""Routes API — courtiers et exécution automatique."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_session
from app.schemas.broker import (
    ApproveOrderRequest,
    BrokerAccountResponse,
    BrokerConnectRequest,
    ExchangeInfoResponse,
    StageOrderRequest,
    StagedOrderResponse,
)
from app.services.broker.adapter import test_connection
from app.services.broker.exchanges import list_exchanges_for_ui
from app.services.execution_engine import ExecutionEngine

router = APIRouter(prefix="/api/broker", tags=["broker"])


def _to_staged(o) -> StagedOrderResponse:
    return StagedOrderResponse(
        id=o.id,
        symbol=o.symbol,
        asset_type=o.asset_type,
        side=o.side,
        amount_usd=o.amount_usd,
        price_at_stage=o.price_at_stage,
        probability=o.probability,
        status=o.status,
        commit_message=o.commit_message,
        signal_reason=o.signal_reason,
        staged_at=o.staged_at,
        external_order_id=o.external_order_id,
        error_message=o.error_message,
    )


@router.get("/exchanges", response_model=list[ExchangeInfoResponse])
async def list_exchanges() -> list[ExchangeInfoResponse]:
    return list_exchanges_for_ui()


@router.post("/test-connection")
async def broker_test_connection(body: BrokerConnectRequest) -> dict:
    return await test_connection(
        body.exchange_id,
        body.api_key,
        body.api_secret,
        body.passphrase,
        body.mode,
    )


@router.post("/connect", response_model=BrokerAccountResponse)
async def connect_broker(
    body: BrokerConnectRequest,
    session: AsyncSession = Depends(get_session),
) -> BrokerAccountResponse:
    test = await test_connection(
        body.exchange_id, body.api_key, body.api_secret, body.passphrase, body.mode
    )
    if not test.get("ok"):
        raise HTTPException(status_code=400, detail=test.get("error", "Connexion échouée"))

    engine = ExecutionEngine(session)
    try:
        account = await engine.connect_broker(
            body.exchange_id,
            body.api_key,
            body.api_secret,
            passphrase=body.passphrase,
            label=body.label,
            mode=body.mode,
            user_alias=body.user_alias,
            max_order_usd=body.max_order_usd,
            auto_execute=body.auto_execute,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return BrokerAccountResponse(
        id=account.id,
        exchange_id=account.exchange_id,
        label=account.label,
        mode=account.mode,
        is_active=account.is_active,
        auto_execute=account.auto_execute,
        max_order_usd=account.max_order_usd,
        created_at=account.created_at,
    )


@router.get("/accounts", response_model=list[BrokerAccountResponse])
async def list_accounts(
    user_alias: str = "default",
    session: AsyncSession = Depends(get_session),
) -> list[BrokerAccountResponse]:
    engine = ExecutionEngine(session)
    accounts = await engine.list_brokers(user_alias)
    return [
        BrokerAccountResponse(
            id=a.id,
            exchange_id=a.exchange_id,
            label=a.label,
            mode=a.mode,
            is_active=a.is_active,
            auto_execute=a.auto_execute,
            max_order_usd=a.max_order_usd,
            created_at=a.created_at,
        )
        for a in accounts
    ]


@router.post("/orders/stage", response_model=StagedOrderResponse)
async def stage_order(
    body: StageOrderRequest,
    session: AsyncSession = Depends(get_session),
) -> StagedOrderResponse:
    engine = ExecutionEngine(session)
    order = await engine.stage_order(
        body.symbol,
        body.side,
        body.amount_usd,
        user_alias=body.user_alias,
        broker_id=body.broker_id,
        commit_message=body.commit_message,
    )
    if not order:
        raise HTTPException(status_code=400, detail="Impossible de préparer l'ordre")
    return _to_staged(order)


@router.get("/orders/pending", response_model=list[StagedOrderResponse])
async def pending_orders(
    user_alias: str = "default",
    session: AsyncSession = Depends(get_session),
) -> list[StagedOrderResponse]:
    engine = ExecutionEngine(session)
    orders = await engine.list_staged(user_alias)
    return [_to_staged(o) for o in orders]


@router.get("/orders/history", response_model=list[StagedOrderResponse])
async def order_history(
    user_alias: str = "default",
    session: AsyncSession = Depends(get_session),
) -> list[StagedOrderResponse]:
    engine = ExecutionEngine(session)
    orders = await engine.list_history(user_alias)
    return [_to_staged(o) for o in orders]


@router.post("/orders/{order_id}/approve", response_model=StagedOrderResponse)
async def approve_order(
    order_id: str,
    body: ApproveOrderRequest,
    session: AsyncSession = Depends(get_session),
) -> StagedOrderResponse:
    engine = ExecutionEngine(session)
    order = await engine.approve_and_execute(order_id, body.commit_message)
    if not order:
        raise HTTPException(status_code=404, detail="Ordre introuvable ou déjà traité")
    return _to_staged(order)


@router.post("/orders/{order_id}/reject", response_model=StagedOrderResponse)
async def reject_order(
    order_id: str,
    session: AsyncSession = Depends(get_session),
) -> StagedOrderResponse:
    engine = ExecutionEngine(session)
    order = await engine.reject_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Ordre introuvable")
    return _to_staged(order)


@router.get("/settings")
async def broker_settings() -> dict:
    return {
        "allow_live_trading": settings.allow_live_trading,
        "max_order_usd": settings.max_order_usd,
        "default_mode": settings.default_broker_mode,
        "france_notice": (
            "Binance ferme en France. Recommandé : Kraken (PSAN AMF) ou Bitget. "
            "Commencez toujours en mode paper/testnet."
        ),
    }
