"""Harden decision engine schema with asset_class and check constraints.

Revision ID: 20260521_0003
Revises: 20260520_0002
Create Date: 2026-05-21 07:45:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260521_0003"
down_revision = "20260520_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("market_signals", sa.Column("asset_class", sa.String(length=16), nullable=True))
    op.execute(
        """
        UPDATE market_signals
        SET asset_class = CASE
            WHEN lower(category) LIKE '%crypto%' OR lower(category) LIKE '%binance%' OR lower(category) LIKE '%coinbase%' THEN 'crypto'
            WHEN lower(category) LIKE '%etf%' THEN 'etf'
            ELSE 'stocks'
        END
        """
    )
    op.alter_column("market_signals", "asset_class", nullable=False)
    op.create_index("ix_market_signals_asset_class", "market_signals", ["asset_class"], unique=False)
    op.create_index(
        "ix_market_signals_valid_signal_window",
        "market_signals",
        ["is_valid_signal", "expires_at", "signal_strength"],
        unique=False,
    )

    op.create_check_constraint(
        "ck_user_preferences_threshold_range",
        "user_preferences",
        "minimum_probability_threshold >= 0 AND minimum_probability_threshold <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_source_confidence_range",
        "market_signals",
        "source_confidence >= 0 AND source_confidence <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_probability_bullish_range",
        "market_signals",
        "probability_bullish >= 0 AND probability_bullish <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_probability_bearish_range",
        "market_signals",
        "probability_bearish >= 0 AND probability_bearish <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_signal_strength_range",
        "market_signals",
        "signal_strength >= 0 AND signal_strength <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_ttl_positive",
        "market_signals",
        "time_to_live_minutes > 0",
    )
    op.create_check_constraint(
        "ck_active_trades_probability_used_range",
        "active_trades",
        "probability_used >= 0 AND probability_used <= 100",
    )
    op.create_check_constraint(
        "ck_active_trades_capital_positive",
        "active_trades",
        "capital_engaged > 0",
    )
    op.create_check_constraint(
        "ck_active_trades_duration_positive",
        "active_trades",
        "estimated_duration_minutes > 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_active_trades_duration_positive", "active_trades", type_="check")
    op.drop_constraint("ck_active_trades_capital_positive", "active_trades", type_="check")
    op.drop_constraint("ck_active_trades_probability_used_range", "active_trades", type_="check")
    op.drop_constraint("ck_market_signals_ttl_positive", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_signal_strength_range", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_probability_bearish_range", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_probability_bullish_range", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_source_confidence_range", "market_signals", type_="check")
    op.drop_constraint("ck_user_preferences_threshold_range", "user_preferences", type_="check")

    op.drop_index("ix_market_signals_valid_signal_window", table_name="market_signals")
    op.drop_index("ix_market_signals_asset_class", table_name="market_signals")
    op.drop_column("market_signals", "asset_class")
