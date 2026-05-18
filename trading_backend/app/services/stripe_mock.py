"""Simulation minimaliste d'une transaction Stripe."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from decimal import Decimal


async def simulate_stripe_deposit(amount: Decimal, payment_method: str | None = None) -> dict[str, str]:
    """Retourne une transaction fictive validée.

    On simule un petit délai réseau pour refléter un appel API externe.
    """

    await asyncio.sleep(0.15)
    return {
        "status": "succeeded",
        "transaction_id": f"pi_{uuid.uuid4().hex[:24]}",
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "amount": str(amount),
        "payment_method": payment_method or "card_mock",
    }
