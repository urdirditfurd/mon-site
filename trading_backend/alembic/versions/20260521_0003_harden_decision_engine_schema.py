"""Harden decision engine schema constraints.

Revision ID: 20260521_0003
Revises: 20260520_0002
Create Date: 2026-05-21 07:19:00
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
    op.alter_column(
        "market_signals",
        "category",
        existing_type=sa.String(length=32),
        type_=sa.String(length=64),
        existing_nullable=False,
    )
    op.create_check_constraint(
        "ck_user_preferences_threshold_percent",
        "user_preferences",
        "minimum_probability_threshold >= 0 AND minimum_probability_threshold <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_source_confidence_percent",
        "market_signals",
        "source_confidence >= 0 AND source_confidence <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_bullish_percent",
        "market_signals",
        "probability_bullish >= 0 AND probability_bullish <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_bearish_percent",
        "market_signals",
        "probability_bearish >= 0 AND probability_bearish <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_strength_percent",
        "market_signals",
        "signal_strength >= 0 AND signal_strength <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_positive_ttl",
        "market_signals",
        "time_to_live_minutes > 0",
    )
    op.create_check_constraint(
        "ck_active_trades_non_negative_capital",
        "active_trades",
        "capital_engaged >= 0",
    )
    op.create_check_constraint(
        "ck_active_trades_positive_duration",
        "active_trades",
        "estimated_duration_minutes > 0",
    )
    op.create_check_constraint(
        "ck_active_trades_probability_percent",
        "active_trades",
        "probability_used >= 0 AND probability_used <= 100",
    )
    op.create_check_constraint(
        "ck_active_trades_status",
        "active_trades",
        "status IN ('open', 'closed')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_active_trades_status", "active_trades", type_="check")
    op.drop_constraint("ck_active_trades_probability_percent", "active_trades", type_="check")
    op.drop_constraint("ck_active_trades_positive_duration", "active_trades", type_="check")
    op.drop_constraint("ck_active_trades_non_negative_capital", "active_trades", type_="check")
    op.drop_constraint("ck_market_signals_positive_ttl", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_strength_percent", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_bearish_percent", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_bullish_percent", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_source_confidence_percent", "market_signals", type_="check")
    op.drop_constraint("ck_user_preferences_threshold_percent", "user_preferences", type_="check")
    op.alter_column(
        "market_signals",
        "category",
        existing_type=sa.String(length=64),
        type_=sa.String(length=32),
        existing_nullable=False,
    )
