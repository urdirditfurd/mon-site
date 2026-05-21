"""Tests unitaires du pipeline NLP (sans base de données)."""

from __future__ import annotations

from decimal import Decimal

from app.domain.decision import MIN_SIGNAL_PROBABILITY, SECTOR_MINES, SECTOR_TECH
from app.services.news_analyzer import (
    compute_probabilities,
    estimate_ttl_minutes,
    map_sector_from_text,
    quantize_probability,
    resolve_asset_class,
    source_confidence,
)


def test_map_sector_mines_from_gold_and_lithium() -> None:
    text = "Gold and lithium miners rally after supply shock in Asia"
    assert map_sector_from_text(text) == SECTOR_MINES


def test_map_sector_tech_from_semiconductor() -> None:
    assert map_sector_from_text("Nvidia unveils new AI chip for datacenter") == SECTOR_TECH


def test_resolve_asset_class_crypto() -> None:
    assert resolve_asset_class("binance/crypto") == "crypto"


def test_source_confidence_reuters() -> None:
    assert source_confidence("reuters_api") == Decimal("93.00")


def test_compute_probabilities_bullish_headline() -> None:
    polarity, bullish, bearish = compute_probabilities(
        "Company beats earnings and announces record growth partnership",
        "reuters/stocks",
        source_confidence("reuters_api"),
    )
    assert polarity == "positive"
    assert bullish > bearish
    assert bullish >= MIN_SIGNAL_PROBABILITY


def test_macro_news_has_longer_ttl_than_tweet() -> None:
    macro_ttl = estimate_ttl_minutes(
        "Fed raises interest rate amid inflation concerns",
        "bloomberg/macro",
        SECTOR_MINES,
        Decimal("82.00"),
    )
    tweet_ttl = estimate_ttl_minutes(
        "Influencer tweet sparks rumor on small cap",
        "x_api_v2/stocks",
        SECTOR_TECH,
        Decimal("82.00"),
    )
    assert macro_ttl > tweet_ttl


def test_quantize_probability_two_decimals() -> None:
    assert quantize_probability(Decimal("72.456")) == Decimal("72.46")


def test_strong_bullish_headline_exceeds_pipeline_threshold() -> None:
    _, bullish, _ = compute_probabilities(
        "Gold surge: miners upgrade outlook with record partnership growth beats",
        "reuters/stocks",
        Decimal("90.00"),
    )
    assert bullish >= MIN_SIGNAL_PROBABILITY
