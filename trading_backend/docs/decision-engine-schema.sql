-- Schéma PostgreSQL — coeur algorithmique (mission 1)

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'trader',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    solde_total NUMERIC(14, 2) NOT NULL,
    solde_disponible NUMERIC(14, 2) NOT NULL,
    solde_engage NUMERIC(14, 2) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS market_signals (
    id UUID PRIMARY KEY,
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
    metadata_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS active_trades (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_signal_id UUID REFERENCES market_signals(id) ON DELETE SET NULL,
    asset_class VARCHAR(16) NOT NULL,
    sector VARCHAR(32) NOT NULL,
    direction VARCHAR(16) NOT NULL,
    probability_used NUMERIC(5, 2) NOT NULL,
    capital_engaged NUMERIC(14, 2) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'open',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    estimated_duration_minutes INTEGER NOT NULL,
    planned_close_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    close_reason VARCHAR(255)
);
