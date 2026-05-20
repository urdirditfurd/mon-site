"""Configuration Alembic pour les migrations SQLAlchemy async."""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import settings
from app.db.database import Base

# Import explicite des modèles pour autogenerate.
from app.models import (  # noqa: F401
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

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata
CONNECT_RETRIES = int(os.getenv("ALEMBIC_DB_CONNECT_RETRIES", "5"))
CONNECT_RETRY_DELAY_SECONDS = float(os.getenv("ALEMBIC_DB_CONNECT_RETRY_DELAY_SECONDS", "1.5"))


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""

    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Run migrations synchronously through provided connection."""

    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode with async engine."""

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    try:
        for attempt in range(1, CONNECT_RETRIES + 1):
            try:
                async with connectable.connect() as connection:
                    await connection.run_sync(do_run_migrations)
                return
            except Exception as exc:
                if attempt >= CONNECT_RETRIES:
                    raise
                wait_seconds = CONNECT_RETRY_DELAY_SECONDS * attempt
                config.print_stdout(
                    f"[alembic] database connect attempt {attempt}/{CONNECT_RETRIES} failed: {exc}. "
                    f"Retrying in {wait_seconds:.1f}s."
                )
                await asyncio.sleep(wait_seconds)
    finally:
        await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
