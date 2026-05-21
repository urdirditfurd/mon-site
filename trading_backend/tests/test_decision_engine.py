"""Tests unitaires ciblés pour le moteur de décision."""

from __future__ import annotations

import uuid
import unittest
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import patch

from app.models.trading_profile import TradingProfile
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet
from app.services import decision_engine


class _FakeAsyncSession:
    def __init__(self) -> None:
        self.added: list[object] = []

    async def __aenter__(self) -> _FakeAsyncSession:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    def add(self, instance: object) -> None:
        self.added.append(instance)

    async def commit(self) -> None:
        return None

    async def refresh(self, instance: object) -> None:
        if getattr(instance, "id", None) is None:
            setattr(instance, "id", uuid.uuid4())


class DecisionEngineUnitTests(unittest.IsolatedAsyncioTestCase):
    async def test_analyze_incoming_news_enriches_signal_metadata(self) -> None:
        fake_session = _FakeAsyncSession()

        with patch("app.services.decision_engine.AsyncSessionLocal", new=lambda: fake_session):
            result = await decision_engine.analyze_incoming_news(
                news_text="Reuters reports lithium miners upgrade after strong demand growth.",
                category="Reuters stocks",
            )

        self.assertEqual(result.source, "reuters_api")
        self.assertEqual(result.asset_class, decision_engine.ASSET_STOCK)
        self.assertEqual(result.mapped_sector, decision_engine.SECTOR_MINES)
        self.assertTrue(result.is_valid_signal)
        self.assertEqual(result.time_horizon_label, "commodities_swing")
        persisted_signal = fake_session.added[0]
        self.assertEqual(persisted_signal.metadata_json["time_horizon_label"], result.time_horizon_label)
        self.assertEqual(persisted_signal.metadata_json["asset_class"], result.asset_class)

    def test_map_sector_avoids_false_positive_for_oracle(self) -> None:
        sector = decision_engine._map_sector("Oracle expands cloud partnership with Nvidia in Europe.")
        self.assertEqual(sector, decision_engine.SECTOR_TECH)

    def test_resolve_effective_threshold_uses_most_conservative_value(self) -> None:
        user_id = uuid.uuid4()
        preference = UserPreference(
            user_id=user_id,
            minimum_probability_threshold=Decimal("72.00"),
            enable_crypto=True,
            enable_etf=True,
            enable_stocks=True,
            sector_tech=True,
            sector_mines=True,
            sector_real_estate=False,
            sector_insurance=False,
            sector_food=False,
        )
        profile = TradingProfile(
            user_id=user_id,
            seuil_probabilite_min=Decimal("82.00"),
            is_trading_active=True,
            max_orders_per_day=20,
            stop_loss_pct=Decimal("2.50"),
            max_drawdown_pct=Decimal("12.00"),
            last_risk_reset_date=datetime.now(UTC).date(),
            orders_today=0,
            cumulative_pnl_today=Decimal("0.00"),
            equity_peak=Decimal("0.00"),
            equity_current=Decimal("0.00"),
        )

        threshold = decision_engine._resolve_effective_threshold(preference, profile)
        self.assertEqual(threshold, Decimal("82.00"))

    def test_reserve_capital_moves_funds_between_wallet_buckets(self) -> None:
        wallet = Wallet(
            user_id=uuid.uuid4(),
            solde_total=Decimal("1000.00"),
            solde_disponible=Decimal("500.00"),
            solde_engage=Decimal("100.00"),
        )

        decision_engine._reserve_capital(wallet, Decimal("125.55"))

        self.assertEqual(wallet.solde_disponible, Decimal("374.45"))
        self.assertEqual(wallet.solde_engage, Decimal("225.55"))

    def test_estimate_ttl_profile_marks_macro_signals_as_long_horizon(self) -> None:
        ttl_minutes, label, reason = decision_engine._estimate_ttl_profile(
            news_text="The FED signals a new interest rate path amid persistent inflation.",
            category="Bloomberg stocks",
            mapped_sector=decision_engine.SECTOR_GENERAL,
            strength=Decimal("91.00"),
        )

        self.assertGreaterEqual(ttl_minutes, 60 * 24 * 3)
        self.assertEqual(label, "macro_multi_day")
        self.assertIn("macro", reason.lower())


if __name__ == "__main__":
    unittest.main()
