"""Tests ciblés pour le moteur de décision NLP/trading."""

from __future__ import annotations

import uuid
import unittest
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import patch

from app.models.active_trade import ActiveTrade
from app.models.market_signal import MarketSignal
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet
from app.services import decision_engine


class _ScalarListResult:
    def __init__(self, items: list[MarketSignal]) -> None:
        self._items = items

    def scalars(self) -> _ScalarListResult:
        return self

    def all(self) -> list[MarketSignal]:
        return self._items


class _FakeSession:
    def __init__(
        self,
        *,
        user: User | None = None,
        wallet: Wallet | None = None,
        preference: UserPreference | None = None,
        signals: list[MarketSignal] | None = None,
        active_trade_scalars: list[ActiveTrade | None] | None = None,
    ) -> None:
        self.user = user
        self.wallet = wallet
        self.preference = preference
        self.signals = signals or []
        self.active_trade_scalars = list(active_trade_scalars or [])
        self.added_objects: list[object] = []
        self.commits = 0
        self.flushes = 0

    async def __aenter__(self) -> _FakeSession:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    def add(self, obj: object) -> None:
        self.added_objects.append(obj)

    def add_all(self, objects: list[object]) -> None:
        self.added_objects.extend(objects)

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, obj: object) -> None:
        if getattr(obj, "id", None) is None:
            setattr(obj, "id", uuid.uuid4())

    async def flush(self) -> None:
        self.flushes += 1

    async def get(self, model: type[User], obj_id: uuid.UUID) -> User | None:
        if model is User and self.user is not None and self.user.id == obj_id:
            return self.user
        return None

    async def scalar(self, statement):
        entity = statement.column_descriptions[0]["entity"]
        if entity is Wallet:
            return self.wallet
        if entity is UserPreference:
            return self.preference
        if entity is ActiveTrade:
            if self.active_trade_scalars:
                return self.active_trade_scalars.pop(0)
            return None
        raise AssertionError(f"Entité inattendue pour scalar(): {entity}")

    async def execute(self, statement) -> _ScalarListResult:
        entity = statement.column_descriptions[0]["entity"]
        if entity is MarketSignal:
            return _ScalarListResult(self.signals)
        raise AssertionError(f"Entité inattendue pour execute(): {entity}")


class DecisionEngineTests(unittest.IsolatedAsyncioTestCase):
    def test_sector_mapping_avoids_false_positive_on_record(self) -> None:
        self.assertEqual(
            decision_engine._map_sector("Le prix de l'or bondit après une hausse des achats des banques centrales."),
            decision_engine.SECTOR_MINES,
        )
        self.assertNotEqual(
            decision_engine._map_sector("Corporate board approves record dividend guidance."),
            decision_engine.SECTOR_MINES,
        )

    async def test_analyze_incoming_news_persists_asset_class_and_threshold(self) -> None:
        fake_session = _FakeSession()

        with patch("app.services.decision_engine.AsyncSessionLocal", new=lambda: fake_session):
            result = await decision_engine.analyze_incoming_news(
                news_text="Reuters: lithium producer reports record growth after strategic acquisition.",
                category="reuters equities",
            )

        self.assertEqual(result.source, "reuters_api")
        self.assertEqual(result.asset_class, decision_engine.ASSET_STOCK)
        self.assertEqual(result.mapped_sector, decision_engine.SECTOR_MINES)
        self.assertTrue(result.is_valid_signal)
        self.assertGreater(result.time_to_live_minutes, 0)
        self.assertEqual(fake_session.commits, 1)

        persisted_signal = next(obj for obj in fake_session.added_objects if isinstance(obj, MarketSignal))
        self.assertEqual(persisted_signal.asset_class, decision_engine.ASSET_STOCK)
        self.assertEqual(persisted_signal.mapped_sector, decision_engine.SECTOR_MINES)

    async def test_evaluate_trading_opportunity_skips_duplicate_signal_and_reserves_capital(self) -> None:
        user_id = uuid.uuid4()
        duplicated_signal_id = uuid.uuid4()
        selected_signal_id = uuid.uuid4()

        user = User(id=user_id, email="quant@example.com", password_hash="hashed", is_active=True)
        wallet = Wallet(
            user_id=user_id,
            solde_total=Decimal("1000.00"),
            solde_disponible=Decimal("500.00"),
            solde_engage=Decimal("100.00"),
        )
        preference = UserPreference(
            user_id=user_id,
            minimum_probability_threshold=Decimal("75.00"),
            enable_crypto=False,
            enable_etf=False,
            enable_stocks=True,
            sector_tech=True,
            sector_mines=False,
            sector_real_estate=False,
            sector_insurance=False,
            sector_food=False,
        )

        duplicated_signal = MarketSignal(
            id=duplicated_signal_id,
            source="reuters_api",
            category="reuters equities",
            asset_class=decision_engine.ASSET_STOCK,
            news_text="Cloud partnership lifts demand for enterprise software.",
            mapped_sector=decision_engine.SECTOR_TECH,
            sentiment_polarity="positive",
            source_confidence=Decimal("93.00"),
            probability_bullish=Decimal("90.00"),
            probability_bearish=Decimal("10.00"),
            signal_strength=Decimal("90.00"),
            is_valid_signal=True,
            time_to_live_minutes=360,
            expires_at=datetime.now(UTC) + timedelta(hours=4),
        )
        selected_signal = MarketSignal(
            id=selected_signal_id,
            source="bloomberg_enterprise",
            category="bloomberg equities",
            asset_class=decision_engine.ASSET_STOCK,
            news_text="Nvidia secures a major cloud expansion contract in Europe.",
            mapped_sector=decision_engine.SECTOR_TECH,
            sentiment_polarity="positive",
            source_confidence=Decimal("95.00"),
            probability_bullish=Decimal("84.00"),
            probability_bearish=Decimal("16.00"),
            signal_strength=Decimal("84.00"),
            is_valid_signal=True,
            time_to_live_minutes=480,
            expires_at=datetime.now(UTC) + timedelta(hours=6),
        )

        existing_trade = ActiveTrade(
            user_id=user_id,
            market_signal_id=duplicated_signal_id,
            asset_class=decision_engine.ASSET_STOCK,
            sector=decision_engine.SECTOR_TECH,
            direction="buy",
            probability_used=Decimal("90.00"),
            capital_engaged=Decimal("100.00"),
            estimated_duration_minutes=360,
            planned_close_at=datetime.now(UTC) + timedelta(hours=2),
        )

        fake_session = _FakeSession(
            user=user,
            wallet=wallet,
            preference=preference,
            signals=[duplicated_signal, selected_signal],
            active_trade_scalars=[existing_trade, None],
        )

        with patch("app.services.decision_engine.AsyncSessionLocal", new=lambda: fake_session):
            result = await decision_engine.evaluate_trading_opportunity(user_id)

        self.assertTrue(result.should_execute)
        self.assertEqual(result.market_signal_id, selected_signal_id)
        self.assertEqual(result.asset_class, decision_engine.ASSET_STOCK)
        self.assertEqual(result.recommended_capital, Decimal("100.00"))
        self.assertEqual(wallet.solde_disponible, Decimal("400.00"))
        self.assertEqual(wallet.solde_engage, Decimal("200.00"))

        created_trade = next(obj for obj in fake_session.added_objects if isinstance(obj, ActiveTrade))
        self.assertEqual(created_trade.market_signal_id, selected_signal_id)
        self.assertEqual(fake_session.commits, 1)
