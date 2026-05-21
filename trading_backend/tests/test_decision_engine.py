"""Tests unitaires pour le moteur de décision NLP.

Couvre les fonctions pures (mapping sectoriel, calcul de probabilités,
TTL, résolution de classe d'actifs) sans nécessiter de base de données.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.decision_engine import (
    ASSET_CRYPTO,
    ASSET_ETF,
    ASSET_STOCK,
    MIN_SIGNAL_PROBABILITY,
    SECTOR_ENERGY,
    SECTOR_FOOD,
    SECTOR_GENERAL,
    SECTOR_INSURANCE,
    SECTOR_MINES,
    SECTOR_REAL_ESTATE,
    SECTOR_TECH,
    _clamp,
    _compute_probabilities,
    _deterministic_noise,
    _estimate_ttl_minutes,
    _extract_source,
    _map_sector,
    _quantize,
    _resolve_asset_class,
    _source_confidence,
)


# ═══════════════════════════════════════════════════════════════════════
# Tests — Utilitaires arithmétiques
# ═══════════════════════════════════════════════════════════════════════


class TestQuantize:
    def test_rounds_to_two_decimals(self) -> None:
        assert _quantize(Decimal("72.456")) == Decimal("72.46")

    def test_rounds_half_up(self) -> None:
        assert _quantize(Decimal("72.455")) == Decimal("72.46")

    def test_already_two_decimals(self) -> None:
        assert _quantize(Decimal("50.00")) == Decimal("50.00")


class TestClamp:
    def test_value_within_range(self) -> None:
        assert _clamp(Decimal("75"), Decimal("50"), Decimal("99")) == Decimal("75")

    def test_value_below_range(self) -> None:
        assert _clamp(Decimal("30"), Decimal("50"), Decimal("99")) == Decimal("50")

    def test_value_above_range(self) -> None:
        assert _clamp(Decimal("120"), Decimal("50"), Decimal("99")) == Decimal("99")


class TestDeterministicNoise:
    def test_same_input_same_output(self) -> None:
        n1 = _deterministic_noise("test news", "bloomberg")
        n2 = _deterministic_noise("test news", "bloomberg")
        assert n1 == n2

    def test_different_input_different_output(self) -> None:
        n1 = _deterministic_noise("test news A", "bloomberg")
        n2 = _deterministic_noise("test news B", "bloomberg")
        assert n1 != n2

    def test_within_range(self) -> None:
        noise = _deterministic_noise("some article about tech", "reuters")
        assert Decimal("-6.00") <= noise <= Decimal("6.00")


# ═══════════════════════════════════════════════════════════════════════
# Tests — Source et confiance
# ═══════════════════════════════════════════════════════════════════════


class TestExtractSource:
    def test_bloomberg(self) -> None:
        assert _extract_source("bloomberg_tech") == "bloomberg_enterprise"

    def test_reuters(self) -> None:
        assert _extract_source("Reuters_Markets") == "reuters_api"

    def test_benzinga(self) -> None:
        assert _extract_source("benzinga_alerts") == "benzinga"

    def test_x_api(self) -> None:
        assert _extract_source("x_crypto") == "x_api_v2"

    def test_twitter(self) -> None:
        assert _extract_source("twitter_finance") == "x_api_v2"

    def test_rss(self) -> None:
        assert _extract_source("rss_feed") == "rss_certified"

    def test_unknown_defaults_to_certified(self) -> None:
        assert _extract_source("unknown_channel") == "certified_feed"


class TestSourceConfidence:
    def test_bloomberg_highest(self) -> None:
        assert _source_confidence("bloomberg_enterprise") == Decimal("95.00")

    def test_x_api_lowest_known(self) -> None:
        assert _source_confidence("x_api_v2") == Decimal("74.00")

    def test_unknown_source(self) -> None:
        assert _source_confidence("totally_unknown") == Decimal("78.00")


# ═══════════════════════════════════════════════════════════════════════
# Tests — Mapping sectoriel
# ═══════════════════════════════════════════════════════════════════════


class TestMapSector:
    """Vérifie le mapping des mots-clés vers les secteurs."""

    def test_gold_maps_to_mines(self) -> None:
        assert _map_sector("Gold prices surge on market uncertainty") == SECTOR_MINES

    def test_lithium_maps_to_mines(self) -> None:
        assert _map_sector("Lithium demand exceeds supply globally") == SECTOR_MINES

    def test_or_french_maps_to_mines(self) -> None:
        """Le mot 'or' (or français) doit matcher avec frontière de mot."""
        assert _map_sector("Le prix de l'or atteint un record") == SECTOR_MINES

    def test_or_in_word_does_not_match_mines(self) -> None:
        """'or' dans 'rapport' ou 'corporate' ne doit PAS matcher mines."""
        result = _map_sector("Le rapport corporate est disponible")
        assert result != SECTOR_MINES

    def test_nvidia_maps_to_tech(self) -> None:
        assert _map_sector("NVIDIA announces record GPU sales") == SECTOR_TECH

    def test_ai_word_boundary_maps_to_tech(self) -> None:
        assert _map_sector("AI technology is transforming markets") == SECTOR_TECH

    def test_real_estate_maps_correctly(self) -> None:
        assert _map_sector("Real estate market shows strong growth") == SECTOR_REAL_ESTATE

    def test_immobilier_maps_correctly(self) -> None:
        assert _map_sector("Le marché immobilier français est en hausse") == SECTOR_REAL_ESTATE

    def test_insurance_maps_correctly(self) -> None:
        assert _map_sector("Insurance premiums rise after floods") == SECTOR_INSURANCE

    def test_assurance_maps_correctly(self) -> None:
        assert _map_sector("L'assurance vie connaît une croissance") == SECTOR_INSURANCE

    def test_food_maps_correctly(self) -> None:
        assert _map_sector("Wheat prices hit five-year high") == SECTOR_FOOD

    def test_agriculture_maps_to_food(self) -> None:
        assert _map_sector("Agriculture sector booms in Brazil") == SECTOR_FOOD

    def test_oil_maps_to_energy(self) -> None:
        assert _map_sector("Oil prices drop as OPEC increases output") == SECTOR_ENERGY

    def test_solar_maps_to_energy(self) -> None:
        assert _map_sector("Solar energy investments surge globally") == SECTOR_ENERGY

    def test_petrole_maps_to_energy(self) -> None:
        assert _map_sector("Le pétrole brut en baisse cette semaine") == SECTOR_ENERGY

    def test_nuclear_maps_to_energy(self) -> None:
        assert _map_sector("Nuclear energy policy under review") == SECTOR_ENERGY

    def test_generic_news_maps_to_general(self) -> None:
        assert _map_sector("Markets close mixed on thin volume") == SECTOR_GENERAL


# ═══════════════════════════════════════════════════════════════════════
# Tests — Résolution de classe d'actifs
# ═══════════════════════════════════════════════════════════════════════


class TestResolveAssetClass:
    def test_crypto_keyword(self) -> None:
        assert _resolve_asset_class("crypto_news") == ASSET_CRYPTO

    def test_binance_keyword(self) -> None:
        assert _resolve_asset_class("binance_alerts") == ASSET_CRYPTO

    def test_coinbase_keyword(self) -> None:
        assert _resolve_asset_class("coinbase_pro") == ASSET_CRYPTO

    def test_bitcoin_keyword(self) -> None:
        assert _resolve_asset_class("bitcoin_daily") == ASSET_CRYPTO

    def test_ethereum_keyword(self) -> None:
        assert _resolve_asset_class("ethereum_news") == ASSET_CRYPTO

    def test_etf_keyword(self) -> None:
        assert _resolve_asset_class("etf_analysis") == ASSET_ETF

    def test_default_to_stocks(self) -> None:
        assert _resolve_asset_class("bloomberg_tech") == ASSET_STOCK

    def test_unknown_category(self) -> None:
        assert _resolve_asset_class("general_feed") == ASSET_STOCK


# ═══════════════════════════════════════════════════════════════════════
# Tests — Calcul de probabilités
# ═══════════════════════════════════════════════════════════════════════


class TestComputeProbabilities:
    def test_bullish_news_returns_positive_polarity(self) -> None:
        polarity, bull, bear = _compute_probabilities(
            "Company beats earnings record with strong growth",
            "bloomberg_tech",
            Decimal("95.00"),
        )
        assert polarity == "positive"
        assert bull > bear

    def test_bearish_news_returns_negative_polarity(self) -> None:
        polarity, bull, bear = _compute_probabilities(
            "Lawsuit filed for fraud, sanctions expected",
            "bloomberg_tech",
            Decimal("95.00"),
        )
        assert polarity == "negative"
        assert bear > bull

    def test_neutral_news_returns_neutral_polarity(self) -> None:
        polarity, _, _ = _compute_probabilities(
            "Markets close with little change today",
            "bloomberg_tech",
            Decimal("95.00"),
        )
        assert polarity == "neutral"

    def test_probabilities_sum_to_100(self) -> None:
        _, bull, bear = _compute_probabilities(
            "Partnership announced for growth expansion",
            "reuters_markets",
            Decimal("93.00"),
        )
        assert bull + bear == Decimal("100.00")

    def test_strength_within_bounds(self) -> None:
        _, bull, bear = _compute_probabilities(
            "upgrade growth record beats partnership acquisition hausse bénéfice",
            "bloomberg_tech",
            Decimal("95.00"),
        )
        strength = max(bull, bear)
        assert Decimal("50.00") <= strength <= Decimal("99.00")

    def test_higher_source_confidence_increases_score(self) -> None:
        _, bull_high, _ = _compute_probabilities(
            "Company posts strong growth numbers",
            "bloomberg_tech",
            Decimal("95.00"),
        )
        _, bull_low, _ = _compute_probabilities(
            "Company posts strong growth numbers",
            "bloomberg_tech",
            Decimal("74.00"),
        )
        assert bull_high > bull_low

    def test_deterministic_results(self) -> None:
        r1 = _compute_probabilities("Test news", "cat", Decimal("80.00"))
        r2 = _compute_probabilities("Test news", "cat", Decimal("80.00"))
        assert r1 == r2


# ═══════════════════════════════════════════════════════════════════════
# Tests — Estimation TTL
# ═══════════════════════════════════════════════════════════════════════


class TestEstimateTTL:
    def test_macro_news_long_ttl(self) -> None:
        ttl = _estimate_ttl_minutes(
            "Fed raises interest rate by 50 basis points",
            "bloomberg_macro",
            SECTOR_GENERAL,
            Decimal("85.00"),
        )
        assert ttl >= 60 * 24

    def test_tweet_short_ttl(self) -> None:
        ttl = _estimate_ttl_minutes(
            "Influencer tweet about new altcoin",
            "x_crypto",
            SECTOR_TECH,
            Decimal("72.00"),
        )
        assert ttl <= 120

    def test_mines_sector_medium_ttl(self) -> None:
        ttl = _estimate_ttl_minutes(
            "Gold production report released",
            "reuters_commodities",
            SECTOR_MINES,
            Decimal("78.00"),
        )
        assert 60 * 6 <= ttl <= 60 * 24

    def test_energy_sector_ttl(self) -> None:
        ttl = _estimate_ttl_minutes(
            "OPEC meeting concludes",
            "reuters_energy",
            SECTOR_ENERGY,
            Decimal("80.00"),
        )
        assert 60 * 6 <= ttl <= 60 * 18

    def test_ttl_clamped_minimum(self) -> None:
        ttl = _estimate_ttl_minutes(
            "Quick tweet rumor",
            "x_crypto",
            SECTOR_GENERAL,
            Decimal("50.00"),
        )
        assert ttl >= 30

    def test_ttl_clamped_maximum(self) -> None:
        ttl = _estimate_ttl_minutes(
            "Central bank macro interest rate quantitative easing",
            "bloomberg_macro",
            SECTOR_GENERAL,
            Decimal("99.00"),
        )
        assert ttl <= 60 * 24 * 7

    def test_higher_strength_increases_ttl(self) -> None:
        ttl_low = _estimate_ttl_minutes(
            "Tech company announces new chip",
            "bloomberg_tech",
            SECTOR_TECH,
            Decimal("70.00"),
        )
        ttl_high = _estimate_ttl_minutes(
            "Tech company announces new chip",
            "bloomberg_tech",
            SECTOR_TECH,
            Decimal("95.00"),
        )
        assert ttl_high >= ttl_low


# ═══════════════════════════════════════════════════════════════════════
# Tests — Constantes de configuration
# ═══════════════════════════════════════════════════════════════════════


class TestConstants:
    def test_min_signal_probability(self) -> None:
        assert MIN_SIGNAL_PROBABILITY == Decimal("70.00")

    def test_sectors_complete(self) -> None:
        from app.services.decision_engine import ALL_SECTORS

        expected = {
            SECTOR_TECH, SECTOR_MINES, SECTOR_REAL_ESTATE,
            SECTOR_INSURANCE, SECTOR_FOOD, SECTOR_ENERGY, SECTOR_GENERAL,
        }
        assert ALL_SECTORS == expected
