"""Moteur NLP + décision trading — façade stable pour l'API.

L'implémentation modulaire vit dans :mod:`app.services.algorithm`.
"""

from __future__ import annotations

from app.services.algorithm import (
    NewsAnalysisResult,
    TradingOpportunityResult,
    analyze_incoming_news,
    evaluate_trading_opportunity,
)

__all__ = (
    "NewsAnalysisResult",
    "TradingOpportunityResult",
    "analyze_incoming_news",
    "evaluate_trading_opportunity",
)
