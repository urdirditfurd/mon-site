"""Position ouverte issue du moteur de décision."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class ActiveTrade(Base):
    """Suivi des opportunités validées et ouvertes."""

    __tablename__ = "active_trades"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    market_signal_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("market_signals.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    asset_class: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    sector: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    probability_used: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    capital_engaged: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    entry_price_simulated: Mapped[Decimal] = mapped_column(
        Numeric(14, 4),
        nullable=False,
        default=Decimal("100.0000"),
    )
    exit_price_simulated: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    simulated_pnl: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open", index=True)
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    estimated_duration_minutes: Mapped[int] = mapped_column(nullable=False)
    planned_close_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    close_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="active_trades")
    market_signal: Mapped["MarketSignal | None"] = relationship("MarketSignal", back_populates="active_trades")
