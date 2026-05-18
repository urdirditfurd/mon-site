"""Service de gestion du risque (Brique E)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from app.models.trading_profile import TradingProfile
from app.models.wallet import Wallet

HUNDRED = Decimal("100")


@dataclass(slots=True)
class RiskDecision:
    """Résultat d'évaluation des contraintes de risque."""

    allowed: bool
    reason: str | None


class RiskManager:
    """Applique les règles stop-loss, drawdown, kill-switch et limites journalières."""

    def sync_daily_state(self, profile: TradingProfile, wallet: Wallet) -> None:
        """Réinitialise les compteurs journaliers et initialise l'equity si nécessaire."""

        today = date.today()
        if profile.last_risk_reset_date != today:
            profile.last_risk_reset_date = today
            profile.orders_today = 0
            profile.cumulative_pnl_today = Decimal("0.00")

        if profile.equity_current <= 0 and wallet.solde_engage > 0:
            profile.equity_current = wallet.solde_engage.quantize(Decimal("0.01"))
        if profile.equity_peak <= 0 and wallet.solde_engage > 0:
            profile.equity_peak = wallet.solde_engage.quantize(Decimal("0.01"))

    def evaluate_new_order(
        self,
        profile: TradingProfile,
        wallet: Wallet,
    ) -> RiskDecision:
        """Valide ou bloque un nouvel ordre selon la politique de risque."""

        self.sync_daily_state(profile, wallet)

        if not profile.is_trading_active:
            reason = profile.risk_block_reason or "Kill switch actif : trading désactivé."
            return RiskDecision(allowed=False, reason=reason)

        if profile.orders_today >= profile.max_orders_per_day:
            return RiskDecision(
                allowed=False,
                reason=(
                    "Limite d'ordres journalière atteinte "
                    f"({profile.orders_today}/{profile.max_orders_per_day})."
                ),
            )

        drawdown_pct = self.compute_drawdown_pct(profile)
        if drawdown_pct >= profile.max_drawdown_pct:
            profile.is_trading_active = False
            profile.risk_block_reason = (
                f"Trading auto-paused: max drawdown atteint ({drawdown_pct}%)."
            )
            return RiskDecision(allowed=False, reason=profile.risk_block_reason)

        if profile.risk_block_reason and profile.is_trading_active:
            profile.risk_block_reason = None

        return RiskDecision(allowed=True, reason=None)

    def register_order_submission(self, profile: TradingProfile) -> None:
        """Incrémente le compteur d'ordres du jour."""

        profile.orders_today += 1

    def apply_fill_result(
        self,
        profile: TradingProfile,
        wallet: Wallet,
        montant_ordre: Decimal,
        pnl_simule: Decimal,
    ) -> Decimal:
        """Applique le stop-loss et met à jour les métriques de risque/equity."""

        adjusted_pnl = self._apply_stop_loss(
            pnl_simule=pnl_simule,
            montant_ordre=montant_ordre,
            stop_loss_pct=profile.stop_loss_pct,
        )

        profile.cumulative_pnl_today = (profile.cumulative_pnl_today + adjusted_pnl).quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )

        wallet.solde_engage = (wallet.solde_engage + adjusted_pnl).quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )
        wallet.solde_total = (wallet.solde_total + adjusted_pnl).quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )
        if wallet.solde_engage < 0:
            wallet.solde_engage = Decimal("0.00")

        profile.equity_current = wallet.solde_engage
        if profile.equity_current > profile.equity_peak:
            profile.equity_peak = profile.equity_current

        drawdown_pct = self.compute_drawdown_pct(profile)
        if drawdown_pct >= profile.max_drawdown_pct:
            profile.is_trading_active = False
            profile.risk_block_reason = (
                f"Trading auto-paused: max drawdown atteint ({drawdown_pct}%)."
            )
        elif wallet.solde_engage <= 0:
            profile.is_trading_active = False
            profile.risk_block_reason = "Trading auto-paused: capital engagé épuisé."

        return adjusted_pnl

    @staticmethod
    def _apply_stop_loss(
        pnl_simule: Decimal,
        montant_ordre: Decimal,
        stop_loss_pct: Decimal,
    ) -> Decimal:
        """Cappe les pertes maximales sur un ordre."""

        max_loss = -((montant_ordre * stop_loss_pct) / HUNDRED).quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )
        adjusted = pnl_simule if pnl_simule >= max_loss else max_loss
        return adjusted.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    @staticmethod
    def compute_drawdown_pct(profile: TradingProfile) -> Decimal:
        """Calcule le drawdown courant en pourcentage."""

        if profile.equity_peak <= 0:
            return Decimal("0.00")
        if profile.equity_current >= profile.equity_peak:
            return Decimal("0.00")

        drawdown = ((profile.equity_peak - profile.equity_current) / profile.equity_peak) * HUNDRED
        return drawdown.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
