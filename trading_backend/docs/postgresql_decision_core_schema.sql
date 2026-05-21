-- =============================================================================
-- DDL PostgreSQL de référence : cœur décisionnel (préférences + signaux + trades)
-- Aligné sur les migrations Alembic 20260518_0001 et 20260520_0002.
-- Les types UUID utilisent l'extension ``pgcrypto`` (``gen_random_uuid()``).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------- 
-- users, wallets : socle (révision 0001)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'trader',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE INDEX IF NOT EXISTS ix_users_role ON users (role);

CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    solde_total NUMERIC(14, 2) NOT NULL,
    solde_disponible NUMERIC(14, 2) NOT NULL,
    solde_engage NUMERIC(14, 2) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_wallets_user_id ON wallets (user_id);

-- -----------------------------------------------------------------------------
-- user_preferences : filtres probabilité + secteurs + classes d'actifs (0002)
-- Nom logique métier User_Preferences ; nom physique user_preferences (snake_case)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    minimum_probability_threshold NUMERIC(5, 2) NOT NULL DEFAULT 70.00,
    enable_crypto BOOLEAN NOT NULL DEFAULT TRUE,
    enable_etf BOOLEAN NOT NULL DEFAULT TRUE,
    enable_stocks BOOLEAN NOT NULL DEFAULT TRUE,
    sector_tech BOOLEAN NOT NULL DEFAULT TRUE,
    sector_mines BOOLEAN NOT NULL DEFAULT TRUE,
    sector_real_estate BOOLEAN NOT NULL DEFAULT FALSE,
    sector_insurance BOOLEAN NOT NULL DEFAULT FALSE,
    sector_food BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_user_preferences_user_id ON user_preferences (user_id);

-- -----------------------------------------------------------------------------
-- market_signals : news scorées (0002)
-- Nom logique Market_Signals ; nom physique market_signals
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS market_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(64) NOT NULL,
    category VARCHAR(32) NOT NULL,
    news_text TEXT NOT NULL,
    mapped_sector VARCHAR(32) NOT NULL,
    sentiment_polarity VARCHAR(16) NOT NULL,
    source_confidence NUMERIC(5, 2) NOT NULL,
    probability_bullish NUMERIC(5, 2) NOT NULL,
    probability_bearish NUMERIC(5, 2) NOT NULL,
    signal_strength NUMERIC(5, 2) NOT NULL,
    is_valid_signal BOOLEAN NOT NULL DEFAULT FALSE,
    time_to_live_minutes INTEGER NOT NULL DEFAULT 60,
    expires_at TIMESTAMPTZ NOT NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_market_signals_source ON market_signals (source);
CREATE INDEX IF NOT EXISTS ix_market_signals_category ON market_signals (category);
CREATE INDEX IF NOT EXISTS ix_market_signals_mapped_sector ON market_signals (mapped_sector);
CREATE INDEX IF NOT EXISTS ix_market_signals_signal_strength ON market_signals (signal_strength);
CREATE INDEX IF NOT EXISTS ix_market_signals_is_valid_signal ON market_signals (is_valid_signal);
CREATE INDEX IF NOT EXISTS ix_market_signals_expires_at ON market_signals (expires_at);
CREATE INDEX IF NOT EXISTS ix_market_signals_created_at ON market_signals (created_at);

-- -----------------------------------------------------------------------------
-- active_trades : positions ouvertes liées à un signal (0002)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS active_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    market_signal_id UUID NULL REFERENCES market_signals (id) ON DELETE SET NULL,
    asset_class VARCHAR(16) NOT NULL,
    sector VARCHAR(32) NOT NULL,
    direction VARCHAR(16) NOT NULL,
    probability_used NUMERIC(5, 2) NOT NULL,
    capital_engaged NUMERIC(14, 2) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'open',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    estimated_duration_minutes INTEGER NOT NULL,
    planned_close_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ NULL,
    close_reason VARCHAR(255) NULL
);

CREATE INDEX IF NOT EXISTS ix_active_trades_user_id ON active_trades (user_id);
CREATE INDEX IF NOT EXISTS ix_active_trades_market_signal_id ON active_trades (market_signal_id);
CREATE INDEX IF NOT EXISTS ix_active_trades_asset_class ON active_trades (asset_class);
CREATE INDEX IF NOT EXISTS ix_active_trades_sector ON active_trades (sector);
CREATE INDEX IF NOT EXISTS ix_active_trades_status ON active_trades (status);
