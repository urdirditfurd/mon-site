"""Add product onboarding fields to user preferences.

Revision ID: 20260521_0004
Revises: 20260521_0003
Create Date: 2026-05-21 09:10:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260521_0004"
down_revision = "20260521_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_preferences",
        sa.Column("broker_platform", sa.String(length=32), nullable=False, server_default="simulation"),
    )
    op.add_column(
        "user_preferences",
        sa.Column("broker_connection_status", sa.String(length=32), nullable=False, server_default="not_connected"),
    )
    op.add_column(
        "user_preferences",
        sa.Column("funding_provider", sa.String(length=32), nullable=False, server_default="simulated_psp"),
    )
    op.add_column(
        "user_preferences",
        sa.Column("paper_trading_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("user_preferences", "paper_trading_enabled")
    op.drop_column("user_preferences", "funding_provider")
    op.drop_column("user_preferences", "broker_connection_status")
    op.drop_column("user_preferences", "broker_platform")
