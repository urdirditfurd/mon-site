"""Connecteurs externes configurables par secrets serveur."""

from __future__ import annotations

import asyncio
import base64
import json
import urllib.parse
import urllib.request
from decimal import Decimal, ROUND_HALF_UP

from app.core.config import settings
from app.schemas.integrations import IntegrationStatus, StripeCheckoutResponse


def _is_configured(*values: str) -> bool:
    return all(bool(value.strip()) for value in values)


def _mask(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return f"{value[:2]}***"
    return f"{value[:4]}***{value[-4:]}"


def get_payment_statuses() -> list[IntegrationStatus]:
    """Retourne l'état des prestataires de paiement supportés."""

    stripe_ready = _is_configured(settings.stripe_secret_key)
    return [
        IntegrationStatus(
            id="stripe",
            label="Stripe Checkout",
            category="payment",
            configured=stripe_ready,
            status="configured" if stripe_ready else "missing_secret",
            required_env=["STRIPE_SECRET_KEY"],
            masked_identifiers=[_mask(settings.stripe_secret_key)] if stripe_ready else [],
            note="Encaissements carte/Apple Pay/Google Pay via page Stripe hébergée.",
        ),
        IntegrationStatus(
            id="open_banking",
            label="Open banking (GoCardless/Tink/Plaid)",
            category="payment",
            configured=False,
            status="planned",
            required_env=["OPEN_BANKING_CLIENT_ID", "OPEN_BANKING_CLIENT_SECRET"],
            note="À utiliser pour virements/agrégation bancaire sans demander les identifiants bancaires à SentiQ.",
        ),
    ]


def get_broker_statuses() -> list[IntegrationStatus]:
    """Retourne l'état des brokers/exchanges configurés côté serveur."""

    definitions = [
        (
            "binance",
            "Binance",
            _is_configured(settings.binance_api_key, settings.binance_api_secret),
            ["BINANCE_API_KEY", "BINANCE_API_SECRET"],
            [_mask(settings.binance_api_key)] if settings.binance_api_key else [],
            "Crypto spot/futures selon droits API. Utiliser des clés restreintes, idéalement sans retrait.",
        ),
        (
            "coinbase",
            "Coinbase Advanced Trade",
            _is_configured(settings.coinbase_api_key, settings.coinbase_api_secret),
            ["COINBASE_API_KEY", "COINBASE_API_SECRET"],
            [_mask(settings.coinbase_api_key)] if settings.coinbase_api_key else [],
            "Crypto via API Coinbase Advanced Trade.",
        ),
        (
            "alpaca",
            "Alpaca",
            _is_configured(settings.alpaca_api_key, settings.alpaca_api_secret),
            ["ALPACA_API_KEY", "ALPACA_API_SECRET", "ALPACA_BASE_URL"],
            [_mask(settings.alpaca_api_key)] if settings.alpaca_api_key else [],
            "Actions/ETF en paper trading ou live selon endpoint et compte Alpaca.",
        ),
        (
            "interactive_brokers",
            "Interactive Brokers Gateway",
            _is_configured(settings.ibkr_gateway_url),
            ["IBKR_GATEWAY_URL"],
            [settings.ibkr_gateway_url] if settings.ibkr_gateway_url else [],
            "Nécessite IB Gateway/TWS opérationnel et durci sur le serveur.",
        ),
    ]
    return [
        IntegrationStatus(
            id=identifier,
            label=label,
            category="broker",
            configured=configured,
            status="configured" if configured else "missing_secret",
            required_env=required_env,
            masked_identifiers=masked,
            note=note,
        )
        for identifier, label, configured, required_env, masked, note in definitions
    ]


def get_oauth_statuses() -> list[IntegrationStatus]:
    """Retourne l'état des fournisseurs OAuth."""

    google_ready = _is_configured(settings.google_client_id, settings.google_client_secret)
    return [
        IntegrationStatus(
            id="google",
            label="Google OAuth",
            category="oauth",
            configured=google_ready,
            status="configured" if google_ready else "missing_secret",
            required_env=["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
            masked_identifiers=[_mask(settings.google_client_id)] if settings.google_client_id else [],
            note="Connexion Google à activer après configuration des URLs de callback Google Cloud.",
        )
    ]


def get_broker_status(platform: str) -> IntegrationStatus | None:
    """Retourne le statut d'un broker par identifiant."""

    return next((status for status in get_broker_statuses() if status.id == platform), None)


def _stripe_checkout_request(amount: Decimal, success_url: str, cancel_url: str) -> dict:
    cents = int((amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) * Decimal("100")).to_integral_value())
    payload = {
        "mode": "payment",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "payment_method_types[0]": "card",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": settings.stripe_currency,
        "line_items[0][price_data][unit_amount]": str(cents),
        "line_items[0][price_data][product_data][name]": "Crédit wallet SentiQ",
    }
    encoded_payload = urllib.parse.urlencode(payload).encode("utf-8")
    token = base64.b64encode(f"{settings.stripe_secret_key}:".encode("utf-8")).decode("ascii")
    request = urllib.request.Request(
        "https://api.stripe.com/v1/checkout/sessions",
        data=encoded_payload,
        headers={
            "Authorization": f"Basic {token}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


async def create_stripe_checkout_session(
    *,
    amount: Decimal,
    success_url: str,
    cancel_url: str,
) -> StripeCheckoutResponse:
    """Crée une session Stripe Checkout si le secret serveur est configuré."""

    if not settings.stripe_secret_key:
        return StripeCheckoutResponse(
            provider="stripe",
            configured=False,
            message="Stripe n'est pas encore configuré côté serveur (STRIPE_SECRET_KEY manquant).",
        )

    session = await asyncio.to_thread(_stripe_checkout_request, amount, success_url, cancel_url)
    return StripeCheckoutResponse(
        provider="stripe",
        configured=True,
        checkout_url=session.get("url"),
        session_id=session.get("id"),
        message="Session Stripe Checkout créée.",
    )
