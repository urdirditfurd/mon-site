"""Configuration centrale — variables d'environnement avec valeurs par défaut."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "AutoTrading Lemon"
    app_version: str = "0.1.0-lemon"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8100

    database_url: str = "sqlite+aiosqlite:///./data/autotrading.db"

    market_scan_interval_seconds: int = 300
    position_check_interval_seconds: int = 60
    watchdog_interval_seconds: int = 30

    min_buy_probability: float = 62.0
    min_sell_probability_drop: float = 45.0
    default_take_profit_pct: float = 8.0
    default_stop_loss_pct: float = 4.0

    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    api_secret_key: str = "change-me-in-production-lemon"

    # Courtiers — sécurité
    allow_live_trading: bool = False
    max_order_usd: float = 500.0
    default_broker_mode: str = "paper"
    auto_stage_on_signal: bool = False


settings = Settings()
