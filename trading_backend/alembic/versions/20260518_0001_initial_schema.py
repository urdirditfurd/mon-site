"""Initial schema for trading backend.

Revision ID: 20260518_0001
Revises:
Create Date: 2026-05-18 19:45:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260518_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default=sa.text("'trader'")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=False)
    op.create_index("ix_users_role", "users", ["role"], unique=False)

    op.create_table(
        "wallets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("solde_total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("solde_disponible", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("solde_engage", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_wallets_user_id", "wallets", ["user_id"], unique=False)

    op.create_table(
        "trading_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seuil_probabilite_min", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("is_trading_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("risk_block_reason", sa.String(length=255), nullable=True),
        sa.Column("max_orders_per_day", sa.Integer(), nullable=False, server_default=sa.text("20")),
        sa.Column("stop_loss_pct", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("max_drawdown_pct", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("last_risk_reset_date", sa.Date(), nullable=False),
        sa.Column("orders_today", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("cumulative_pnl_today", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("equity_peak", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("equity_current", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_trading_profiles_user_id", "trading_profiles", ["user_id"], unique=False)

    op.create_table(
        "simulated_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("broker", sa.String(length=32), nullable=False),
        sa.Column("broker_order_id", sa.String(length=64), nullable=False),
        sa.Column("asset_symbol", sa.String(length=16), nullable=False),
        sa.Column("headline", sa.Text(), nullable=False),
        sa.Column("direction", sa.String(length=16), nullable=False),
        sa.Column("confidence", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("seuil_utilise", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("montant_ordre", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("requested_price", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("filled_price", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("pnl_simule", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("rejection_reason", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("broker_order_id"),
    )
    op.create_index("ix_simulated_orders_broker_order_id", "simulated_orders", ["broker_order_id"], unique=False)
    op.create_index("ix_simulated_orders_user_id", "simulated_orders", ["user_id"], unique=False)

    op.create_table(
        "audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"], unique=False)
    op.create_index("ix_audit_events_event_type", "audit_events", ["event_type"], unique=False)
    op.create_index("ix_audit_events_severity", "audit_events", ["severity"], unique=False)
    op.create_index("ix_audit_events_source", "audit_events", ["source"], unique=False)
    op.create_index("ix_audit_events_user_id", "audit_events", ["user_id"], unique=False)

    op.create_table(
        "alert_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("alert_code", sa.String(length=64), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alert_events_alert_code", "alert_events", ["alert_code"], unique=False)
    op.create_index("ix_alert_events_created_at", "alert_events", ["created_at"], unique=False)
    op.create_index("ix_alert_events_severity", "alert_events", ["severity"], unique=False)
    op.create_index("ix_alert_events_source", "alert_events", ["source"], unique=False)
    op.create_index("ix_alert_events_status", "alert_events", ["status"], unique=False)
    op.create_index("ix_alert_events_user_id", "alert_events", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_alert_events_user_id", table_name="alert_events")
    op.drop_index("ix_alert_events_status", table_name="alert_events")
    op.drop_index("ix_alert_events_source", table_name="alert_events")
    op.drop_index("ix_alert_events_severity", table_name="alert_events")
    op.drop_index("ix_alert_events_created_at", table_name="alert_events")
    op.drop_index("ix_alert_events_alert_code", table_name="alert_events")
    op.drop_table("alert_events")

    op.drop_index("ix_audit_events_user_id", table_name="audit_events")
    op.drop_index("ix_audit_events_source", table_name="audit_events")
    op.drop_index("ix_audit_events_severity", table_name="audit_events")
    op.drop_index("ix_audit_events_event_type", table_name="audit_events")
    op.drop_index("ix_audit_events_created_at", table_name="audit_events")
    op.drop_table("audit_events")

    op.drop_index("ix_simulated_orders_user_id", table_name="simulated_orders")
    op.drop_index("ix_simulated_orders_broker_order_id", table_name="simulated_orders")
    op.drop_table("simulated_orders")

    op.drop_index("ix_trading_profiles_user_id", table_name="trading_profiles")
    op.drop_table("trading_profiles")

    op.drop_index("ix_wallets_user_id", table_name="wallets")
    op.drop_table("wallets")

    op.drop_index("ix_users_role", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
