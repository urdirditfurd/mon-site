"""Modèle utilisateur."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class User(Base):
    """Utilisateur de la plateforme."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    wallet: Mapped["Wallet"] = relationship(
        "Wallet",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    trading_profile: Mapped["TradingProfile"] = relationship(
        "TradingProfile",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    simulated_orders: Mapped[list["SimulatedOrder"]] = relationship(
        "SimulatedOrder",
        back_populates="user",
        cascade="all, delete-orphan",
    )
