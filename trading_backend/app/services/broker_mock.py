"""Passerelle broker fictive (type Alpaca/Binance) pour les ordres simulés."""

from __future__ import annotations

import asyncio
import random
import uuid
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP


@dataclass(slots=True)
class BrokerSubmissionResult:
    """Résultat immédiat lors de la soumission d'un ordre."""

    broker: str
    broker_order_id: str
    asset_symbol: str
    requested_price: Decimal
    status: str
    rejection_reason: str | None = None


@dataclass(slots=True)
class BrokerFinalizationResult:
    """Résultat final d'un ordre initialement en attente."""

    status: str
    filled_price: Decimal | None
    pnl_simule: Decimal
    rejection_reason: str | None = None


class MockBrokerGateway:
    """Simule l'API d'un courtier partenaire."""

    def __init__(self, broker_name: str = "alpaca_mock") -> None:
        self._broker_name = broker_name
        self._asset_universe = ["NVDA", "AAPL", "MSFT", "TSLA", "BTCUSD"]
        self._reference_prices = {
            "NVDA": Decimal("982.30"),
            "AAPL": Decimal("212.45"),
            "MSFT": Decimal("428.10"),
            "TSLA": Decimal("183.70"),
            "BTCUSD": Decimal("67250.00"),
        }

    async def submit_order(
        self,
        direction: str,
        confidence: Decimal,
    ) -> BrokerSubmissionResult:
        """Soumet un ordre et renvoie un statut initial."""

        await asyncio.sleep(0.08)
        asset = random.choice(self._asset_universe)
        base_price = self._reference_prices[asset]
        requested_price = self._price_with_noise(base_price, 0.008)

        # Plus la confiance est élevée, plus la probabilité de rejet diminue.
        reject_threshold = Decimal("67.50")
        if confidence < reject_threshold and random.random() < 0.35:
            return BrokerSubmissionResult(
                broker=self._broker_name,
                broker_order_id=self._generate_broker_order_id(),
                asset_symbol=asset,
                requested_price=requested_price,
                status="rejected",
                rejection_reason="Risque trop élevé selon le broker mock.",
            )

        # Certains ordres sont exécutés instantanément, d'autres passent en pending.
        instant_fill_probability = 0.4 if confidence < Decimal("85.00") else 0.6
        initial_status = "filled" if random.random() < instant_fill_probability else "pending"

        return BrokerSubmissionResult(
            broker=self._broker_name,
            broker_order_id=self._generate_broker_order_id(),
            asset_symbol=asset,
            requested_price=requested_price,
            status=initial_status,
        )

    async def finalize_pending_order(
        self,
        direction: str,
        requested_price: Decimal,
        montant_ordre: Decimal,
    ) -> BrokerFinalizationResult:
        """Résout un ordre pending en filled/rejected puis calcule un PnL simulé."""

        await asyncio.sleep(random.uniform(1.5, 4.5))

        if random.random() < 0.18:
            return BrokerFinalizationResult(
                status="rejected",
                filled_price=None,
                pnl_simule=Decimal("0.00"),
                rejection_reason="Liquidité insuffisante sur le carnet simulé.",
            )

        filled_price = self._price_with_noise(requested_price, 0.004)
        pnl = self._simulate_pnl(
            direction=direction,
            filled_price=filled_price,
            montant_ordre=montant_ordre,
        )
        return BrokerFinalizationResult(
            status="filled",
            filled_price=filled_price,
            pnl_simule=pnl,
            rejection_reason=None,
        )

    def finalize_instant_fill(
        self,
        direction: str,
        requested_price: Decimal,
        montant_ordre: Decimal,
    ) -> BrokerFinalizationResult:
        """Construit un résultat immédiat pour un ordre rempli instantanément."""

        filled_price = self._price_with_noise(requested_price, 0.002)
        pnl = self._simulate_pnl(
            direction=direction,
            filled_price=filled_price,
            montant_ordre=montant_ordre,
        )
        return BrokerFinalizationResult(
            status="filled",
            filled_price=filled_price,
            pnl_simule=pnl,
            rejection_reason=None,
        )

    def _simulate_pnl(
        self,
        direction: str,
        filled_price: Decimal,
        montant_ordre: Decimal,
    ) -> Decimal:
        """Calcule un PnL simple à partir d'un mouvement prix simulé."""

        move_percent = Decimal(str(random.uniform(-0.02, 0.02)))
        quantity = (montant_ordre / filled_price).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

        if direction == "buy":
            pnl = quantity * filled_price * move_percent
        else:
            # Short simulé: gain si le prix baisse.
            pnl = quantity * filled_price * (-move_percent)

        return pnl.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    @staticmethod
    def _generate_broker_order_id() -> str:
        return f"ord_{uuid.uuid4().hex[:18]}"

    @staticmethod
    def _price_with_noise(base: Decimal, ratio: float) -> Decimal:
        delta = Decimal(str(random.uniform(-ratio, ratio)))
        noisy = base * (Decimal("1.0") + delta)
        return noisy.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
