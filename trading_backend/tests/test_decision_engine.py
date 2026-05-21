"""Tests unitaires pour le moteur de décision (fonctions pures, sans DB)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from app.services.decision_engine import (
    ASSET_CRYPTO,
    ASSET_ETF,
    ASSET_STOCK,
    SECTOR_ENERGY,
    SECTOR_FOOD,
    SECTOR_GENERAL,
    SECTOR_HEALTHCARE,
    SECTOR_INSURANCE,
    SECTOR_MINES,
    SECTOR_REAL_ESTATE,
    SECTOR_TECH,
    _classify_retention,
    _clamp,
    _compute_probabilities,
    _composite_score,
    _deterministic_noise,
    _estimate_ttl_minutes,
    _extract_source,
    _get_source_confidence,
    _is_asset_class_enabled,
    _is_sector_enabled,
    _map_sector_weighted,
    _quantize,
    _resolve_asset_class,
    _simulate_entry_price,
)


def _mock_preference(**overrides):
    """Crée un mock léger de UserPreference sans dépendance SQLAlchemy."""
    defaults = {
        "sector_tech": True,
        "sector_mines": True,
        "sector_real_estate": False,
        "sector_insurance": False,
        "sector_food": False,
        "sector_energy": False,
        "sector_healthcare": False,
        "enable_crypto": True,
        "enable_etf": True,
        "enable_stocks": True,
    }
    defaults.update(overrides)
    mock = MagicMock()
    for k, v in defaults.items():
        setattr(mock, k, v)
    return mock


def _mock_signal(*, strength=85, source_conf=90, ttl=120, created_minutes_ago=0, signal_id=None):
    """Crée un mock léger de MarketSignal sans dépendance SQLAlchemy."""
    mock = MagicMock()
    mock.id = signal_id or uuid.uuid4()
    mock.signal_strength = Decimal(str(strength))
    mock.source_confidence = Decimal(str(source_conf))
    mock.time_to_live_minutes = ttl
    mock.created_at = datetime.now(UTC) - timedelta(minutes=created_minutes_ago)
    return mock


# ---------------------------------------------------------------------------
# _quantize / _clamp
# ---------------------------------------------------------------------------

class TestQuantize:
    def test_rounds_half_up(self):
        assert _quantize(Decimal("1.555")) == Decimal("1.56")

    def test_rounds_down(self):
        assert _quantize(Decimal("1.554")) == Decimal("1.55")

    def test_custom_precision(self):
        assert _quantize(Decimal("1.55555"), "0.0001") == Decimal("1.5556")


class TestClamp:
    def test_within_range(self):
        assert _clamp(Decimal("50"), Decimal("10"), Decimal("90")) == Decimal("50")

    def test_below_min(self):
        assert _clamp(Decimal("5"), Decimal("10"), Decimal("90")) == Decimal("10")

    def test_above_max(self):
        assert _clamp(Decimal("100"), Decimal("10"), Decimal("90")) == Decimal("90")


# ---------------------------------------------------------------------------
# _deterministic_noise
# ---------------------------------------------------------------------------

class TestDeterministicNoise:
    def test_deterministic(self):
        v1 = _deterministic_noise("test news", "bloomberg")
        v2 = _deterministic_noise("test news", "bloomberg")
        assert v1 == v2

    def test_different_inputs(self):
        v1 = _deterministic_noise("news A", "bloomberg")
        v2 = _deterministic_noise("news B", "bloomberg")
        assert v1 != v2

    def test_bounded(self):
        for text in ["alpha", "beta", "gamma", "delta", "epsilon"]:
            noise = _deterministic_noise(text, "test")
            assert Decimal("-6.00") <= noise <= Decimal("6.00")


# ---------------------------------------------------------------------------
# _extract_source / _get_source_confidence
# ---------------------------------------------------------------------------

class TestSourceExtraction:
    @pytest.mark.parametrize("category,expected", [
        ("bloomberg_feed", "bloomberg_enterprise"),
        ("reuters_news", "reuters_api"),
        ("benzinga_alerts", "benzinga"),
        ("twitter_feed", "x_api_v2"),
        ("x_api_v2", "x_api_v2"),
        ("rss_feed", "rss_certified"),
        ("unknown", "certified_feed"),
    ])
    def test_source_mapping(self, category: str, expected: str):
        assert _extract_source(category) == expected

    def test_bloomberg_confidence(self):
        assert _get_source_confidence("bloomberg_enterprise") == Decimal("95.00")

    def test_unknown_default(self):
        assert _get_source_confidence("random") == Decimal("78.00")


# ---------------------------------------------------------------------------
# _map_sector_weighted
# ---------------------------------------------------------------------------

class TestSectorMapping:
    def test_mines_gold(self):
        sector, kw = _map_sector_weighted("Gold prices surge after announcement")
        assert sector == SECTOR_MINES
        assert "gold" in kw.get(SECTOR_MINES, [])

    def test_mines_lithium(self):
        sector, kw = _map_sector_weighted("Lithium supply chain disruption in Chile")
        assert sector == SECTOR_MINES
        assert "lithium" in kw.get(SECTOR_MINES, [])

    def test_tech_nvidia(self):
        sector, kw = _map_sector_weighted("NVIDIA announces new AI chip breakthrough")
        assert sector == SECTOR_TECH
        assert "nvidia" in kw.get(SECTOR_TECH, [])

    def test_tech_ai(self):
        sector, kw = _map_sector_weighted("AI and machine learning are transforming finance")
        assert sector == SECTOR_TECH

    def test_real_estate(self):
        sector, kw = _map_sector_weighted("Housing market shows signs of recovery")
        assert sector == SECTOR_REAL_ESTATE
        assert "housing" in kw.get(SECTOR_REAL_ESTATE, [])

    def test_insurance(self):
        sector, kw = _map_sector_weighted("The insurance company raised its reinsurance premium this quarter")
        assert sector == SECTOR_INSURANCE

    def test_food_agriculture(self):
        sector, kw = _map_sector_weighted("Wheat futures rise amid drought in agriculture")
        assert sector == SECTOR_FOOD

    def test_energy_oil(self):
        sector, kw = _map_sector_weighted("OPEC announces production cuts for next quarter")
        assert sector == SECTOR_ENERGY
        assert "opec" in kw.get(SECTOR_ENERGY, [])

    def test_energy_hydrogen(self):
        sector, kw = _map_sector_weighted("Green hydrogen investment doubles in Europe")
        assert sector == SECTOR_ENERGY

    def test_healthcare_biotech(self):
        sector, kw = _map_sector_weighted("Biotech startup receives FDA approval for new treatment")
        assert sector == SECTOR_HEALTHCARE
        assert "fda" in kw.get(SECTOR_HEALTHCARE, [])

    def test_general_fallback(self):
        sector, kw = _map_sector_weighted("The overall mood remains very calm today")
        assert sector == SECTOR_GENERAL
        assert kw == {}

    def test_french_keywords(self):
        sector, kw = _map_sector_weighted("Le pétrole continue sa progression")
        assert sector == SECTOR_ENERGY

    def test_weighted_dominance(self):
        """Quand plusieurs secteurs sont détectés, le plus fort l'emporte."""
        sector, kw = _map_sector_weighted(
            "NVIDIA AI chip uses rare earth materials from mining operations"
        )
        assert sector in {SECTOR_TECH, SECTOR_MINES}
        assert len(kw) >= 2


