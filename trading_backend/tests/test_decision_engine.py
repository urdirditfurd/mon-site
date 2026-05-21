"""Tests unitaires du coeur de décision NLP/trading."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from app.models.active_trade import ActiveTrade
from app.models.market_signal import MarketSignal
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet
from app.services import decision_engine


class _FakePersistSession:
    """Session minimale pour tester analyze_incoming_news sans DB réelle."""

    def __init__(self) -> None:
        self.added: list[Any] = []

    async def __aenter__(self) -> "_FakePersistSession":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    def add(self, instance: Any) -> None:
        self.added.append(instance)

    async def commit(self) -> None:
        return None

    async def refresh(self, instance: Any) -> None:
        if getattr(instance, "id", None) is None:
            instance.id = uuid.uuid4()


class _FakeQueryResult:
    """Objet de résultat compatible avec execute(...).scalars().all()."""

    def __init__(self, rows: list[MarketSignal]) -> None:
        self._rows = rows

    def scalars(self) -> "_FakeQueryResult":
        return self

    def all(self) -> list[MarketSignal]:
        return list(self._rows)


class _FakeEvaluationSession:
    """Session simulée pour tester evaluate_trading_opportunity."""

    def __init__(self, user: User, wallet: Wallet, preference: UserPreference, signals: list[MarketSignal]) -> None:
        self.user = user
        self.wallet = wallet
        self.preference = preference
        self.signals = signals
        self.added: list[Any] = []

    async def __aenter__(self) -> "_FakeEvaluationSession":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    async def get(self, model: type[Any], identity: uuid.UUID) -> User | None:
        if model is User and identity == self.user.id:
            return self.user
        return None

    async def scalar(self, statement):  # type: ignore[no-untyped-def]
        descriptor = statement.column_descriptions[0]
        model = descriptor.get("entity") or descriptor.get("type")
        if model is Wallet:
            return self.wallet
        if model is UserPreference:
            return self.preference
        if model is ActiveTrade:
            return None
        return None

    async def execute(self, _statement):  # type: ignore[no-untyped-def]
        return _FakeQueryResult(self.signals)

    def add(self, instance: Any) -> None:
        self.added.append(instance)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        return None

    async def refresh(self, instance: Any) -> None:
        if isinstance(instance, ActiveTrade) and getattr(instance, "id", None) is None:
            instance.id = uuid.uuid4()


class DecisionEngineTests(IsolatedAsyncioTestCase):
    """Validation fonctionnelle du moteur décisionnel."""

    def test_map_sector_ignores_substring_false_positive(self) -> None:
        sector = decision_engine._map_sector("Major corporation announces a new board policy.")
        self.assertEqual(sector, decision_engine.SECTOR_GENERAL)

    async def test_analyze_incoming_news_enforces_strict_threshold(self) -> None:
        fake_session = _FakePersistSession()
        with (
            patch.object(decision_engine, "AsyncSessionLocal", return_value=fake_session),
            patch.object(
                decision_engine,
                "_compute_probabilities",
                return_value=("positive", Decimal("70.00"), Decimal("30.00")),
            ),
        ):
            result = await decision_engine.analyze_incoming_news(
                news_text="L'or et le lithium progressent après une rupture d'offre.",
                category="reuters/stocks",
            )

        self.assertEqual(result.mapped_sector, decision_engine.SECTOR_MINES)
        self.assertFalse(result.is_valid_signal)

    async def test_evaluate_trading_opportunity_reserves_wallet_capital(self) -> None:
        user_id = uuid.uuid4()
        now = datetime.now(UTC)
        user = User(
            id=user_id,
            email="quant@example.com",
            password_hash="hash",
            role="trader",
            is_active=True,
        )
        wallet = Wallet(
            user_id=user_id,
            solde_total=Decimal("1000.00"),
            solde_disponible=Decimal("1000.00"),
            solde_engage=Decimal("0.00"),
        )
        preference = UserPreference(
            user_id=user_id,
            minimum_probability_threshold=Decimal("70.00"),
            enable_crypto=True,
            enable_etf=True,
            enable_stocks=True,
            sector_tech=True,
            sector_mines=True,
            sector_real_estate=True,
            sector_insurance=True,
            sector_food=True,
        )
        signal_at_threshold = MarketSignal(
            id=uuid.uuid4(),
            source="reuters_api",
            category="reuters/stocks",
            news_text="Neutral update.",
            mapped_sector=decision_engine.SECTOR_TECH,
            sentiment_polarity="positive",
            source_confidence=Decimal("93.00"),
            probability_bullish=Decimal("70.00"),
            probability_bearish=Decimal("30.00"),
            signal_strength=Decimal("70.00"),
            is_valid_signal=True,
            time_to_live_minutes=120,
            expires_at=now + timedelta(hours=2),
            metadata_json={},
        )
        signal_above_threshold = MarketSignal(
            id=uuid.uuid4(),
            source="reuters_api",
            category="reuters/stocks",
            news_text="Strong upgrade and growth outlook.",
            mapped_sector=decision_engine.SECTOR_TECH,
            sentiment_polarity="positive",
            source_confidence=Decimal("93.00"),
            probability_bullish=Decimal("71.00"),
            probability_bearish=Decimal("29.00"),
            signal_strength=Decimal("71.00"),
            is_valid_signal=True,
            time_to_live_minutes=180,
            expires_at=now + timedelta(hours=3),
            metadata_json={},
        )
        fake_session = _FakeEvaluationSession(
            user=user,
            wallet=wallet,
            preference=preference,
            signals=[signal_at_threshold, signal_above_threshold],
        )

        with patch.object(decision_engine, "AsyncSessionLocal", return_value=fake_session):
            result = await decision_engine.evaluate_trading_opportunity(user_id=user_id)

        self.assertTrue(result.should_execute)
        self.assertEqual(result.market_signal_id, signal_above_threshold.id)
        self.assertEqual(wallet.solde_disponible, Decimal("800.00"))
        self.assertEqual(wallet.solde_engage, Decimal("200.00"))
