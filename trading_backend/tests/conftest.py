"""Fixtures pytest pour les tests du moteur de décision."""

from __future__ import annotations

import os
import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import hash_password
from app.db.database import Base
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/trading_ai",
)


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    """Session async isolée ; rollback en fin de test."""

    engine = create_async_engine(DATABASE_URL, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception as exc:
        await engine.dispose()
        pytest.skip(f"PostgreSQL indisponible pour les tests d'intégration: {exc}")

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with session_factory() as session:
        yield session
        await session.rollback()

    await engine.dispose()


@pytest_asyncio.fixture
async def trader_with_wallet(db_session: AsyncSession) -> tuple[User, Wallet, UserPreference]:
    """Utilisateur actif avec wallet et préférences sectorielles."""

    user = User(
        id=uuid.uuid4(),
        email=f"test-{uuid.uuid4().hex[:8]}@decision-engine.local",
        password_hash=hash_password("TestPassword!2026"),
        role="trader",
        is_active=True,
    )
    wallet = Wallet(
        user_id=user.id,
        solde_total=Decimal("10000.00"),
        solde_disponible=Decimal("5000.00"),
        solde_engage=Decimal("0.00"),
    )
    preference = UserPreference(
        user_id=user.id,
        minimum_probability_threshold=Decimal("75.00"),
        enable_crypto=True,
        enable_etf=True,
        enable_stocks=True,
        sector_tech=True,
        sector_mines=True,
        sector_real_estate=False,
        sector_insurance=False,
        sector_food=False,
    )
    db_session.add_all([user, wallet, preference])
    await db_session.flush()
    return user, wallet, preference