# ---------------------------------------------------------------------------
# _classify_retention
# ---------------------------------------------------------------------------

class TestRetentionClassification:
    def test_macro(self):
        assert _classify_retention("Fed announces interest rate hike") == "macro"
        assert _classify_retention("Inflation data raises concerns") == "macro"
        assert _classify_retention("GDP growth above expectations") == "macro"

    def test_social_media(self):
        assert _classify_retention("Elon Musk tweet causes market volatility") == "social_media"
        assert _classify_retention("Viral post about new stock on Reddit") == "social_media"

    def test_corporate_default(self):
        assert _classify_retention("Apple announces new product line") == "corporate"
        assert _classify_retention("Quarterly earnings beat expectations") == "corporate"


# ---------------------------------------------------------------------------
# _resolve_asset_class
# ---------------------------------------------------------------------------

class TestAssetClassResolution:
    @pytest.mark.parametrize("category,expected", [
        ("crypto_binance", ASSET_CRYPTO),
        ("coinbase_feed", ASSET_CRYPTO),
        ("bitcoin_news", ASSET_CRYPTO),
        ("etf_analysis", ASSET_ETF),
        ("stock_market", ASSET_STOCK),
        ("bloomberg", ASSET_STOCK),
    ])
    def test_resolution(self, category: str, expected: str):
        assert _resolve_asset_class(category) == expected


