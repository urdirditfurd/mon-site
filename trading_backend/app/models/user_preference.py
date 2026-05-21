"""Préférences utilisateur pour le moteur de décision."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Numeric, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class UserPreference(Base):
    """Filtres de probabilité, classes d'actifs et secteurs favoris."""

    __tablename__ = "user_preferences"
    __table_args__ = (
        CheckConstraint(
            "minimum_probability_threshold >= 0 AND minimum_probability_threshold <= 100",
            name="ck_user_preferences_threshold_range",
        ),
    )

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
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", back_populates="user_preference")
