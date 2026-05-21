"""Ajoute le champ pnl_realise à la table active_trades.

Revision ID: 20260521_0003
Revises: 20260520_0002
Create Date: 2026-05-21 07:30:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260521_0003"
down_revision = "20260520_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "active_trades",
        sa.Column(
            "pnl_realise",
            sa.Numeric(precision=14, scale=2),
            nullable=True,
            comment="PnL simulé calculé à la clôture de la position (en devise du wallet).",
        ),
    )


def downgrade() -> None:
    op.drop_column("active_trades", "pnl_realise")