# ---------------------------------------------------------------------------
# _compute_probabilities
# ---------------------------------------------------------------------------

class TestProbabilities:
    def test_bullish(self):
        polarity, bull, bear, strength = _compute_probabilities(
            "NVIDIA upgrade record growth", "bloomberg", Decimal("95.00"),
        )
        assert polarity == "positive"
        assert bull > bear
        assert strength == bull

    def test_bearish(self):
        polarity, bull, bear, strength = _compute_probabilities(
            "Major fraud and lawsuit investigation", "reuters", Decimal("93.00"),
        )
        assert polarity == "negative"
        assert bear > bull
        assert strength == bear

    def test_neutral(self):
        polarity, bull, bear, strength = _compute_probabilities(
            "Neutral market conditions observed today", "rss", Decimal("80.00"),
        )
        assert polarity == "neutral"
        assert Decimal("45.00") <= bull <= Decimal("65.00")

    def test_strength_bounded(self):
        polarity, bull, bear, strength = _compute_probabilities(
            "upgrade growth record beats rally breakout bullish outperform",
            "bloomberg", Decimal("95.00"),
        )
        assert strength <= Decimal("99.00")
        assert strength >= Decimal("50.00")

    def test_source_bonus(self):
        _, _, _, s1 = _compute_probabilities("upgrade", "bloomberg", Decimal("95.00"))
        _, _, _, s2 = _compute_probabilities("upgrade", "bloomberg", Decimal("74.00"))
        assert s1 >= s2

    def test_deterministic(self):
        r1 = _compute_probabilities("test news", "bloomberg", Decimal("90.00"))
        r2 = _compute_probabilities("test news", "bloomberg", Decimal("90.00"))
        assert r1 == r2


# ---------------------------------------------------------------------------
# _estimate_ttl_minutes
# ---------------------------------------------------------------------------

class TestTTLEstimation:
    def test_macro_long_ttl(self):
        ttl = _estimate_ttl_minutes(
            "Fed interest rate decision", "bloomberg",
            SECTOR_GENERAL, "macro", Decimal("85.00"),
        )
        assert ttl >= 60 * 24

    def test_social_short_ttl(self):
        ttl = _estimate_ttl_minutes(
            "Influencer tweet about stock", "twitter",
            SECTOR_TECH, "social_media", Decimal("75.00"),
        )
        assert ttl <= 120

    def test_corporate_medium_ttl(self):
        ttl = _estimate_ttl_minutes(
            "Tech company earnings surprise", "bloomberg",
            SECTOR_TECH, "corporate", Decimal("80.00"),
        )
        assert 60 * 3 <= ttl <= 60 * 24

    def test_bounded(self):
        ttl = _estimate_ttl_minutes(
            "Test", "bloomberg", SECTOR_GENERAL, "corporate", Decimal("99.00"),
        )
        assert 30 <= ttl <= 60 * 24 * 7


# ---------------------------------------------------------------------------
# _is_sector_enabled / _is_asset_class_enabled
# ---------------------------------------------------------------------------

class TestPreferenceFilters:
    def test_sector_tech_enabled(self):
        assert _is_sector_enabled(_mock_preference(), SECTOR_TECH) is True

    def test_sector_real_estate_disabled(self):
        assert _is_sector_enabled(_mock_preference(), SECTOR_REAL_ESTATE) is False

    def test_sector_energy_enabled(self):
        pref = _mock_preference(sector_energy=True)
        assert _is_sector_enabled(pref, SECTOR_ENERGY) is True

    def test_sector_healthcare_disabled(self):
        assert _is_sector_enabled(_mock_preference(), SECTOR_HEALTHCARE) is False

    def test_general_always_enabled(self):
        assert _is_sector_enabled(_mock_preference(), SECTOR_GENERAL) is True

    def test_crypto_enabled(self):
        assert _is_asset_class_enabled(_mock_preference(), ASSET_CRYPTO) is True

    def test_crypto_disabled(self):
        pref = _mock_preference(enable_crypto=False)
        assert _is_asset_class_enabled(pref, ASSET_CRYPTO) is False


# ---------------------------------------------------------------------------
# _composite_score
# ---------------------------------------------------------------------------

