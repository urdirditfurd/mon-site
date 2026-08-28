"""Univers d'actifs surveillés — actions, ETF, crypto (données gratuites)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

AssetType = Literal["stock", "etf", "crypto"]


@dataclass(frozen=True, slots=True)
class TrackedAsset:
    symbol: str
    name: str
    asset_type: AssetType
    region: str


# Lemon MVP : panier mondial diversifié, couvert par yfinance + CoinGecko
DEFAULT_UNIVERSE: tuple[TrackedAsset, ...] = (
    # Actions US tech & blue chips
    TrackedAsset("AAPL", "Apple", "stock", "US"),
    TrackedAsset("MSFT", "Microsoft", "stock", "US"),
    TrackedAsset("NVDA", "NVIDIA", "stock", "US"),
    TrackedAsset("GOOGL", "Alphabet", "stock", "US"),
    TrackedAsset("AMZN", "Amazon", "stock", "US"),
    TrackedAsset("META", "Meta", "stock", "US"),
    TrackedAsset("TSLA", "Tesla", "stock", "US"),
    # Europe
    TrackedAsset("MC.PA", "LVMH", "stock", "EU"),
    TrackedAsset("OR.PA", "L'Oréal", "stock", "EU"),
    TrackedAsset("SAP.DE", "SAP", "stock", "EU"),
    TrackedAsset("ASML", "ASML", "stock", "EU"),
    # Asie (via tickers US ADR ou HK)
    TrackedAsset("BABA", "Alibaba", "stock", "ASIA"),
    TrackedAsset("TSM", "Taiwan Semi", "stock", "ASIA"),
    # ETF mondiaux
    TrackedAsset("SPY", "S&P 500 ETF", "etf", "US"),
    TrackedAsset("QQQ", "Nasdaq 100 ETF", "etf", "US"),
    TrackedAsset("VT", "Vanguard Total World", "etf", "GLOBAL"),
    TrackedAsset("EWJ", "Japon ETF", "etf", "ASIA"),
    TrackedAsset("EEM", "Marchés émergents ETF", "etf", "GLOBAL"),
    TrackedAsset("GLD", "Or ETF", "etf", "GLOBAL"),
    # Crypto (symboles yfinance / coingecko)
    TrackedAsset("BTC-USD", "Bitcoin", "crypto", "GLOBAL"),
    TrackedAsset("ETH-USD", "Ethereum", "crypto", "GLOBAL"),
)


def get_universe() -> list[TrackedAsset]:
    return list(DEFAULT_UNIVERSE)
