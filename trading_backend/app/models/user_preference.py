"""Préférences utilisateur pour le moteur de décision."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class UserPreference(Base):
    """Filtres de probabilité, classes d'actifs, secteurs et paramètres de gestion du capital."""

    __tablename__ = "user_preferences"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    minimum_probability_threshold: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("70.00"),
    )

    enable_crypto: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enable_etf: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enable_stocks: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    sector_tech: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sector_mines: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sector_real_estate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sector_insurance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sector_food: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sector_energy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sector_healthcare: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    max_capital_per_trade_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("20.00"),
    )
    max_concurrent_positions: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    preferred_trade_duration: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="medium",
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", back_populates="user_preference")
