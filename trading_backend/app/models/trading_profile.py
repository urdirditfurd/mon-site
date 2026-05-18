"""Profil de trading d'un utilisateur (seuil de probabilité IA)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class TradingProfile(Base):
    """Configuration de trading automatisé propre à un utilisateur."""

    __tablename__ = "trading_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    seuil_probabilite_min: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("80.00"),
    )
    is_trading_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    risk_block_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    max_orders_per_day: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    stop_loss_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("2.50"),
    )
    max_drawdown_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("12.00"),
    )
    last_risk_reset_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    orders_today: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cumulative_pnl_today: Mapped[Decimal] = mapped_column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
    )
    equity_peak: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=Decimal("0.00"))
    equity_current: Mapped[Decimal] = mapped_column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
    )
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

    user: Mapped["User"] = relationship("User", back_populates="trading_profile")
