"""Courtiers supportés — priorités France / UE."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExchangeInfo:
    id: str
    name: str
    asset_types: tuple[str, ...]
    region_note: str
    sandbox_available: bool
    recommended_fr: bool
    deprecated_fr: bool
    setup_url: str


# Binance ferme en France → alternatives régulées / accessibles
SUPPORTED_EXCHANGES: tuple[ExchangeInfo, ...] = (
    ExchangeInfo(
        id="kraken",
        name="Kraken",
        asset_types=("crypto",),
        region_note="Recommandé France/UE — enregistré PSAN (AMF).",
        sandbox_available=False,
        recommended_fr=True,
        deprecated_fr=False,
        setup_url="https://www.kraken.com/features/api",
    ),
    ExchangeInfo(
        id="bitget",
        name="Bitget",
        asset_types=("crypto",),
        region_note="Alternative crypto populaire en Europe.",
        sandbox_available=True,
        recommended_fr=True,
        deprecated_fr=False,
        setup_url="https://www.bitget.com/api-doc",
    ),
    ExchangeInfo(
        id="okx",
        name="OKX",
        asset_types=("crypto",),
        region_note="Liquidité élevée — vérifier disponibilité selon votre pays.",
        sandbox_available=True,
        recommended_fr=False,
        deprecated_fr=False,
        setup_url="https://www.okx.com/docs-v5/en/",
    ),
    ExchangeInfo(
        id="bybit",
        name="Bybit",
        asset_types=("crypto",),
        region_note="Perpétuels + spot — vérifier conformité locale.",
        sandbox_available=True,
        recommended_fr=False,
        deprecated_fr=False,
        setup_url="https://bybit-exchange.github.io/docs/",
    ),
    ExchangeInfo(
        id="binance",
        name="Binance",
        asset_types=("crypto",),
        region_note="⚠️ Fermeture progressive en France. Utilisez le testnet pour les tests uniquement.",
        sandbox_available=True,
        recommended_fr=False,
        deprecated_fr=True,
        setup_url="https://testnet.binance.vision/",
    ),
    ExchangeInfo(
        id="alpaca",
        name="Alpaca (Paper)",
        asset_types=("stock", "etf"),
        region_note="Paper trading actions US — gratuit, idéal pour débuter.",
        sandbox_available=True,
        recommended_fr=True,
        deprecated_fr=False,
        setup_url="https://alpaca.markets/docs/",
    ),
)


def get_exchange(exchange_id: str) -> ExchangeInfo | None:
    return next((e for e in SUPPORTED_EXCHANGES if e.id == exchange_id), None)


def list_exchanges_for_ui() -> list[dict]:
    return [
        {
            "id": e.id,
            "name": e.name,
            "asset_types": list(e.asset_types),
            "region_note": e.region_note,
            "sandbox_available": e.sandbox_available,
            "recommended_fr": e.recommended_fr,
            "deprecated_fr": e.deprecated_fr,
            "setup_url": e.setup_url,
        }
        for e in SUPPORTED_EXCHANGES
    ]
