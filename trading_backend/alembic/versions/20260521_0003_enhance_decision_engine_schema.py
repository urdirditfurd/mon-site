"""Enhance user_preferences and market_signals for production decision engine.

Adds energy sector toggle, position control columns to user_preferences.
Adds asset_class and direction columns to market_signals.

Revision ID: 20260521_0003
Revises: 20260520_0002
Create Date: 2026-05-21 07:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260521_0003"
down_revision = "20260520_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_preferences",
        sa.Column("sector_energy", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "user_preferences",
        sa.Column("max_concurrent_trades", sa.Integer(), nullable=False, server_default=sa.text("5")),
    )
    op.add_column(
        "user_preferences",
        sa.Column(
            "capital_allocation_pct",
            sa.Numeric(precision=5, scale=2),
            nullable=False,
            server_default=sa.text("20.00"),
        ),
    )

    op.add_column(
        "market_signals",
        sa.Column(
            "asset_class",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'stocks'"),
        ),
    )
    op.add_column(
        "market_signals",
        sa.Column(
            "direction",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'hold'"),
        ),
    )
    op.create_index("ix_market_signals_asset_class", "market_signals", ["asset_class"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_market_signals_asset_class", table_name="market_signals")
    op.drop_column("market_signals", "direction")
    op.drop_column("market_signals", "asset_class")
    op.drop_column("user_preferences", "capital_allocation_pct")
    op.drop_column("user_preferences", "max_concurrent_trades")
    op.drop_column("user_preferences", "sector_energy")
