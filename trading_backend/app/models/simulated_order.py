"""Ordre simulé déclenché par le moteur IA."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class SimulatedOrder(Base):
    """Historique des ordres déclenchés automatiquement."""

    __tablename__ = "simulated_orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    broker: Mapped[str] = mapped_column(String(32), nullable=False, default="alpaca_mock")
    broker_order_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    asset_symbol: Mapped[str] = mapped_column(String(16), nullable=False, default="NVDA")
    headline: Mapped[str] = mapped_column(Text, nullable=False)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    confidence: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    seuil_utilise: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    montant_ordre: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    requested_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    filled_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    pnl_simule: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=Decimal("0.00"))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", back_populates="simulated_orders")