class TestCompositeScore:
    def test_fresh_signal_higher(self):
        now = datetime.now(UTC)
        fresh = _mock_signal(strength=85, source_conf=90, ttl=120, created_minutes_ago=5)
        old = _mock_signal(strength=85, source_conf=90, ttl=120, created_minutes_ago=100)
        assert _composite_score(fresh, now) > _composite_score(old, now)

    def test_stronger_signal_higher(self):
        now = datetime.now(UTC)
        strong = _mock_signal(strength=90, source_conf=90, ttl=120, created_minutes_ago=10)
        weak = _mock_signal(strength=70, source_conf=90, ttl=120, created_minutes_ago=10)
        assert _composite_score(strong, now) > _composite_score(weak, now)

    def test_higher_confidence_higher(self):
        now = datetime.now(UTC)
        high_conf = _mock_signal(strength=85, source_conf=95, ttl=120, created_minutes_ago=10)
        low_conf = _mock_signal(strength=85, source_conf=74, ttl=120, created_minutes_ago=10)
        assert _composite_score(high_conf, now) > _composite_score(low_conf, now)


# ---------------------------------------------------------------------------
# _simulate_entry_price
# ---------------------------------------------------------------------------

class TestSimulateEntryPrice:
    def test_deterministic(self):
        fixed_id = uuid.UUID("12345678-1234-5678-1234-567812345678")
        signal = _mock_signal(signal_id=fixed_id)
        p1 = _simulate_entry_price(signal)
        p2 = _simulate_entry_price(signal)
        assert p1 == p2

    def test_positive_price(self):
        signal = _mock_signal()
        price = _simulate_entry_price(signal)
        assert price > Decimal("0")


# ---------------------------------------------------------------------------
# Integration: full NLP pipeline (pure functions only)
# ---------------------------------------------------------------------------

class TestFullNLPPipeline:
    """Teste le pipeline complet sans DB en appelant les fonctions pures."""

    def test_mines_sector_bullish(self):
        text = "Gold prices surge on record demand"
        sector, kw = _map_sector_weighted(text)
        retention = _classify_retention(text)
        polarity, bull, bear, strength = _compute_probabilities(text, "bloomberg", Decimal("95.00"))

        assert sector == SECTOR_MINES
        assert retention == "corporate"
        assert "gold" in kw.get(SECTOR_MINES, [])

    def test_tech_bearish(self):
        text = "NVIDIA faces lawsuit and investigation over AI chip fraud"
        sector, kw = _map_sector_weighted(text)
        polarity, bull, bear, strength = _compute_probabilities(text, "reuters", Decimal("93.00"))

        assert sector == SECTOR_TECH
        assert polarity == "negative"

    def test_macro_energy(self):
        text = "OPEC cuts oil production as central bank announces rate hike"
        sector, _ = _map_sector_weighted(text)
        retention = _classify_retention(text)

        assert sector == SECTOR_ENERGY
        assert retention == "macro"

    def test_crypto_social(self):
        text = "Viral tweet from influencer about Bitcoin causes rally"
        asset_class = _resolve_asset_class("crypto_binance")
        retention = _classify_retention(text)

        assert asset_class == ASSET_CRYPTO
        assert retention == "social_media"

    def test_healthcare_fda(self):
        text = "Biotech company receives FDA approval for gene therapy"
        sector, kw = _map_sector_weighted(text)

        assert sector == SECTOR_HEALTHCARE
        assert "fda" in kw.get(SECTOR_HEALTHCARE, [])
        assert "gene therapy" in kw.get(SECTOR_HEALTHCARE, [])

    def test_probability_increases_with_keywords(self):
        _, _, _, s1 = _compute_probabilities("upgrade", "bloomberg", Decimal("90.00"))
        _, _, _, s2 = _compute_probabilities(
            "upgrade growth record rally", "bloomberg", Decimal("90.00"),
        )
        assert s2 >= s1

    def test_ttl_macro_vs_social(self):
        macro_ttl = _estimate_ttl_minutes(
            "Fed raises interest rate", "bloomberg",
            SECTOR_GENERAL, "macro", Decimal("80.00"),
        )
        social_ttl = _estimate_ttl_minutes(
            "Influencer tweet goes viral", "twitter",
            SECTOR_TECH, "social_media", Decimal("80.00"),
        )
        assert macro_ttl > social_ttl * 10
