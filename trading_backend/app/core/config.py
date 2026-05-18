"""Configuration centrale de l'application FastAPI."""

from __future__ import annotations

import os


class Settings:
    """Expose les variables d'environnement avec valeurs par défaut."""

    app_name: str = os.getenv("APP_NAME", "Trading IA Backend")
    app_version: str = os.getenv("APP_VERSION", "0.1.0")
    debug: bool = os.getenv("DEBUG", "false").lower() == "true"
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/trading_ai",
    )
    auth_secret_key: str = os.getenv("AUTH_SECRET_KEY", "change-me-in-production")
    auth_token_expiry_minutes: int = int(os.getenv("AUTH_TOKEN_EXPIRY_MINUTES", "120"))
    auto_create_tables: bool = os.getenv("AUTO_CREATE_TABLES", "false").lower() == "true"


settings = Settings()
