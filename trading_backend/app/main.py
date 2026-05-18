"""Point d'entrée FastAPI du backend de trading."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.monitoring_routes import router as monitoring_router
from app.api.news_routes import router as news_router
from app.api.trading_routes import router as trading_router
from app.api.user_routes import router as user_router
from app.api.wallet_routes import router as wallet_router
from app.core.config import settings
from app.db.database import AsyncSessionLocal, close_db, init_db
from app.services.monitoring_hub import MonitoringHub
from app.services.news_simulator import NewsSimulator
from app.services.trading_engine import TradingEngine


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise les composants partagés (DB + simulateur)."""

    await init_db()

    monitoring_hub = MonitoringHub()
    app.state.monitoring_hub = monitoring_hub

    simulator = NewsSimulator(interval_seconds=5)
    app.state.news_simulator = simulator
    await simulator.start()

    trading_engine = TradingEngine(
        news_simulator=simulator,
        session_factory=AsyncSessionLocal,
        monitoring_hub=monitoring_hub,
    )
    app.state.trading_engine = trading_engine
    await trading_engine.start()

    try:
        yield
    finally:
        await trading_engine.stop()
        await simulator.stop()
        await close_db()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.debug,
    lifespan=lifespan,
)

app.include_router(user_router, prefix="/api")
app.include_router(wallet_router, prefix="/api")
app.include_router(news_router, prefix="/api")
app.include_router(trading_router, prefix="/api")
app.include_router(monitoring_router, prefix="/api")


@app.get("/api/health", tags=["Health"])
async def healthcheck() -> dict[str, str]:
    """Endpoint de vérification de disponibilité."""

    return {"status": "ok"}
