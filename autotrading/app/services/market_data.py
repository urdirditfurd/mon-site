"""Récupération des cours réels — yfinance (actions/ETF) + CoinGecko (crypto backup)."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import httpx
import yfinance as yf

from app.services.universe import AssetType, TrackedAsset

logger = logging.getLogger(__name__)

COINGECKO_IDS = {
    "BTC-USD": "bitcoin",
    "ETH-USD": "ethereum",
}


@dataclass(slots=True)
class PriceBar:
    close: float
    volume: float


@dataclass(slots=True)
class MarketSnapshot:
    symbol: str
    name: str
    asset_type: AssetType
    price: float
    currency: str
    change_pct_24h: float
    bars: list[PriceBar]


def _fetch_yfinance_sync(symbol: str, period: str = "3mo", interval: str = "1d") -> list[PriceBar]:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period=period, interval=interval)
    if hist.empty:
        return []
    bars: list[PriceBar] = []
    for _, row in hist.iterrows():
        bars.append(PriceBar(close=float(row["Close"]), volume=float(row.get("Volume", 0) or 0)))
    return bars


def _fetch_quote_sync(symbol: str) -> tuple[float, float, str]:
    ticker = yf.Ticker(symbol)
    info = ticker.fast_info
    price = float(getattr(info, "last_price", 0) or getattr(info, "lastPrice", 0) or 0)
    prev = float(getattr(info, "previous_close", 0) or getattr(info, "previousClose", 0) or price)
    currency = str(getattr(info, "currency", "USD") or "USD")
    change_pct = ((price - prev) / prev * 100) if prev else 0.0
    if price <= 0:
        hist = ticker.history(period="5d", interval="1d")
        if not hist.empty:
            price = float(hist["Close"].iloc[-1])
            if len(hist) >= 2:
                prev = float(hist["Close"].iloc[-2])
                change_pct = ((price - prev) / prev * 100) if prev else 0.0
    return price, change_pct, currency


async def _fetch_coingecko(symbol: str) -> tuple[float, float] | None:
    coin_id = COINGECKO_IDS.get(symbol)
    if not coin_id:
        return None
    url = "https://api.coingecko.com/api/v3/simple/price"
    params = {"ids": coin_id, "vs_currencies": "usd", "include_24hr_change": "true"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json().get(coin_id, {})
            price = float(data.get("usd", 0))
            change = float(data.get("usd_24h_change", 0) or 0)
            if price > 0:
                return price, change
    except Exception as exc:
        logger.warning("CoinGecko fallback failed for %s: %s", symbol, exc)
    return None


async def fetch_market_snapshot(asset: TrackedAsset) -> MarketSnapshot | None:
    """Charge cours + historique pour un actif."""

    try:
        bars, quote = await asyncio.gather(
            asyncio.to_thread(_fetch_yfinance_sync, asset.symbol),
            asyncio.to_thread(_fetch_quote_sync, asset.symbol),
        )
        price, change_pct, currency = quote

        if price <= 0 and asset.asset_type == "crypto":
            cg = await _fetch_coingecko(asset.symbol)
            if cg:
                price, change_pct = cg
                currency = "USD"

        if price <= 0 or len(bars) < 20:
            logger.warning("Données insuffisantes pour %s", asset.symbol)
            return None

        return MarketSnapshot(
            symbol=asset.symbol,
            name=asset.name,
            asset_type=asset.asset_type,
            price=price,
            currency=currency,
            change_pct_24h=change_pct,
            bars=bars,
        )
    except Exception as exc:
        logger.exception("Erreur fetch %s: %s", asset.symbol, exc)
        return None


async def fetch_price_only(symbol: str, asset_type: AssetType) -> float | None:
    try:
        price, _, _ = await asyncio.to_thread(_fetch_quote_sync, symbol)
        if price <= 0 and asset_type == "crypto":
            cg = await _fetch_coingecko(symbol)
            if cg:
                return cg[0]
        return price if price > 0 else None
    except Exception:
        return None
