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
    news_interval_seconds: int = int(os.getenv("NEWS_INTERVAL_SECONDS", "5"))
    runtime_recovery_delay_seconds: int = int(os.getenv("RUNTIME_RECOVERY_DELAY_SECONDS", "2"))
    run_migrations_on_startup: bool = os.getenv("RUN_MIGRATIONS_ON_STARTUP", "false").lower() == "true"
    watchdog_interval_seconds: int = int(os.getenv("WATCHDOG_INTERVAL_SECONDS", "10"))
    trade_lifecycle_poll_seconds: int = int(os.getenv("TRADE_LIFECYCLE_POLL_SECONDS", "30"))
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    log_file_path: str = os.getenv("LOG_FILE_PATH", "storage/logs/trading-backend.log")
    log_max_bytes: int = int(os.getenv("LOG_MAX_BYTES", "2097152"))
    log_backup_count: int = int(os.getenv("LOG_BACKUP_COUNT", "5"))


settings = Settings()
