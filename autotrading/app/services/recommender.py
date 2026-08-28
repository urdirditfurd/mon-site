"""Moteur de recommandations — classe les meilleures opportunités pour débutants."""

from __future__ import annotations

from app.core.config import settings
from app.schemas.market import AnalysisResult, Recommendation
from app.services.market_data import MarketSnapshot


def _risk_level(buy_prob: float, asset_type: str, change_24h: float) -> str:
    volatility_penalty = abs(change_24h)
    if asset_type == "crypto" or volatility_penalty > 5:
        return "élevé"
    if buy_prob >= 72 and volatility_penalty < 2:
        return "faible"
    return "modéré"


def _expected_gain(buy_prob: float, momentum_5d: float) -> float:
    base = (buy_prob - 50) * 0.15
    return round(max(1.0, min(15.0, base + momentum_5d * 0.2)), 1)


def _horizon(asset_type: str) -> str:
    if asset_type == "crypto":
        return "Court terme (1-7 jours)"
    if asset_type == "etf":
        return "Moyen terme (1-3 mois)"
    return "Moyen terme (2-8 semaines)"


def _beginner_summary(symbol: str, name: str, signal: str, buy_prob: float) -> str:
    if signal == "ACHETER":
        return (
            f"{name} ({symbol}) montre des signaux positifs avec {buy_prob:.0f}% de probabilité haussière. "
            "Convient aux débutants qui acceptent un suivi régulier — le site vous préviendra quand vendre."
        )
    if signal == "VENDRE":
        return f"{name} ({symbol}) : prudence, signaux de vente détectés. Mieux vaut attendre une meilleure entrée."
    return f"{name} ({symbol}) : pas d'opportunité claire pour l'instant. Restez en observation."


def build_recommendations(
    snapshots: list[MarketSnapshot],
    analyses: list[AnalysisResult],
) -> list[Recommendation]:
    snapshot_by_symbol = {s.symbol: s for s in snapshots}
    candidates: list[Recommendation] = []

    for analysis in analyses:
        if analysis.signal != "ACHETER":
            continue
        if analysis.buy_probability < settings.min_buy_probability:
            continue
        snap = snapshot_by_symbol.get(analysis.symbol)
        if not snap:
            continue
        mom = analysis.indicators.get("momentum_5d", 0.0)
        candidates.append(
            Recommendation(
                rank=0,
                symbol=analysis.symbol,
                name=snap.name,
                asset_type=analysis.asset_type,
                price=snap.price,
                buy_probability=analysis.buy_probability,
                expected_gain_pct=_expected_gain(analysis.buy_probability, mom),
                risk_level=_risk_level(analysis.buy_probability, analysis.asset_type, snap.change_pct_24h),
                horizon=_horizon(analysis.asset_type),
                beginner_summary=_beginner_summary(
                    analysis.symbol, snap.name, analysis.signal, analysis.buy_probability
                ),
                reasoning=analysis.reasoning,
            )
        )

    candidates.sort(key=lambda r: (r.buy_probability, r.expected_gain_pct), reverse=True)
    for i, rec in enumerate(candidates[:10], start=1):
        rec.rank = i
    return candidates[:10]
