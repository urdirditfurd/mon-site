"""Signal de marché dérivé de l'analyse NLP des news.

Chaque news entrante est scorée par le pipeline NLP simulé, puis stockée
ici avec l'ensemble de ses métadonnées (source, confiance, probabilités,
secteur mappé, classe d'actifs, direction, durée de vie estimée).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Integer, JSON, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class MarketSignal(Base):
    """Stocke les événements news scorés et validés par le pipeline NLP.

    Colonnes clés :
    - ``signal_strength`` : force globale du signal (max(bullish, bearish)).
    - ``is_valid_signal`` : ``True`` si ``signal_strength >= seuil min`` (70 %).
    - ``time_to_live_minutes`` / ``expires_at`` : horizon de validité de la news.
    - ``asset_class`` : classe d'actifs déduite de la catégorie (crypto/etf/stocks).
    - ``direction`` : sens du marché déduit (buy/sell/hold).
    """

    __tablename__ = "market_signals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    source: Mapped[str] = mapped_column(
        String(64), nullable=False, default="unknown_source", index=True,
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    news_text: Mapped[str] = mapped_column(Text, nullable=False)
    mapped_sector: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    asset_class: Mapped[str] = mapped_column(
        String(16), nullable=False, default="stocks", index=True,
    )
    direction: Mapped[str] = mapped_column(
        String(16), nullable=False, default="hold",
    )
    sentiment_polarity: Mapped[str] = mapped_column(String(16), nullable=False)
    source_confidence: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    probability_bullish: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    probability_bearish: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    signal_strength: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, index=True,
    )
    is_valid_signal: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True,
    )
    time_to_live_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, default=60,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True,
    )
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    active_trades: Mapped[list["ActiveTrade"]] = relationship(
        "ActiveTrade",
        back_populates="market_signal",
    )
