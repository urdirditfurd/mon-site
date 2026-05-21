"""Harden decision-engine tables with production constraints.

Revision ID: 20260521_0003
Revises: 20260520_0002
Create Date: 2026-05-21 07:35:00
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260521_0003"
down_revision = "20260520_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
        "ck_market_signals_bullish_range",
        "market_signals",
        "probability_bullish >= 0 AND probability_bullish <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_bearish_range",
        "market_signals",
        "probability_bearish >= 0 AND probability_bearish <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_strength_range",
        "market_signals",
        "signal_strength >= 0 AND signal_strength <= 100",
    )
    op.create_check_constraint(
        "ck_market_signals_ttl_positive",
        "market_signals",
        "time_to_live_minutes > 0",
    )
    op.create_check_constraint(
        "ck_active_trades_probability_range",
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
    op.drop_constraint("ck_active_trades_probability_range", "active_trades", type_="check")
    op.drop_constraint("ck_market_signals_ttl_positive", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_strength_range", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_bearish_range", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_bullish_range", "market_signals", type_="check")
    op.drop_constraint("ck_market_signals_source_confidence_range", "market_signals", type_="check")
    op.drop_constraint("ck_user_preferences_threshold_range", "user_preferences", type_="check")
