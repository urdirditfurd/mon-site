"""Préférences utilisateur pour le moteur de décision.

Stocke les filtres de probabilité, les switches de classes d'actifs
(Crypto / ETF / Actions) et les switches sectoriels que l'utilisateur
active depuis le dashboard.  Chaque utilisateur possède exactement une
ligne dans cette table (relation 1-à-1 avec ``users``).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class UserPreference(Base):
    """Filtres de probabilité, classes d'actifs et secteurs favoris.

    Colonnes métier :
    - ``minimum_probability_threshold`` : seuil strict (0-100 %).  Un signal
      dont la probabilité est inférieure est ignoré.
    - ``enable_crypto / enable_etf / enable_stocks`` : interrupteurs par
      classe d'actifs.
    - ``sector_*`` : interrupteurs par industrie.
    - ``max_concurrent_trades`` : nombre maximal de positions ouvertes
      simultanément pour cet utilisateur.
    - ``capital_allocation_pct`` : pourcentage du solde disponible engagé
      par trade (ex. 20 % → recommandation automatique).
    """

    __tablename__ = "user_preferences"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # ── Seuil de probabilité ──────────────────────────────────────────
    minimum_probability_threshold: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("70.00"),
    )

    # ── Classes d'actifs ──────────────────────────────────────────────
    enable_crypto: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enable_etf: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enable_stocks: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # ── Filtres sectoriels ────────────────────────────────────────────
    sector_tech: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sector_mines: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sector_real_estate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sector_insurance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sector_food: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sector_energy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # ── Contrôle de position ──────────────────────────────────────────
    max_concurrent_trades: Mapped[int] = mapped_column(
        Integer, nullable=False, default=5,
    )
    capital_allocation_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("20.00"),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", back_populates="user_preference")
