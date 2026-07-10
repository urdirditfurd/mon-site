"""Point d'entrée FastAPI — AutoTrading Lemon MVP."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router as api_router
from app.core.config import settings
from app.db.database import init_db
from app.services.scanner import RuntimeScheduler

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

runtime_scheduler = RuntimeScheduler()

WEB_DIR = Path(__file__).resolve().parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI):
    data_dir = Path("data")
    data_dir.mkdir(parents=True, exist_ok=True)
    await init_db()
    await runtime_scheduler.start()
    logger.info("%s v%s démarré", settings.app_name, settings.app_version)
    yield
    await runtime_scheduler.stop()
    logger.info("Arrêt propre effectué")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Analyse marché mondial + recommandations pour débutants (MVP Lemon)",
    lifespan=lifespan,
)

app.include_router(api_router)

if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/")
async def root():
    index = WEB_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"message": "AutoTrading Lemon API", "docs": "/docs"}
