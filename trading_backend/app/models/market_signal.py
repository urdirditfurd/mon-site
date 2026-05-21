"""Signal de marché dérivé de l'analyse NLP des news."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, JSON, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class MarketSignal(Base):
    """Stocke les événements news scorés et validés par le pipeline NLP."""

    __tablename__ = "market_signals"
    __table_args__ = (
        CheckConstraint(
            "source_confidence >= 0 AND source_confidence <= 100",
            name="ck_market_signals_source_confidence_percent",
        ),
        CheckConstraint(
            "probability_bullish >= 0 AND probability_bullish <= 100",
            name="ck_market_signals_bullish_percent",
        ),
        CheckConstraint(
            "probability_bearish >= 0 AND probability_bearish <= 100",
            name="ck_market_signals_bearish_percent",
        ),
        CheckConstraint(
            "signal_strength >= 0 AND signal_strength <= 100",
            name="ck_market_signals_strength_percent",
        ),
        CheckConstraint(
            "time_to_live_minutes > 0",
            name="ck_market_signals_positive_ttl",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="unknown_source", index=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    news_text: Mapped[str] = mapped_column(Text, nullable=False)
    mapped_sector: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    sentiment_polarity: Mapped[str] = mapped_column(String(16), nullable=False)
    source_confidence: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    probability_bullish: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    probability_bearish: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    signal_strength: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, index=True)
    is_valid_signal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    time_to_live_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
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
