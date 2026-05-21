"""Enhance decision engine: new sectors, capital management, trade simulation fields.

Revision ID: 20260521_0003
Revises: 20260520_0002
Create Date: 2026-05-21 07:00:00

Changes:
- user_preferences: add sector_energy, sector_healthcare, max_capital_per_trade_pct,
  max_concurrent_positions, preferred_trade_duration
- market_signals: add asset_class, retention_category, keywords_matched
- active_trades: add entry_price_simulated, exit_price_simulated, simulated_pnl
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260521_0003"
down_revision = "20260520_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- user_preferences: nouveaux secteurs et paramètres de gestion du capital --
    op.add_column(
        "user_preferences",
        sa.Column("sector_energy", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "user_preferences",
        sa.Column("sector_healthcare", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "user_preferences",
        sa.Column(
            "max_capital_per_trade_pct",
            sa.Numeric(precision=5, scale=2),
            nullable=False,
            server_default=sa.text("20.00"),
        ),
    )
    op.add_column(
        "user_preferences",
        sa.Column("max_concurrent_positions", sa.Integer(), nullable=False, server_default=sa.text("5")),
    )
    op.add_column(
        "user_preferences",
        sa.Column(
            "preferred_trade_duration",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'medium'"),
        ),
    )

    # -- market_signals: asset_class, retention_category, keywords_matched --
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
            "retention_category",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'corporate'"),
        ),
    )
    op.add_column(
        "market_signals",
        sa.Column("keywords_matched", sa.JSON(), nullable=True),
    )
    op.create_index("ix_market_signals_asset_class", "market_signals", ["asset_class"], unique=False)

    # -- active_trades: champs de simulation de prix et PnL --
    op.add_column(
        "active_trades",
        sa.Column(
            "entry_price_simulated",
            sa.Numeric(precision=14, scale=4),
            nullable=False,
            server_default=sa.text("100.0000"),
        ),
    )
    op.add_column(
        "active_trades",
        sa.Column("exit_price_simulated", sa.Numeric(precision=14, scale=4), nullable=True),
    )
    op.add_column(
        "active_trades",
        sa.Column("simulated_pnl", sa.Numeric(precision=14, scale=2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("active_trades", "simulated_pnl")
    op.drop_column("active_trades", "exit_price_simulated")
    op.drop_column("active_trades", "entry_price_simulated")

    op.drop_index("ix_market_signals_asset_class", table_name="market_signals")
    op.drop_column("market_signals", "keywords_matched")
    op.drop_column("market_signals", "retention_category")
    op.drop_column("market_signals", "asset_class")

    op.drop_column("user_preferences", "preferred_trade_duration")
    op.drop_column("user_preferences", "max_concurrent_positions")
    op.drop_column("user_preferences", "max_capital_per_trade_pct")
    op.drop_column("user_preferences", "sector_healthcare")
    op.drop_column("user_preferences", "sector_energy")
