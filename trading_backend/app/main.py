"""Point d'entrée FastAPI du backend de trading."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.api.auth_routes import router as auth_router
from app.api.decision_routes import router as decision_router
from app.api.monitoring_routes import router as monitoring_router
from app.api.news_routes import router as news_router
from app.api.reporting_routes import router as reporting_router
from app.api.trading_routes import router as trading_router
from app.api.ui_routes import router as ui_router
from app.api.user_routes import router as user_router
from app.api.wallet_routes import router as wallet_router
from app.core.config import get_apple_client_id, get_google_client_id, settings
from app.core.logging_config import configure_logging
from app.db.database import AsyncSessionLocal, check_db_connection, close_db, init_db
from app.services.monitoring_hub import MonitoringHub
from app.services.news_feed_hub import NewsFeedHub
from app.services.news_simulator import NewsSimulator
from app.services.rss_news import RssNewsIngester, parse_feed_specs
from app.services.telegram_news import TelegramNewsIngester
from app.services.trading_engine import TradingEngine

configure_logging()
logger = logging.getLogger(__name__)


async def _watchdog_loop(app: FastAPI) -> None:
    """Surveille simulateur et moteur, et relance si besoin."""

    while True:
        try:
            simulator = app.state.news_simulator
            engine = app.state.trading_engine

            if not simulator.is_running:
                logger.error("Watchdog: simulateur news arrêté, tentative de relance.")
                await simulator.start()
                app.state.monitoring_hub.publish_event(
                    channel="watchdog",
                    event_type="news_simulator_restarted",
                    severity="critical",
                    message="Watchdog: simulateur news redémarré.",
                )

            if not engine.is_running:
                logger.error("Watchdog: trading engine arrêté, tentative de relance.")
                await engine.start()
                app.state.monitoring_hub.publish_event(
                    channel="watchdog",
                    event_type="trading_engine_restarted",
                    severity="critical",
                    message="Watchdog: trading engine redémarré.",
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Watchdog loop error: %s", exc)
        await asyncio.sleep(settings.watchdog_interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise les composants partagés (DB + simulateur)."""

    await init_db()

    monitoring_hub = MonitoringHub()
    app.state.monitoring_hub = monitoring_hub

    simulator = NewsSimulator(
        interval_seconds=settings.news_interval_seconds,
        recovery_delay_seconds=settings.runtime_recovery_delay_seconds,
    )
    app.state.news_simulator = simulator

    telegram_channel = settings.telegram_channel_username if settings.telegram_news_enabled else ""
    telegram_ingester = TelegramNewsIngester(
        channel_username=telegram_channel,
        poll_seconds=settings.telegram_news_poll_seconds,
        recovery_delay_seconds=settings.runtime_recovery_delay_seconds,
    )
    rss_feeds = parse_feed_specs(settings.news_rss_feeds) if settings.news_rss_enabled else []
    rss_ingester = RssNewsIngester(
        feed_specs=rss_feeds,
        poll_seconds=settings.news_rss_poll_seconds,
        recovery_delay_seconds=settings.runtime_recovery_delay_seconds,
    )
    news_feed_hub = NewsFeedHub(simulator=simulator, rss=rss_ingester, telegram=telegram_ingester)
    app.state.news_feed_hub = news_feed_hub
    await news_feed_hub.start()
    if settings.news_rss_enabled:
        logger.info("Flux RSS activé (%s sources).", len(rss_feeds))
    if telegram_channel:
        logger.info("Flux Telegram activé pour @%s", telegram_channel)
    if not settings.news_rss_enabled and not telegram_channel:
        logger.info("RSS/Telegram désactivés — simulateur d'actualités actif.")

    trading_engine = TradingEngine(
        news_simulator=simulator,
        session_factory=AsyncSessionLocal,
        monitoring_hub=monitoring_hub,
        recovery_delay_seconds=settings.runtime_recovery_delay_seconds,
    )
    app.state.trading_engine = trading_engine
    await trading_engine.start()

    watchdog_task = asyncio.create_task(_watchdog_loop(app), name="runtime-watchdog-loop")
    app.state.watchdog_task = watchdog_task

    logger.info("Application startup complete with watchdog active.")

    try:
        yield
    finally:
        watchdog_task.cancel()
        try:
            await watchdog_task
        except asyncio.CancelledError:
            pass
        await trading_engine.stop()
        await news_feed_hub.stop()
        await close_db()
        logger.info("Application shutdown complete.")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.debug,
    lifespan=lifespan,
)

app.include_router(ui_router)
app.include_router(user_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(wallet_router, prefix="/api")
app.include_router(news_router, prefix="/api")
app.include_router(trading_router, prefix="/api")
app.include_router(decision_router, prefix="/api")
app.include_router(monitoring_router, prefix="/api")
app.include_router(reporting_router, prefix="/api")


@app.get("/api/auth/public-config", tags=["Auth"])
async def public_auth_config() -> dict[str, str | bool | int | None]:
    """
    Config OAuth publique (déclarée ici pour survivre aux hot-deploy sans purge __pycache__).
    """

    google_id = get_google_client_id() or None
    return {
        "google_client_id": google_id,
        "google_enabled": bool(google_id),
        "apple_enabled": bool(get_apple_client_id()),
        "min_password_length": 8,
    }


@app.get("/api/health", tags=["Health"])
async def healthcheck() -> dict[str, str]:
    """Endpoint de vérification de disponibilité."""

    return {"status": "ok"}


@app.get("/api/health/live", tags=["Health"])
async def liveness() -> dict[str, str]:
    """Probe liveness: le process HTTP est bien vivant."""

    return {"status": "alive"}


@app.get("/api/health/ready", tags=["Health"])
async def readiness():
    """Probe readiness: DB + services runtime prêts."""

    db_ok = await check_db_connection()
    simulator_snapshot = app.state.news_simulator.health_snapshot()
    engine_snapshot = app.state.trading_engine.health_snapshot()

    ready = db_ok and simulator_snapshot["running"] and engine_snapshot["running"]
    payload = {
        "status": "ready" if ready else "degraded",
        "database_ok": db_ok,
        "news_simulator": simulator_snapshot,
        "trading_engine": engine_snapshot,
    }
    if ready:
        return payload

    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content=jsonable_encoder(payload),
    )


@app.get("/api/health/runtime", tags=["Health"])
async def runtime_health() -> dict:
    """Retourne le détail runtime pour supervision."""

    return {
        "news_simulator": app.state.news_simulator.health_snapshot(),
        "trading_engine": app.state.trading_engine.health_snapshot(),
        "watchdog_running": bool(app.state.watchdog_task and not app.state.watchdog_task.done()),
    }
