"""Configuration partagée pour la suite de tests pytest.

Cette configuration isole les tests du backend Postgres réel en redirigeant
``DATABASE_URL`` vers une instance SQLite asynchrone éphémère avant tout
import du module ``app``.  L'utilisation d'un fichier temporaire (plutôt que
``:memory:``) garantit qu'une même base est partagée entre toutes les
connexions ouvertes par les sessions asynchrones successives sans dépendre
d'un pool partagé non standard.

Trois fixtures publiques sont exposées :

``configured_database``
    Initialise le schéma SQLAlchemy ``Base.metadata`` sur la base SQLite,
    rebascule le ``AsyncSessionLocal`` partagé et remet la base à zéro entre
    chaque test (portée *function*).
``session_factory``
    Renvoie la ``async_sessionmaker`` reliée à la base de test, utilisable
    aussi bien par les tests que par les fixtures applicatives.
``trader_profile``
    Provisionne un utilisateur actif, son portefeuille interne crédité et
    ses préférences sectorielles par défaut, prêt à être consommé par les
    tests fonctionnels du moteur de décision.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from decimal import Decimal
from pathlib import Path
from typing import AsyncIterator, Iterator

import pytest
import pytest_asyncio


# ---------------------------------------------------------------------------
# Override environnement AVANT tout import applicatif.
# ``app.core.config.Settings`` lit les variables d'environnement à l'import,
# et ``app.db.database`` instancie l'engine à l'import également.  Nous
# devons donc orienter la configuration vers SQLite avant que pytest ne
# collecte les tests qui dépendent de ``app.*``.
# ---------------------------------------------------------------------------

_DB_FILE_HANDLE = tempfile.NamedTemporaryFile(  # noqa: SIM115 - durée de vie = session pytest
    prefix="trading_ai_test_",
    suffix=".sqlite",
    delete=False,
)
_DB_FILE_HANDLE.close()
_DB_FILE_PATH = Path(_DB_FILE_HANDLE.name)

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB_FILE_PATH}"
os.environ["AUTO_CREATE_TABLES"] = "true"
os.environ["DEBUG"] = "false"
os.environ["RUN_MIGRATIONS_ON_STARTUP"] = "false"


# Imports applicatifs réalisés après l'override des variables d'environnement.
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.db import database as database_module  # noqa: E402
from app.db.database import Base  # noqa: E402
from app.models import (  # noqa: E402,F401  (import requis pour enregistrer le metadata)
    active_trade,
    alert_event,
    audit_event,
    market_signal,
    simulated_order,
    trading_profile,
    user,
    user_preference,
    wallet,
)
from app.models.user import User  # noqa: E402
from app.models.user_preference import UserPreference  # noqa: E402
from app.models.wallet import Wallet  # noqa: E402
from app.services import decision_engine as decision_engine_module  # noqa: E402


# ---------------------------------------------------------------------------
# Engine SQLite asynchrone dédié aux tests.
# ---------------------------------------------------------------------------

_test_engine = create_async_engine(
    os.environ["DATABASE_URL"],
    echo=False,
    future=True,
)
_test_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    _test_engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:  # noqa: ARG001
    """Force le mode ``asyncio`` strict sur tous les tests sans décorateur explicite."""

    for item in items:
        if item.get_closest_marker("asyncio") is None and "async" in item.name:
            item.add_marker(pytest.mark.asyncio)


@pytest_asyncio.fixture(scope="function", autouse=True)
async def configured_database() -> AsyncIterator[None]:
    """Recrée le schéma et rebascule ``AsyncSessionLocal`` pour chaque test."""

    database_module.engine = _test_engine
    database_module.AsyncSessionLocal = _test_session_factory
    decision_engine_module.AsyncSessionLocal = _test_session_factory

    async with _test_engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)

    try:
        yield
    finally:
        async with _test_engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)


@pytest.fixture(scope="session")
def session_factory() -> async_sessionmaker[AsyncSession]:
    """Expose la ``async_sessionmaker`` de test pour les fixtures spécialisées."""

    return _test_session_factory


@pytest.fixture(scope="session", autouse=True)
def _cleanup_sqlite_tempfile() -> Iterator[None]:
    """Supprime le fichier SQLite temporaire en fin de session."""

    yield
    try:
        _DB_FILE_PATH.unlink(missing_ok=True)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Fixtures fonctionnelles : profil utilisateur de test.
# ---------------------------------------------------------------------------


class TraderProfile:
    """Conteneur de données pour un utilisateur de test prêt à trader."""

    __slots__ = ("user_id", "wallet_id", "preference_id")

    def __init__(self, user_id: uuid.UUID, wallet_id: uuid.UUID, preference_id: uuid.UUID) -> None:
        self.user_id = user_id
        self.wallet_id = wallet_id
        self.preference_id = preference_id


@pytest_asyncio.fixture
async def trader_profile(
    session_factory: async_sessionmaker[AsyncSession],
) -> TraderProfile:
    """Crée un utilisateur actif + wallet crédité + préférences par défaut."""

    async with session_factory() as session:
        new_user = User(
            email=f"trader_{uuid.uuid4().hex[:8]}@trading.ia",
            password_hash="hashed-placeholder",
            role="trader",
            is_active=True,
        )
        session.add(new_user)
        await session.flush()

        new_wallet = Wallet(
            user_id=new_user.id,
            solde_total=Decimal("10000.00"),
            solde_disponible=Decimal("10000.00"),
            solde_engage=Decimal("0.00"),
        )
        session.add(new_wallet)

        preference = UserPreference(
            user_id=new_user.id,
            minimum_probability_threshold=Decimal("70.00"),
            enable_crypto=True,
            enable_etf=True,
            enable_stocks=True,
            sector_tech=True,
            sector_mines=True,
            sector_real_estate=False,
            sector_insurance=False,
            sector_food=False,
        )
        session.add(preference)
        await session.commit()
        await session.refresh(new_user)
        await session.refresh(new_wallet)
        await session.refresh(preference)

        return TraderProfile(
            user_id=new_user.id,
            wallet_id=new_wallet.id,
            preference_id=preference.id,
        )
