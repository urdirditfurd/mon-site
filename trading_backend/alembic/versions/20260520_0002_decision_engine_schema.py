"""Add user preferences, market signals and active trades.

Revision ID: 20260520_0002
Revises: 20260518_0001
Create Date: 2026-05-20 20:40:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260520_0002"
down_revision = "20260518_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_preferences",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "minimum_probability_threshold",
            sa.Numeric(precision=5, scale=2),
            nullable=False,
            server_default=sa.text("70.00"),
        ),
        sa.Column("enable_crypto", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("enable_etf", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("enable_stocks", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sector_tech", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sector_mines", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sector_real_estate", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sector_insurance", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sector_food", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_user_preferences_user_id", "user_preferences", ["user_id"], unique=False)

    op.create_table(
        "market_signals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("news_text", sa.Text(), nullable=False),
        sa.Column("mapped_sector", sa.String(length=32), nullable=False),
        sa.Column("sentiment_polarity", sa.String(length=16), nullable=False),
        sa.Column("source_confidence", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("probability_bullish", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("probability_bearish", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("signal_strength", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("is_valid_signal", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("time_to_live_minutes", sa.Integer(), nullable=False, server_default=sa.text("60")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_market_signals_category", "market_signals", ["category"], unique=False)
    op.create_index("ix_market_signals_created_at", "market_signals", ["created_at"], unique=False)
    op.create_index("ix_market_signals_expires_at", "market_signals", ["expires_at"], unique=False)
    op.create_index("ix_market_signals_is_valid_signal", "market_signals", ["is_valid_signal"], unique=False)
    op.create_index("ix_market_signals_mapped_sector", "market_signals", ["mapped_sector"], unique=False)
    op.create_index("ix_market_signals_signal_strength", "market_signals", ["signal_strength"], unique=False)
    op.create_index("ix_market_signals_source", "market_signals", ["source"], unique=False)

    op.create_table(
        "active_trades",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("market_signal_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("asset_class", sa.String(length=16), nullable=False),
        sa.Column("sector", sa.String(length=32), nullable=False),
        sa.Column("direction", sa.String(length=16), nullable=False),
        sa.Column("probability_used", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("capital_engaged", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'open'")),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("estimated_duration_minutes", sa.Integer(), nullable=False),
        sa.Column("planned_close_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("close_reason", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(["market_signal_id"], ["market_signals.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_active_trades_asset_class", "active_trades", ["asset_class"], unique=False)
    op.create_index("ix_active_trades_market_signal_id", "active_trades", ["market_signal_id"], unique=False)
    op.create_index("ix_active_trades_sector", "active_trades", ["sector"], unique=False)
    op.create_index("ix_active_trades_status", "active_trades", ["status"], unique=False)
    op.create_index("ix_active_trades_user_id", "active_trades", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_active_trades_user_id", table_name="active_trades")
    op.drop_index("ix_active_trades_status", table_name="active_trades")
    op.drop_index("ix_active_trades_sector", table_name="active_trades")
    op.drop_index("ix_active_trades_market_signal_id", table_name="active_trades")
    op.drop_index("ix_active_trades_asset_class", table_name="active_trades")
    op.drop_table("active_trades")

    op.drop_index("ix_market_signals_source", table_name="market_signals")
    op.drop_index("ix_market_signals_signal_strength", table_name="market_signals")
    op.drop_index("ix_market_signals_mapped_sector", table_name="market_signals")
    op.drop_index("ix_market_signals_is_valid_signal", table_name="market_signals")
    op.drop_index("ix_market_signals_expires_at", table_name="market_signals")
    op.drop_index("ix_market_signals_created_at", table_name="market_signals")
    op.drop_index("ix_market_signals_category", table_name="market_signals")
    op.drop_table("market_signals")

    op.drop_index("ix_user_preferences_user_id", table_name="user_preferences")
    op.drop_table("user_preferences")
