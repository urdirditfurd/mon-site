"""Adaptateur CCXT — exécution multi-broker (paper/live)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal

import ccxt.async_support as ccxt

from app.services.broker.crypto_vault import decrypt_secret
from app.services.broker.exchanges import get_exchange

logger = logging.getLogger(__name__)

TradingMode = Literal["paper", "live"]


@dataclass(slots=True)
class BrokerCredentials:
    exchange_id: str
    api_key: str
    api_secret: str
    passphrase: str = ""
    mode: TradingMode = "paper"


@dataclass(slots=True)
class OrderResult:
    success: bool
    order_id: str | None
    symbol: str
    side: str
    amount: float
    price: float | None
    status: str
    raw: dict[str, Any]
    error: str | None = None


def _map_symbol_to_ccxt(symbol: str, asset_type: str, exchange_id: str) -> str:
    """Convertit symboles internes (BTC-USD, AAPL) vers format CCXT."""
    if asset_type == "crypto":
        if "/" in symbol:
            return symbol
        base = symbol.replace("-USD", "").replace("USDT", "")
        if exchange_id in ("binance", "bitget", "okx", "bybit"):
            return f"{base}/USDT"
        if exchange_id == "kraken":
            return f"{base}/USD"
        return f"{base}/USDT"
    return symbol


class CcxtBrokerAdapter:
    def __init__(self, creds: BrokerCredentials) -> None:
        self.creds = creds
        self._exchange: ccxt.Exchange | None = None

    async def connect(self) -> ccxt.Exchange:
        exchange_cls = getattr(ccxt, self.creds.exchange_id, None)
        if exchange_cls is None:
            raise ValueError(f"Exchange non supporté : {self.creds.exchange_id}")

        config: dict[str, Any] = {
            "apiKey": self.creds.api_key,
            "secret": self.creds.api_secret,
            "enableRateLimit": True,
        }
        if self.creds.passphrase:
            config["password"] = self.creds.passphrase

        exchange = exchange_cls(config)

        if self.creds.mode == "paper":
            exchange.set_sandbox_mode(True)
            if self.creds.exchange_id == "alpaca":
                exchange.options["paper"] = True

        await exchange.load_markets()
        self._exchange = exchange
        return exchange

    async def close(self) -> None:
        if self._exchange:
            await self._exchange.close()
            self._exchange = None

    async def fetch_balance(self) -> dict[str, Any]:
        ex = self._exchange or await self.connect()
        try:
            balance = await ex.fetch_balance()
            return {
                "total": balance.get("total", {}),
                "free": balance.get("free", {}),
                "used": balance.get("used", {}),
            }
        finally:
            if not self._exchange:
                await ex.close()

    async def fetch_ticker_price(self, symbol: str, asset_type: str) -> float:
        ex = self._exchange or await self.connect()
        ccxt_symbol = _map_symbol_to_ccxt(symbol, asset_type, self.creds.exchange_id)
        try:
            ticker = await ex.fetch_ticker(ccxt_symbol)
            return float(ticker.get("last") or ticker.get("close") or 0)
        finally:
            if not self._exchange:
                await ex.close()

    async def create_market_order(
        self,
        symbol: str,
        asset_type: str,
        side: Literal["buy", "sell"],
        amount_usd: float,
    ) -> OrderResult:
        ex = self._exchange or await self.connect()
        ccxt_symbol = _map_symbol_to_ccxt(symbol, asset_type, self.creds.exchange_id)

        try:
            if ccxt_symbol not in ex.markets:
                return OrderResult(
                    success=False,
                    order_id=None,
                    symbol=ccxt_symbol,
                    side=side,
                    amount=0,
                    price=None,
                    status="rejected",
                    raw={},
                    error=f"Symbole {ccxt_symbol} indisponible sur {self.creds.exchange_id}",
                )

            ticker = await ex.fetch_ticker(ccxt_symbol)
            price = float(ticker.get("last") or 0)
            if price <= 0:
                return OrderResult(
                    success=False, order_id=None, symbol=ccxt_symbol, side=side,
                    amount=0, price=None, status="rejected", raw={},
                    error="Prix indisponible",
                )

            market = ex.markets[ccxt_symbol]
            amount = amount_usd / price
            precision = market.get("precision", {}).get("amount")
            if precision is not None:
                amount = float(ex.amount_to_precision(ccxt_symbol, amount))

            min_cost = market.get("limits", {}).get("cost", {}).get("min")
            if min_cost and amount_usd < float(min_cost):
                return OrderResult(
                    success=False, order_id=None, symbol=ccxt_symbol, side=side,
                    amount=amount, price=price, status="rejected", raw={},
                    error=f"Montant minimum : {min_cost} {market.get('quote', 'USD')}",
                )

            order = await ex.create_order(ccxt_symbol, "market", side, amount)
            return OrderResult(
                success=True,
                order_id=str(order.get("id", "")),
                symbol=ccxt_symbol,
                side=side,
                amount=float(order.get("amount") or amount),
                price=float(order.get("average") or order.get("price") or price),
                status=str(order.get("status", "open")),
                raw=order,
            )
        except Exception as exc:
            logger.exception("Erreur ordre %s %s: %s", side, ccxt_symbol, exc)
            return OrderResult(
                success=False, order_id=None, symbol=ccxt_symbol, side=side,
                amount=0, price=None, status="failed", raw={},
                error=str(exc),
            )
        finally:
            if not self._exchange:
                await ex.close()


def adapter_from_encrypted(
    exchange_id: str,
    api_key_enc: str,
    api_secret_enc: str,
    passphrase_enc: str = "",
    mode: TradingMode = "paper",
) -> CcxtBrokerAdapter:
    return CcxtBrokerAdapter(
        BrokerCredentials(
            exchange_id=exchange_id,
            api_key=decrypt_secret(api_key_enc),
            api_secret=decrypt_secret(api_secret_enc),
            passphrase=decrypt_secret(passphrase_enc) if passphrase_enc else "",
            mode=mode,
        )
    )


async def test_connection(
    exchange_id: str,
    api_key: str,
    api_secret: str,
    passphrase: str = "",
    mode: TradingMode = "paper",
) -> dict[str, Any]:
    info = get_exchange(exchange_id)
    if not info:
        return {"ok": False, "error": "Exchange inconnu"}

    adapter = CcxtBrokerAdapter(
        BrokerCredentials(
            exchange_id=exchange_id,
            api_key=api_key,
            api_secret=api_secret,
            passphrase=passphrase,
            mode=mode,
        )
    )
    try:
        await adapter.connect()
        balance = await adapter.fetch_balance()
        return {
            "ok": True,
            "exchange": exchange_id,
            "mode": mode,
            "balance_sample": {k: v for k, v in list(balance.get("free", {}).items())[:5] if v},
            "warning": info.region_note if info.deprecated_fr else None,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        await adapter.close()
