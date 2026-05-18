"""Point d'entrée FastAPI du backend de trading."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.news_routes import router as news_router
from app.api.user_routes import router as user_router
from app.api.wallet_routes import router as wallet_router
from app.core.config import settings
from app.db.database import close_db, init_db
from app.services.news_simulator import NewsSimulator


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise les composants partagés (DB + simulateur)."""

    await init_db()

    simulator = NewsSimulator(interval_seconds=5)
    app.state.news_simulator = simulator
    await simulator.start()

    try:
        yield
    finally:
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


@app.get("/api/health", tags=["Health"])
async def healthcheck() -> dict[str, str]:
    """Endpoint de vérification de disponibilité."""

    return {"status": "ok"}
