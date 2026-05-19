"""Gestion de la connexion PostgreSQL via SQLAlchemy Async."""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    """Classe de base commune pour tous les modèles SQLAlchemy."""


engine = create_async_engine(settings.database_url, echo=settings.debug, future=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency FastAPI pour obtenir une session DB."""
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    """Initialise le metadata SQLAlchemy (optionnel create_all en local)."""
    # Import tardif pour s'assurer que les modèles sont bien enregistrés.
    from app.models import alert_event, audit_event, simulated_order, trading_profile, user, wallet  # noqa: F401

    if settings.auto_create_tables:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """Ferme proprement le pool de connexions."""
    await engine.dispose()


async def check_db_connection() -> bool:
    """Vérifie que la base répond à une requête simple."""

    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
